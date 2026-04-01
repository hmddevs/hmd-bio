import { createHash } from "crypto";

const IP_SALT = process.env.IP_HASH_SALT || "hmd-bio-default-salt";

/**
 * One-way hash an IP address for GDPR compliance.
 * Retains groupability (same IP → same hash) without storing the raw IP.
 */
export function hashIP(ip: string): string {
  if (!ip) return "";
  return createHash("sha256")
    .update(IP_SALT + ip)
    .digest("hex")
    .slice(0, 16);
}
