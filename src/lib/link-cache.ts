/**
 * Workers KV cache for short-link resolution.
 *
 * The redirect is the product, and on Cloudflare every resolution cost two
 * round trips: the middleware fetched its own `/api/internal/resolve` out
 * through the public edge, and that endpoint opened a fresh MongoDB connection
 * (TCP, TLS, SCRAM, hello) because a socket cannot outlive its request on
 * workerd. Measured against production: a median of 3.4s. A cache hit answers
 * without either.
 *
 * Note what that does and does not buy. The *response* stops depending on
 * MongoDB; the *request* does not. A hit still calls the resolve endpoint from
 * `waitUntil` so the click is logged, and that call opens its own Atlas
 * connection, so database load per redirect is unchanged. Taking MongoDB off
 * the request entirely needs a click-only endpoint, which is a separate change.
 *
 * Optional infrastructure, exactly like Redis in `src/lib/redis.ts`: with no
 * `LINK_CACHE` binding every function below degrades to "no cache" and the
 * caller falls back to MongoDB. Nothing on the redirect path may depend on this
 * being present.
 *
 * ── What is cached ──
 *
 * Only links on the primary domain, and only those with no per-platform
 * targets. Everything else resolves exactly as it did before:
 *
 *   - A custom domain only serves links while its Domain record is `active`
 *     (`isDomainServable`). That gate is keyed by hostname, not by link, so no
 *     link write would invalidate it and a suspended tenant would keep
 *     resolving from cache. Custom domains are therefore not cached at all
 *     rather than cached with a gate that cannot be invalidated.
 *   - A link with `targets` resolves to a different URL per platform. Caching
 *     the resolved value would serve one platform's deeplink to every other,
 *     and caching the whole target list would drag user-agent parsing into the
 *     middleware bundle for a feature only custom domains use.
 *
 * ── What is cached but still evaluated per request ──
 *
 * Expiry and password protection are stored as data, never baked into the
 * answer. The middleware re-checks `expiresAt` against the clock on every hit
 * and falls through to the live path once it has passed, and it rewrites to the
 * unlock page whenever `isPasswordProtected` is set. A cached entry is an
 * answer to "what does this link say", never to "may this request follow it".
 *
 * ── Freshness ──
 *
 * Three mechanisms, in order of how much work they do:
 *
 *   1. **Explicit invalidation.** Every writer that can change what a link
 *      resolves to calls `invalidateCachedLink` for the keys it touched, and
 *      awaits it before answering, so the caller that made the change is never
 *      the one that sees the old value.
 *   2. **Repair on the next request.** `refreshCachedLink` runs behind every
 *      resolution, corrects an entry whose value has drifted, and *deletes* the
 *      key when the link has gone or stopped being cacheable. This matters more
 *      than it looks: an invalidation can be lost, either because the KV delete
 *      failed or because a resolution that was already in flight rewrote the key
 *      afterwards, and without a repair path nothing would ever notice. It also
 *      means staleness is bounded by "one request plus
 *      `READ_CACHE_TTL_SECONDS`", not by the entry's TTL, since any request that
 *      could be harmed by a stale entry is itself the request that repairs it.
 *   3. **`ENTRY_TTL_SECONDS`.** The backstop for an entry nothing repaired,
 *      which by definition is one nobody is asking for.
 *
 * `READ_CACHE_TTL_SECONDS` is therefore the real worst-case staleness, because a
 * colo may keep serving its own copy for that long after a delete lands. It is
 * set to the 60s this platform already accepts for the domain-status cache
 * (`src/lib/domain-cache.ts`), so there is one staleness budget rather than two.
 */

import { parseHttpUrl } from "@/lib/deeplink";
import { getBinding } from "@/lib/worker-context";

/**
 * Bumped whenever the shape of a cached entry changes. Old keys are then simply
 * never read again and age out on their own TTL, so a deploy never has to
 * migrate or purge the namespace.
 */
const KEY_VERSION = "v1";

/** Cloudflare's hard limit on a KV key. */
const MAX_KEY_BYTES = 512;

/**
 * How long an entry survives without being rewritten.
 *
 * Set from the traffic shape, not from a freshness budget. hmd.bio serves on the
 * order of 75 redirects a day across 299 links, so consecutive visits to the
 * same link are usually minutes or hours apart: at the five minutes this
 * started at, the cache emptied between real visitors and almost every request
 * paid the uncached 3.4s anyway. An hour is long enough that a link shared in a
 * conversation stays hot for the burst of clicks that follows it.
 *
 * That is only safe because the TTL is not what keeps entries honest. Explicit
 * invalidation is, and behind it `refreshCachedLink` corrects or removes an
 * entry on the next request for it. What the TTL actually bounds is the double
 * failure: a writer's delete fails *and* every later repair also fails. That
 * needs a sustained KV write outage, which is reporting to Sentry the whole
 * time, so an hour is a bound someone would act on well before it elapsed.
 *
 * KV's own minimum is 60s.
 */
