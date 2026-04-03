import { Redis } from "@upstash/redis";

/**
 * Upstash Redis cache for link resolution and stats.
 * Edge-compatible (REST-based, no TCP).
 *
 * Required env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// ─── Link Resolution Cache ────────────────────────────────────

export interface CachedLink {
  url: string;
  statusCode: number;
  isPasswordProtected: boolean;
}

const LINK_PREFIX = "link:";
const LINK_TTL = 3600; // 1 hour

export async function getCachedLink(
  keyword: string
): Promise<CachedLink | null> {
  if (!redis) return null;
  try {
    return await redis.get<CachedLink>(`${LINK_PREFIX}${keyword}`);
  } catch {
    return null;
  }
}

export async function setCachedLink(
  keyword: string,
  data: CachedLink
): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(`${LINK_PREFIX}${keyword}`, data, { ex: LINK_TTL });
  } catch {
    // Cache write failures are non-critical
  }
}

export async function invalidateCachedLink(keyword: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(`${LINK_PREFIX}${keyword}`);
  } catch {
    // Cache invalidation failures are non-critical
  }
}

// ─── Stats Cache ───────────────────────────────────────────────

const STATS_PREFIX = "stats:";
const STATS_TTL = 300; // 5 minutes

export async function getCachedStats<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    return await redis.get<T>(`${STATS_PREFIX}${key}`);
  } catch {
    return null;
  }
}

export async function setCachedStats<T>(
  key: string,
  data: T,
  ttl: number = STATS_TTL
): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(`${STATS_PREFIX}${key}`, data, { ex: ttl });
  } catch {
    // Cache write failures are non-critical
  }
}

// ─── Re-export redis for rate limiter ──────────────────────────

export { redis };
