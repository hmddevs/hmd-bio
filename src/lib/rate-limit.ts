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
import { Redis } from "@upstash/redis";
import { captureError } from "@/lib/errors";

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

let redisClient: Redis | null | undefined; // undefined = not yet resolved

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

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
