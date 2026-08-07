/**
 * Short-TTL cache for a custom domain's deeplink configuration.
 *
 * Companion to domain-cache.ts, kept separate because the questions have
 * different shapes: "may this host serve?" is a boolean on the hot redirect
 * path, while this is a small document read only by the paths a deeplink
 * domain adds (the association files, a multi-segment request, and the
 * not-found fallback). Nothing on the existing redirect path calls it.
 *
 * Redis is optional infrastructure: if it is unconfigured or unreachable this
 * falls through to MongoDB. The association files must keep being served with
 * the cache down, otherwise Apple and Google can un-verify a customer's app.
 */

import { Domain } from "@/models/Domain";
import { getRedis } from "@/lib/redis";
import { captureError } from "@/lib/errors";
import { PRIMARY_DOMAIN, normaliseHost } from "@/lib/domains";
import type { DomainConfig } from "@/lib/deeplink";

/**
 * Sixty seconds, matching domain-cache. It bounds how long a domain switched
 * back to `shortener`, or suspended, can keep serving its association files.
 */
const TTL_SECONDS = 60;

function cacheKey(hostname: string): string {
  return `domain-config:${hostname}`;
}

/**
 * Last-resort negative cache, in the process's own memory.
 *
 * This is not a substitute for Upstash: Redis is still the cache, and it is
 * consulted first. It exists because the proxy has to know the mode *before* it
 * knows whether a path is a deeplink path, so with Redis down every request to
 * a plain shortener domain would otherwise open a fresh Mongo round trip on
 * paths that previously cost nothing at all (an association-file 404, any
 * multi-segment URL). Bounding that to one read per TTL per instance is the
 * whole point.
 *
 * Only "this host is not a deeplink domain" is ever stored, so the cost of a
 * stale entry is capped at a domain taking up to TTL_SECONDS to start serving
 * after being switched on, which is exactly what the Redis TTL already allows.
 * Turning deeplink mode *off*, or suspending a domain, is the direction that
 * matters, and that answer is negative too, so it is never served from a stale
 * positive.
 */
interface NegativeEntry {
  expiresAt: number;
  /** The exact answer that was negative: null, or a shortener-mode config. */
  config: DomainConfig | null;
}

const negativeMemo = new Map<string, NegativeEntry>();

function memoisedNegative(host: string): NegativeEntry | undefined {
  const entry = negativeMemo.get(host);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    negativeMemo.delete(host);
    return undefined;
  }
  return entry;
}

function rememberNegative(host: string, config: DomainConfig | null): void {
  if (config && config.mode === "deeplink") {
    negativeMemo.delete(host);
    return;
  }
  // Unbounded growth is not a concern in practice (one entry per active
  // hostname per instance), but a hard cap keeps a hostile burst of unknown
  // hosts from being a memory lever.
  if (negativeMemo.size > 1000) negativeMemo.clear();
  negativeMemo.set(host, { expiresAt: Date.now() + TTL_SECONDS * 1000, config });
}

/**
 * The deeplink configuration for a hostname, or null when there is nothing to
 * serve.
 *
 * Null covers every case that must behave exactly as today: the primary
 * domain, an unknown hostname, and any domain that is not `active`. Status is
 * part of the query rather than a separate check so a suspended domain cannot
 * keep serving association files or a fallback redirect.
 */
export async function getDomainConfig(hostname: string): Promise<DomainConfig | null> {
  const host = normaliseHost(hostname);
  if (!host) return null;
  // The platform's own domain is never a deeplink tenant, and must never serve
  // a tenant's association file.
  if (host === PRIMARY_DOMAIN) return null;

  const redis = getRedis();

  if (redis) {
    try {
      const cached = await redis.get<DomainConfig | "none">(cacheKey(host));
      if (cached === "none") return null;
      if (cached && typeof cached === "object") return cached;
    } catch (err) {
      // Cache read failed: fall through to MongoDB rather than dropping the
      // association file. Reported so a persistently broken cache is visible.
      captureError(err, { module: "domain-config-cache", stage: "read" });
    }
  }

  // Reached only when Redis is unconfigured or did not answer. Serves the
  // non-deeplink answer without a Mongo round trip, so a shortener domain does
  // not start paying per request the moment the cache goes away.
  const memoised = memoisedNegative(host);
  if (memoised) return memoised.config;

  const doc = await Domain.findOne(
    { hostname: host, status: "active" },
    { mode: 1, appLinks: 1, fallbackTarget: 1 }
  ).lean();

  const config: DomainConfig | null = doc
    ? {
        mode: doc.mode === "deeplink" ? "deeplink" : "shortener",
        aasa: doc.appLinks?.aasa ?? null,
        assetlinks: doc.appLinks?.assetlinks ?? null,
        fallbackTarget: doc.fallbackTarget ?? null,
      }
    : null;

  rememberNegative(host, config);

  if (redis) {
    try {
      await redis.set(cacheKey(host), config ?? "none", { ex: TTL_SECONDS });
    } catch (err) {
      captureError(err, { module: "domain-config-cache", stage: "write" });
    }
  }

  return config;
}

/**
 * Drops the cached configuration for a hostname. Call this whenever a Domain's
 * mode, association files, fallback target, or status changes. Best-effort: a
 * failure only means the change takes up to TTL_SECONDS to take effect.
 *
 * A write path that edits mode, appLinks, or fallbackTarget must call this
 * directly. Those edits leave `status` untouched, so `invalidateDomainStatus`
 * never runs for them and nothing else will clear the key: switching a domain
 * to deeplink mode, or replacing an association file, would otherwise appear to
 * do nothing for up to TTL_SECONDS.
 */
export async function invalidateDomainConfig(hostname: string): Promise<void> {
  const host = normaliseHost(hostname);
  if (!host || host === PRIMARY_DOMAIN) return;

  // Cleared first and unconditionally: the in-process fallback must not outlive
  // an explicit invalidation just because Redis happens to be unavailable.
  // Only this instance's copy is dropped, which is why the entry is bounded by
  // TTL_SECONDS rather than relying on invalidation alone.
  negativeMemo.delete(host);

  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(cacheKey(host));
  } catch (err) {
    captureError(err, { module: "domain-config-cache", stage: "invalidate" });
  }
}
