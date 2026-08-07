/**
 * Short-TTL cache for "may this hostname serve short links?".
 *
 * Resolution has to answer that question on every redirect to a custom domain,
 * and the answer changes rarely (a domain goes active once, and is suspended by
 * an admin at most occasionally). Without a cache, every redirect pays an extra
 * MongoDB round trip for a Domain document that almost never changes.
 *
 * Redis is optional infrastructure: if it is unconfigured or unreachable, every
 * function here silently falls through to MongoDB. A redirect must never fail
 * because the cache is down.
 */

import { Domain } from "@/models/Domain";
import { getRedis } from "@/lib/redis";
import { captureError } from "@/lib/errors";
import { PRIMARY_DOMAIN, normaliseHost } from "@/lib/domains";
import { invalidateDomainConfig } from "@/lib/domain-config-cache";

/**
 * Sixty seconds. Deliberately short: it bounds how long a suspended domain can
 * keep resolving, which is the failure mode that matters. Admin suspension
 * should still call `invalidateDomainStatus` for an immediate effect rather
 * than relying on expiry.
 */
const TTL_SECONDS = 60;

function cacheKey(hostname: string): string {
  return `domain-status:${hostname}`;
}

/**
 * Last-resort negative cache, in the process's own memory. Mirrors the one in
 * domain-config-cache.ts, including its TTL and its cap, and exists for the
 * same reason: with Redis down, this function issues a fresh `Domain.exists`
 * per request, so an unauthenticated loop over unknown paths on a custom
 * domain becomes a Mongo query amplifier during precisely the outage the
 * server-rendered fallback exists to survive.
 *
 * Only "this hostname may not serve" is ever stored. A stale entry therefore
 * costs a newly activated domain up to TTL_SECONDS before it starts resolving,
 * which is exactly what the Redis TTL already allows, and suspension (the
 * direction that matters) is never served from a stale positive because no
 * positive is ever memoised.
 */
const negativeMemo = new Map<string, number>();

function memoisedUnservable(host: string): boolean {
  const expiresAt = negativeMemo.get(host);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    negativeMemo.delete(host);
    return false;
  }
  return true;
}

function rememberUnservable(host: string, servable: boolean): void {
  if (servable) {
    negativeMemo.delete(host);
    return;
  }
  // Unbounded growth is not a concern in practice (one entry per hostname per
  // instance), but a hard cap keeps a hostile burst of unknown hosts from
  // being a memory lever.
  if (negativeMemo.size > 1000) negativeMemo.clear();
  negativeMemo.set(host, Date.now() + TTL_SECONDS * 1000);
}

/**
 * True when the hostname may serve short links right now.
 *
 * The primary domain always may, and is answered without touching Redis or
 * MongoDB. A custom domain may only if a Domain record exists for it with
 * status `active`: pending, verifying, provisioning, failed, and suspended all
 * return false, so an unverified or suspended domain resolves to nothing.
 */
export async function isDomainServable(hostname: string): Promise<boolean> {
  const host = normaliseHost(hostname);
  if (!host) return false;
  if (host === PRIMARY_DOMAIN) return true;

  const redis = getRedis();

  if (redis) {
    try {
      const cached = await redis.get<string | number>(cacheKey(host));
      if (cached !== null && cached !== undefined) {
        return String(cached) === "1";
      }
    } catch (err) {
      // Cache read failed: fall through to MongoDB rather than failing the
      // redirect. Reported so a persistently broken cache is visible.
      captureError(err, { module: "domain-cache", stage: "read" });
    }
  }

  // Reached only when Redis is unconfigured or did not answer. Serves the
  // negative answer without a Mongo round trip, so an unknown or suspended
  // host does not start paying per request the moment the cache goes away.
  if (memoisedUnservable(host)) return false;

  const active = await Domain.exists({ hostname: host, status: "active" });
  const servable = active !== null;

  rememberUnservable(host, servable);

  if (redis) {
    try {
      await redis.set(cacheKey(host), servable ? "1" : "0", { ex: TTL_SECONDS });
    } catch (err) {
      captureError(err, { module: "domain-cache", stage: "write" });
    }
  }

  return servable;
}

/**
 * Drops the cached answer for a hostname, so the next resolution re-reads
 * MongoDB. Call this whenever a Domain's status changes (activation,
 * suspension, deletion). Best-effort: a failure here only means the change
 * takes up to TTL_SECONDS to take effect.
 *
 * The deeplink configuration cache is dropped alongside it. Both are keyed on
 * the same document and both are gated on `status: "active"`, so a suspension
 * that cleared only one of them would leave a suspended domain still serving
 * its association files.
 */
export async function invalidateDomainStatus(hostname: string): Promise<void> {
  const host = normaliseHost(hostname);
  if (!host || host === PRIMARY_DOMAIN) return;

  await invalidateDomainConfig(host);

  // Cleared first and unconditionally: the in-process fallback must not
  // outlive an explicit invalidation just because Redis is unavailable. Only
  // this instance's copy is dropped, which is why the entry is bounded by
  // TTL_SECONDS rather than relying on invalidation alone.
  negativeMemo.delete(host);

  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(cacheKey(host));
  } catch (err) {
    captureError(err, { module: "domain-cache", stage: "invalidate" });
  }
}
