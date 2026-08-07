/**
 * Upstash-backed sliding-window rate limiter, shared across public and
 * internal API routes.
 *
 * Usage:
 *   const rl = await rateLimit(`resolve:${ipHash}`, { tier: "public" });
 *   const rl = await rateLimit(`verify-pw:${ipHash}`, { limit: 5, windowMs: 60_000 });
 *
 * Callers pass a caller-scoped key (prefix it yourself, e.g. "resolve:<ipHash>")
 * plus either a documented tier or an explicit limit/window pair, and get back
 * { allowed, limit, remaining, retryAfterMs, degraded }.
 *
 * Upstash is optional infra: if UPSTASH_REDIS_REST_URL/TOKEN are absent, or the
 * Upstash call throws/times out, this falls back to a best-effort in-memory
 * limiter (per-instance only, so the effective limit scales with instance
 * count under fallback). The request is never allowed to 500 because of this,
 * and traffic is never silently unlimited: `degraded: true` marks results
 * produced by the fallback so callers/observability can tell the modes apart.
 */

import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { getRedis } from "@/lib/redis";
import { captureError } from "@/lib/errors";
import type { CallerAccess } from "@/lib/api-key-scope";

export type RateLimitTier = "public" | "authenticated";

const TIER_CONFIG: Record<RateLimitTier, { limit: number; windowMs: number }> = {
  public: { limit: 30, windowMs: 60_000 },
  authenticated: { limit: 100, windowMs: 60_000 },
};

export interface RateLimitOptions {
  /** One of the documented tiers (public: 30/min, authenticated: 100/min). */
  tier?: RateLimitTier;
  /** Explicit override for one-off limits (e.g. internal routes). Must be paired with windowMs. */
  limit?: number;
  /** Explicit override window, in milliseconds. Must be paired with limit. */
  windowMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  /** True when Upstash was unavailable and the in-memory fallback served this check. */
  degraded?: boolean;
}

function resolveConfig(options: RateLimitOptions): { limit: number; windowMs: number } {
  if (options.limit !== undefined && options.windowMs !== undefined) {
    return { limit: options.limit, windowMs: options.windowMs };
  }
  if (options.tier) return TIER_CONFIG[options.tier];
  throw new Error("rateLimit requires either a tier or an explicit limit + windowMs pair");
}

// --- Upstash-backed path ------------------------------------------------

// The Upstash client itself lives in `@/lib/redis`, shared with the
// domain-status cache so there is one connection policy for the whole app.

// One Ratelimit instance per distinct (limit, window) pair, reused across calls.
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(redis: Redis, limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      analytics: false,
      prefix: "hmdbio:ratelimit",
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

// --- In-memory fallback (best-effort, per-instance only) ---------------

interface MemoryEntry {
  timestamps: number[];
}

const memoryStore = new Map<string, MemoryEntry>();

// Cleanup stale entries every 60s so the fallback map doesn't grow unbounded.
const memoryCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 120_000);
    if (entry.timestamps.length === 0) memoryStore.delete(key);
  }
}, 60_000);
memoryCleanup.unref?.();

function memoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0];
    memoryStore.set(key, entry);
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterMs: windowMs - (now - oldest),
      degraded: true,
    };
  }

  entry.timestamps.push(now);
  memoryStore.set(key, entry);
  return {
    allowed: true,
    limit,
    remaining: limit - entry.timestamps.length,
    retryAfterMs: 0,
    degraded: true,
  };
}

// --- Public API ----------------------------------------------------------

/**
 * The share of an account's ceiling that any one API key may consume.
 *
 * The tier limits above are untouched: this only divides the existing
 * authenticated allowance, it does not add to it. Half is chosen so that a
 * single key can never take the whole account's allowance and leave the owner's
 * dashboard with nothing.
 *
 * Note the limit of this, honestly: with no cap on how many keys an account may
 * hold, two or more active keys can still exhaust the outer ceiling between
 * them. This bounds one key, not all keys collectively.
 */