export const ENTRY_TTL_SECONDS = 3600;

/**
 * How long a colo may answer from its own copy before re-reading central KV.
 *
 * This, not `ENTRY_TTL_SECONDS`, is the window in which an edited link can
 * still redirect to its old target. Matched to the 60s already accepted for the
 * domain-status cache. Lowering it would shorten that window at the cost of a
 * central read on more requests.
 */
export const READ_CACHE_TTL_SECONDS = 60;

/**
 * The age at which an unchanged entry is rewritten purely to extend its life.
 *
 * Half of `ENTRY_TTL_SECONDS`, so a link under any traffic keeps its entry
 * indefinitely and never pays a cold resolution, while an idle link's entry
 * still ages out. Without it, `refreshCachedLink` would leave an unchanged entry
 * alone until it expired and every link would take one uncached 3.4s request per
 * TTL however busy it was.
 */
const REFRESH_AFTER_SECONDS = ENTRY_TTL_SECONDS / 2;

/**
 * The subset of `KVNamespace` used here, typed structurally so that nothing in
 * `src/` depends on the Workers type package.
 */
interface LinkCacheStore {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  getWithMetadata(
    key: string,
    options?: { cacheTtl?: number }
  ): Promise<{ value: string | null; metadata: unknown }>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown }
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Everything the middleware needs to answer a request without MongoDB. */
export interface CachedLink {
  url: string;
  statusCode: 301 | 302;
  isPasswordProtected: boolean;
  forwardPath: boolean;
  forwardQuery: boolean;
  /** Epoch milliseconds, or null for a link that never expires. */
  expiresAt: number | null;
}

/** The fields of a link document this module reads. */
export interface ResolvedLink {
  url: string;
  statusCode?: number | null;
  isPasswordProtected?: boolean | null;
  forwardPath?: boolean | null;
  forwardQuery?: boolean | null;
  expiresAt?: Date | string | null;
  targets?: unknown[] | null;
}

function getStore(): LinkCacheStore | null {
  return getBinding<LinkCacheStore>("LINK_CACHE");
}

/**
 * The KV key for a link, or null when it would exceed Cloudflare's key limit.
 *
 * `domain` has already been through `normaliseHost`, which strips ports, so the
 * separator cannot be ambiguous.
 */
export function linkCacheKey(domain: string, keyword: string): string | null {
  const key = `link:${KEY_VERSION}:${domain}:${keyword}`;
  return new TextEncoder().encode(key).length > MAX_KEY_BYTES ? null : key;
}

/**
 * Reads a cached entry, treating anything unexpected as a miss.
 *
 * A KV outage, a truncated value, or an entry written by an older shape all
 * land here as `null`, which sends the caller to MongoDB and produces exactly
 * the behaviour that existed before this cache. That is degradation to the
 * source of truth, not a swallowed failure: no request is answered wrongly and
 * none is answered at all on the strength of a value that did not parse.
 */
export async function readCachedLink(
  domain: string,
  keyword: string
): Promise<CachedLink | null> {
  const store = getStore();
  if (!store) return null;

  const key = linkCacheKey(domain, keyword);
  if (!key) return null;

  let raw: string | null;
  try {
    raw = await store.get(key, { cacheTtl: READ_CACHE_TTL_SECONDS });
  } catch {
    return null;
  }
  if (!raw) return null;

  return parseCachedLink(raw);
}

/**
 * Validates a stored entry before it is allowed to produce a redirect.
 *
 * KV is not a schema-checked store and its contents are not what MongoDB
 * validated on write, so every field is re-checked here and the URL is put
 * through the same http(s) test the fallback path applies. A value that fails
 * any of it is a miss, so the worst a corrupt entry can do is cost one
 * uncached resolution.
 */
export function parseCachedLink(raw: string): CachedLink | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;

  if (typeof entry.url !== "string" || !parseHttpUrl(entry.url)) return null;
  if (entry.statusCode !== 301 && entry.statusCode !== 302) return null;
  if (typeof entry.isPasswordProtected !== "boolean") return null;
  if (typeof entry.forwardPath !== "boolean") return null;
  if (typeof entry.forwardQuery !== "boolean") return null;

  const expiresAt = entry.expiresAt;
  if (expiresAt !== null && (typeof expiresAt !== "number" || !Number.isFinite(expiresAt))) {
    return null;
  }

  return {
    url: entry.url,
    statusCode: entry.statusCode,
    isPasswordProtected: entry.isPasswordProtected,
    forwardPath: entry.forwardPath,
    forwardQuery: entry.forwardQuery,
    expiresAt,
  };
}

/** True once the link's own expiry has passed. Re-evaluated on every hit. */
export function isCachedLinkExpired(entry: CachedLink, now: number = Date.now()): boolean {
  return entry.expiresAt !== null && entry.expiresAt <= now;
}

