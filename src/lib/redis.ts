/**
 * Shared Upstash Redis client.
 *
 * Redis is optional infrastructure here: when UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are absent this returns null and every caller must
 * degrade to its own source of truth (MongoDB, or an in-memory fallback).
 * Nothing on the redirect path may depend on Redis being reachable.
 *
 * The client is memoised per instance. `undefined` means "not yet resolved",
 * `null` means "resolved, and Redis is not configured".
 */

import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;

  return client;
}