const KEY_SHARE_OF_ACCOUNT = 0.5;

/** Identity the caller-scoped limiter needs. Structural, to avoid an import cycle. */
export interface RateLimitedCaller {
  user: { id: string };
  access: CallerAccess;
}

export interface CallerBucketKeys {
  /** The account ceiling. Always checked. */
  outer: string;
  /** The per-key bucket nested inside it, or null for a session. */
  inner: string | null;
}

/**
 * The one place a caller-scoped bucket key is derived.
 *
 * Twenty routes used to build `${scope}:${session.user.id}` by hand. A restated
 * derivation is the failure this codebase has produced repeatedly, so the
 * string is assembled here and nowhere else.
 *
 * The outer key keeps exactly the format it had, `${scope}:${userId}`, so no
 * live bucket resets on deploy and a session's behaviour is bit-identical to
 * before. The inner key carries the account id as well as the key id, so it
 * cannot collide with the outer key and does not rely on key ids being unique
 * across accounts to keep two accounts independent.
 */
export function callerBucketKeys(
  scope: string,
  caller: RateLimitedCaller
): CallerBucketKeys {
  const outer = `${scope}:${caller.user.id}`;

  // Keyed on the key's own id, so a session and a key on the same account land
  // in different inner buckets, and so do two keys on one account. A key with
  // no id (which resolveKeyAccess allows, for a document written without one)
  // gets no inner bucket rather than sharing one with every other such key.
  if (caller.access.via !== "api-key" || !caller.access.keyId) {
    return { outer, inner: null };
  }
  return { outer, inner: `${scope}:${caller.user.id}:key:${caller.access.keyId}` };
}

/**
 * Rate limit a request against the caller's nested buckets.
 *
 * Two levels: a per-key bucket at `KEY_SHARE_OF_ACCOUNT` of the tier limit,
 * nested inside the account ceiling at the full tier limit. The account total
 * is therefore unchanged, while one key can no longer consume all of it.
 *
 * The inner bucket is checked FIRST, and the outer is only consumed once the
 * inner has allowed the request. Doing it the other way round looks equivalent
 * and is not: a key hammering well past its own share would still burn a token
 * off the account ceiling on every refused attempt, so it could exhaust the
 * account and starve the owner's dashboard despite being throttled itself.
 * That defeats the entire purpose of the nesting, and the tests cover it.
 */
export async function rateLimitCaller(
  scope: string,
  caller: RateLimitedCaller,
  options: RateLimitOptions = { tier: "authenticated" }
): Promise<RateLimitResult> {
  const { outer, inner } = callerBucketKeys(scope, caller);

  if (inner !== null) {
    const { limit, windowMs } = resolveConfig(options);
    const innerResult = await rateLimit(inner, {
      // `max(1, ...)` so a route with an explicit limit of 1 does not floor to
      // zero and refuse a key outright.
      limit: Math.max(1, Math.floor(limit * KEY_SHARE_OF_ACCOUNT)),
      windowMs,
    });
    // Report the inner limit and retry delay, which is what actually applies to
    // this caller, rather than the account's.
    if (!innerResult.allowed) return innerResult;
  }

  return rateLimit(outer, options);
}

export async function rateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const { limit, windowMs } = resolveConfig(options);
  const redis = getRedis();

  if (!redis) {
    captureError(new Error("Upstash env vars not configured; degraded to in-memory rate limiter"), {
      module: "rate-limit",
      key,
    });
    return memoryRateLimit(key, limit, windowMs);
  }

  try {
    const limiter = getLimiter(redis, limit, windowMs);
    const result = await limiter.limit(key);
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: Math.max(0, result.remaining),
      retryAfterMs: Math.max(0, result.reset - Date.now()),
    };
  } catch (error) {
    captureError(error, { module: "rate-limit", key, degraded: true });
    return memoryRateLimit(key, limit, windowMs);
  }
}
