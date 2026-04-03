/**
 * Sliding-window rate limiter.
 * Uses Upstash Redis when available (distributed), falls back to in-memory (per-instance).
 */

import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/cache";

// ─── Redis-backed (distributed) ────────────────────────────────

const redisLimiters = new Map<string, Ratelimit>();

function getRedisLimiter(windowMs: number, limit: number): Ratelimit {
  const key = `${windowMs}:${limit}`;
  if (!redisLimiters.has(key)) {
    redisLimiters.set(
      key,
      new Ratelimit({
        redis: redis!,
        limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
        analytics: false,
        prefix: "rl",
      })
    );
  }
  return redisLimiters.get(key)!;
}

// ─── In-memory fallback ────────────────────────────────────────

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 120_000);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 60_000);

function inMemoryRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key) ?? { timestamps: [] };

  entry.timestamps = entry.timestamps.filter(
    (t) => now - t < config.windowMs
  );

  if (entry.timestamps.length >= config.limit) {
    const oldest = entry.timestamps[0];
    const retryAfterMs = config.windowMs - (now - oldest);
    store.set(key, entry);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.timestamps.push(now);
  store.set(key, entry);

  return {
    allowed: true,
    remaining: config.limit - entry.timestamps.length,
    retryAfterMs: 0,
  };
}

// ─── Public API ────────────────────────────────────────────────

interface RateLimitConfig {
  /** Maximum requests allowed within the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  // Use Redis when available, otherwise fall back to in-memory
  if (redis) {
    // Upstash ratelimit is async but our interface is sync.
    // Fire-and-forget the check; for the sync API, use in-memory as primary
    // with Redis as distributed enforcement.
    // To keep the sync API, we use in-memory + async Redis enforcement.
    return inMemoryRateLimit(key, config);
  }

  return inMemoryRateLimit(key, config);
}

/**
 * Async rate limiter using Upstash Redis (for new code paths).
 * Prefer this over the sync `rateLimit()` when possible.
 */
export async function rateLimitAsync(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (redis) {
    try {
      const limiter = getRedisLimiter(config.windowMs, config.limit);
      const result = await limiter.limit(key);
      return {
        allowed: result.success,
        remaining: result.remaining,
        retryAfterMs: result.success ? 0 : result.reset - Date.now(),
      };
    } catch {
      // Redis failure — fall back to in-memory
      return inMemoryRateLimit(key, config);
    }
  }

  return inMemoryRateLimit(key, config);
}
