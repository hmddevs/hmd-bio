import mongoose, { type Connection } from "mongoose";
import { captureError } from "@/lib/errors";

/**
 * Connection lifecycle, which differs by runtime.
 *
 * Node (`next dev`, `next build`, the ops scripts in `scripts/`): one cached
 * connection on the default mongoose instance, held for the life of the
 * process. Unchanged from the Vercel deployment, and `scripts/` depends on it:
 * several of them call `connectDB()` and then reach for `mongoose.connection`
 * or `mongoose.disconnect()`.
 *
 * Cloudflare Workers (workerd): one connection per request. workerd binds every
 * I/O object to the request context that created it, so a socket left in a pool
 * by one request cannot be used by the next. Measured against a local mongod
 * inside `wrangler dev`, a cached connection gave two successful requests and
 * then killed the worker on every request after that ("your Worker's code had
 * hung and would never generate a response"). Requests are scoped by the
 * OpenNext request context, so overlapping requests in one isolate never share
 * a connection either.
 */

function getMongoURI(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Please define the MONGODB_URI environment variable");
  }
  return uri;
}

const ON_WORKERD =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

const BASE_OPTIONS = {
  bufferCommands: false,
  // Index creation is owned by the migration scripts in scripts/, not by
  // the app. Mongoose defaults autoIndex to true, which would let any
  // serverless instance start building indexes on first connect and race
  // a migration mid-deploy. Explicitly off everywhere.
  autoIndex: false,
  serverSelectionTimeoutMS: 3000,
  socketTimeoutMS: 30000,
} as const;

/** A long-lived Node process can keep a real pool. */
const NODE_MAX_POOL_SIZE = 10;

/**
 * One request, one socket. A pooled socket cannot outlive the request that
 * opened it on workerd, so anything above 1 is dead weight that only widens
 * the connection count Atlas sees.
 */
