import { createHash } from "crypto";

/**
 * SHA-256 hash of a raw API key, for storage/lookup. The raw key is
 * high-entropy (32 random bytes), so a fast hash is sufficient — this is
 * not a password requiring bcrypt-style stretching.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
