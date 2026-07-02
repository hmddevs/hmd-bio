import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const IP_SALT = process.env.IP_HASH_SALT;

if (!IP_SALT) {
  throw new Error(
    "IP_HASH_SALT is not set — refusing to hash IPs with a fallback salt."
  );
}

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

// IP_ENCRYPTION_KEY must be a 64-char hex string (32-byte AES-256 key).
const ENCRYPTION_ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const hex = process.env.IP_ENCRYPTION_KEY || "";
  if (hex.length !== 64) {
    throw new Error(
      "IP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)."
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * AES-256-GCM encrypt an IP for admin-only decryption. Never used for
 * matching/searching — pair with hashIP() for that.
 */
export function encryptIP(ip: string): { iv: string; ciphertext: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([cipher.update(ip, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    ciphertext: Buffer.concat([encrypted, authTag]).toString("hex"),
  };
}

/**
 * Reverse of encryptIP(). Admin-only decryption path. Returns an empty
 * string on any failure (corrupt data, wrong key) rather than throwing.
 */
export function decryptIP(ivHex: string, ciphertextHex: string): string {
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const combined = Buffer.from(ciphertextHex, "hex");
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}