const WORKER_MAX_POOL_SIZE = 1;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function withRetry(open: () => Promise<Connection>, attempt = 1): Promise<Connection> {
  try {
    return await open();
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    console.warn(`MongoDB connection attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    return withRetry(open, attempt + 1);
  }
}

// ── Node: one cached connection per process ────────────────────────────────

interface MongooseCache {
  conn: Connection | null;
  promise: Promise<Connection> | null;
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache ?? { conn: null, promise: null };
global.mongooseCache = cached;

async function connectDefault(): Promise<Connection> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = withRetry(async () => {
      const instance = await mongoose.connect(getMongoURI(), {
        ...BASE_OPTIONS,
        maxPoolSize: NODE_MAX_POOL_SIZE,
      });
      return instance.connection;
    }).catch((err) => {
      // Reset promise on failure so the next call retries
      cached.promise = null;
      throw err;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// ── workerd: one connection per request ────────────────────────────────────

/**
 * The slice of Cloudflare's `ExecutionContext` this module needs. Typed
 * structurally so that nothing here depends on the Workers type package.
 */
interface RequestLifetime {
  waitUntil(promise: Promise<unknown>): void;
}

interface RequestConnection {
  connection: Connection;
  ready: Promise<Connection>;
  /** Fire-and-forget writes that must finish before the connection closes. */
  background: Set<Promise<unknown>>;
}

/**
 * OpenNext stores the Cloudflare context in an AsyncLocalStorage and exposes it
 * on this global symbol, so reading it gives the context of the request that is
 * actually running, not whichever one started most recently. This is the same
 * store `getCloudflareContext()` reads; the symbol is read directly so that the
 * ops scripts in `scripts/` can keep importing this module under plain Node
 * without pulling in the Cloudflare adapter.
 */
const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

const requestConnections = new WeakMap<RequestLifetime, RequestConnection>();

/**
 * The current request on workerd, or null when running under Node.
 *
 * Throws on workerd when there is no request context: every entry point goes
 * through OpenNext's wrapper, so an absent context means a connection is being
 * opened somewhere it could never be scoped or closed, and sharing it would
 * reintroduce exactly the hang this design exists to prevent.
 */
function currentRequest(): RequestLifetime | null {
  if (!ON_WORKERD) return null;

  const context = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT] as
    | { ctx: RequestLifetime }
    | undefined;

  if (!context) {
    throw new Error(
      "MongoDB was accessed outside a Cloudflare request context. A connection " +
        "opened here cannot be scoped to a request and would hang the worker."
    );
  }

  return context.ctx;
}

function requestConnection(request: RequestLifetime): RequestConnection {
  const existing = requestConnections.get(request);
  if (existing) return existing;

  // Created unopened so the Connection keeps one identity across retries: the
  // models compiled against it stay valid whichever attempt succeeds.
  const connection = mongoose.createConnection();

  const entry: RequestConnection = {
    connection,
    ready: withRetry(() =>
      connection.openUri(getMongoURI(), {
        ...BASE_OPTIONS,
        maxPoolSize: WORKER_MAX_POOL_SIZE,
      })
    ),
    background: new Set(),
  };

  // A failed open is surfaced to whoever awaits connectDB(). This second
  // handler exists only so that a caller which took the connection from
  // getActiveConnection() without awaiting connectDB() cannot turn the failure
  // into an unhandled rejection and take the isolate down with it.
  entry.ready.catch(() => {});

  requestConnections.set(request, entry);
  closeWhenRequestEnds(entry);
  return entry;
}

/**
 * Closes the request's connection once the response has been sent.
 *
 * `after()` is the only signal for "this request is finished"; `waitUntil` runs
 * its promise immediately, which would close the connection mid-query. It is
 * imported lazily and only on workerd so that Node never loads `next/server`
 * (the ops scripts and the test suite both import this module).
 */
function closeWhenRequestEnds(entry: RequestConnection): void {
  void import("next/server")
    .then(({ after }) => {
      after(async () => {
        // A failed open is reported to whoever awaited connectDB(); all this
        // needs is for the attempt to have settled.
        const opened = await entry.ready.then(
          () => true,
          () => false
        );
        if (!opened) return;

        // Click logging on the redirect path is deliberately fire-and-forget.
        // Draining it here keeps the close from cutting those writes off.
        while (entry.background.size > 0) {
          const pending = [...entry.background];
          entry.background.clear();
          await Promise.allSettled(pending);
        }

        try {
          // `destroy()`, not `close()`: close() leaves the Connection in
          // mongoose's module-scope `connections` array, so an isolate serving
          // many requests would accumulate one dead Connection and one set of
          // compiled models per request for its whole life. Verified against
          // mongoose 9.3.3: five closes leave five entries, five destroys
          // leave none.
          await entry.connection.destroy();
        } catch (err) {
          captureError(err, { operation: "db.closeRequestConnection" });
        }
      });
    })
    .catch((err) => {
      // The request still completes: the connection is live and the response
      // does not depend on it being closed. What is lost is the teardown, so
      // this connection stays in mongoose's registry for the life of the
      // isolate. Reported rather than absorbed, because a recurring version of
      // this is a slow leak rather than a one-off.
      captureError(err, { operation: "db.scheduleConnectionClose" });
    });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Opens (or reuses) the connection this caller should use and resolves once it
 * is ready. Must be awaited before any model is touched.
 */
export async function connectDB(): Promise<Connection> {
  const request = currentRequest();
  if (!request) return connectDefault();
  return requestConnection(request).ready;
}

/**
 * The connection the models in `src/models/` must bind to right now: the
 * current request's on workerd, the process-wide default under Node.
 *
 * Synchronous by necessity, since it is resolved on every model property
 * access. The Connection is returned whether or not it has finished opening;
 * `bufferCommands: false` means a query issued before `connectDB()` resolves
 * fails loudly rather than hanging.
 */
export function getActiveConnection(): Connection {
  const request = currentRequest();
  if (!request) return mongoose.connection;
  return requestConnection(request).connection;
}

/**
 * Keeps a fire-and-forget database write alive for the rest of the request.
 *
 * On workerd the connection closes as soon as the response is done, and work
 * that no one registered is cancelled with the request context, so a click
 * write started with a bare `void` would be dropped. Under Node this is a
 * no-op: the cached connection outlives the request either way.
 */
export function registerBackgroundDbWork(work: Promise<unknown>): void {
  const request = currentRequest();
  if (!request) return;

  requestConnections.get(request)?.background.add(work);
  request.waitUntil(work);
}
