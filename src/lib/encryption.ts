import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.IP_ENCRYPTION_KEY || "";
  if (hex.length !== 64) {
    throw new Error("IP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns ciphertext (hex, includes auth tag) and iv (hex).
 */
export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("hex"),
    iv: iv.toString("hex"),
  };
}

/**
 * Decrypt ciphertext (hex, with appended auth tag) using iv (hex).
 * Returns plaintext string, or empty string on failure.
 */
export function decrypt(ciphertext: string, iv: string): string {
  try {
    const key = getKey();
    const buf = Buffer.from(ciphertext, "hex");
    const ivBuf = Buffer.from(iv, "hex");
    const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
    const encrypted = buf.subarray(0, buf.length - AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, ivBuf, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final("utf8");
  } catch {
    return "";
  }
}
