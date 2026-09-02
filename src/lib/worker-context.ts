/**
 * The current Cloudflare request context, or null when there is not one.
 *
 * OpenNext wraps the whole `fetch` handler (middleware included, see
 * `.open-next/worker.js`) in `runWithCloudflareRequestContext`, which stores
 * `{ env, ctx }` on a well-known global symbol backed by AsyncLocalStorage. The
 * symbol is read directly rather than through `getCloudflareContext()` so that
 * this module stays a pure ES module with no dependency on the Cloudflare
 * adapter: it is imported from the middleware bundle, from route handlers, and
 * from the ops scripts in `scripts/`, and only one of those can resolve
 * `@opennextjs/cloudflare`.
 *
 * `src/lib/db.ts` reads the same symbol but must *throw* when the context is
 * absent, because a MongoDB connection opened outside a request can never be
 * closed and hangs the isolate. Nothing here is load-bearing in that way: an
 * absent context means "no cache, no deferred work", which every caller
 * degrades through. The two readers are therefore deliberately separate rather
 * than shared.
 */

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

/** The slice of Cloudflare's `ExecutionContext` this codebase uses. */
export interface RequestLifetime {
  waitUntil(promise: Promise<unknown>): void;
}

interface CloudflareContext {
  env?: Record<string, unknown>;
  ctx?: RequestLifetime;
}

function readContext(): CloudflareContext | null {
  const context = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT];
  if (!context || typeof context !== "object") return null;
  return context as CloudflareContext;
}

/**
 * The bindings this codebase may read.
 *
 * Deliberately a closed union rather than `string`: OpenNext's `env` carries
 * every secret and plain variable alongside the real bindings, so an
 * unconstrained accessor would make `getBinding("INTERNAL_SECRET")` a working
 * call and invite a future reader to pull a credential somewhere it gets
 * logged. Adding a binding here is a deliberate act.
 */
type BindingName = "LINK_CACHE";

/**
 * A named Worker binding, or null under Node, in tests, or when the binding is
 * not configured. Callers must treat null as "this infrastructure is absent"
 * and fall back to their own source of truth.
 */
export function getBinding<T>(name: BindingName): T | null {
  const env = readContext()?.env;
  if (!env) return null;

  const binding = env[name];
  return binding === undefined || binding === null ? null : (binding as T);
}

/**
 * Runs `work` after the response has been sent, and reports whether it could be
 * scheduled at all.
 *
 * A `false` return is not a detail to ignore: it means the promise will be
 * cancelled with the request context on workerd, so a caller whose work must
 * not be lost has to do it in the foreground instead.
 */
export function deferUntilResponseSent(work: Promise<unknown>): boolean {
  const ctx = readContext()?.ctx;
  if (!ctx) return false;

  ctx.waitUntil(work);
  return true;
}