/**
 * The entry to store for a link, or null when the link must not be cached.
 *
 * Also returns the TTL, which is capped by the link's own expiry so that an
 * expiring link can never outlive itself in KV even if every reader forgot to
 * check. A link with under a minute left is not cached at all, since KV's
 * minimum `expirationTtl` is 60s and the entry would outlive the link.
 */
export function buildCacheEntry(
  domain: string,
  primaryDomain: string,
  link: ResolvedLink,
  now: number = Date.now()
): { value: CachedLink; ttlSeconds: number } | null {
  if (domain !== primaryDomain) return null;
  if (Array.isArray(link.targets) && link.targets.length > 0) return null;
  if (typeof link.url !== "string" || !parseHttpUrl(link.url)) return null;

  const expiresAt = link.expiresAt ? new Date(link.expiresAt).getTime() : null;
  if (expiresAt !== null && !Number.isFinite(expiresAt)) return null;

  let ttlSeconds = ENTRY_TTL_SECONDS;
  if (expiresAt !== null) {
    const remaining = Math.floor((expiresAt - now) / 1000);
    if (remaining < 60) return null;
    ttlSeconds = Math.min(ttlSeconds, remaining);
  }

  return {
    value: {
      url: link.url,
      // Mirrors `link.statusCode || 301` in the resolve endpoint, absent value
      // included. The cached and uncached paths must answer with the same
      // status for the same document, and matching the incumbent is how to get
      // that without changing what a live link does today.
      statusCode: link.statusCode === 302 ? 302 : 301,
      isPasswordProtected: link.isPasswordProtected === true,
      forwardPath: link.forwardPath === true,
      forwardQuery: link.forwardQuery === true,
      expiresAt,
    },
    ttlSeconds,
  };
}

/** Written alongside each entry so its age can be read back. */
interface EntryMetadata {
  writtenAt: number;
}

function writtenAt(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).writtenAt;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Brings the stored entry into line with what a resolution just found.
 *
 * Pass `null` for `entry` when the link did not resolve, or resolved to
 * something that must not be cached. That is what makes this a repair path
 * rather than a write path: a deleted, expired or newly deeplinked link has its
 * key removed by the next request that asks for it, so a stale entry cannot
 * survive an invalidation that was lost.
 *
 * Writes only when the value has actually drifted, or when the entry is old
 * enough to be worth extending. Blind writing was the obvious implementation and
 * the wrong one: a resolution runs behind every cache hit, so a link taking any
 * real traffic would write the same key many times a second, and KV rejects more
 * than one write per key per second. That would turn a busy link into a stream
 * of 429s and, since this function reports rather than absorbs, a matching
 * stream of Sentry events.
 *
 * Rejects on a KV failure rather than absorbing it: every caller runs in a route
 * handler that already reports to Sentry, and a cache that has quietly stopped
 * accepting writes looks exactly like the latency regression this module exists
 * to fix.
 */
export async function refreshCachedLink(
  domain: string,
  keyword: string,
  entry: { value: CachedLink; ttlSeconds: number } | null,
  now: number = Date.now()
): Promise<void> {
  const store = getStore();
  if (!store) return;

  const key = linkCacheKey(domain, keyword);
  if (!key) return;

  if (!entry) {
    await store.delete(key);
    return;
  }

  const serialised = JSON.stringify(entry.value);
  const current = await store.getWithMetadata(key, { cacheTtl: READ_CACHE_TTL_SECONDS });

  if (current.value === serialised) {
    const age = writtenAt(current.metadata);
    // An entry whose age cannot be read is rewritten, so a value stored by an
    // earlier build without metadata is not stranded until it expires.
    if (age !== null && now - age < REFRESH_AFTER_SECONDS * 1000) return;
  }

  const metadata: EntryMetadata = { writtenAt: now };
  await store.put(key, serialised, { expirationTtl: entry.ttlSeconds, metadata });
}

/**
 * Drops a link's cached resolution.
 *
 * Called by every writer that can change what a link resolves to, and awaited
 * before the writer answers its caller, so the request that made the change is
 * never the one that observes the stale value. Rejects on failure for the same
 * reason as `writeCachedLink`.
 */
export async function invalidateCachedLink(domain: string, keyword: string): Promise<void> {
  const store = getStore();
  if (!store) return;

  const key = linkCacheKey(domain, keyword);
  if (!key) return;

  await store.delete(key);
}

/**
 * Drops several keys on one domain, de-duplicated.
 *
 * A rename touches two keys: the keyword the link had, whose entry would
 * otherwise keep resolving to a link that no longer answers to it, and the one
 * it now has, which may hold an entry from an earlier link of the same name.
 */
export async function invalidateCachedLinks(
  domain: string,
  keywords: readonly string[]
): Promise<void> {
  const unique = [...new Set(keywords.filter((keyword) => keyword))];
  await Promise.all(unique.map((keyword) => invalidateCachedLink(domain, keyword)));
}
