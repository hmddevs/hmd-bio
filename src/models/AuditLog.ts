import mongoose, { Schema, Document, Model } from "mongoose";
import {
  AUDIT_ACTIONS,
  AUDIT_SUBJECT_TYPES,
  type AuditAction,
  type AuditSubjectType,
  type AuditDetail,
} from "../lib/audit-record";

/**
 * Administrative audit trail.
 *
 * Exists so that administrative access to a visitor's decrypted IP, and every
 * destructive administrative action, leaves a record. Required before the
 * platform can sit behind a signed data processing agreement: a processor has
 * to be able to say who looked at what, and when.
 *
 * DATA PROTECTION INVARIANT. This collection must never become a second copy
 * of the sensitive data it describes. It therefore stores no decrypted IP, no
 * `ipRaw`/`ipIv` ciphertext or IV, and no visitor-derived hash. Where a record
 * needs to be correlatable back to the exposed data it references the Click
 * document by `_id` (see `subjectIds`), so the sensitive value stays behind the
 * one AES key that already guards it. `actorIpHash` is the *administrator's*
 * own address, salted-hashed with the same `hashIP` used for rate limiting; it
 * is staff-attributable rather than visitor-attributable and is the only way to
 * investigate a compromised admin session.
 */
export interface IAuditLog extends Document {
  /** Acting administrator's user id. Never null: an unattributed entry is useless. */
  actorId: mongoose.Types.ObjectId;
  /**
   * Denormalised at write time. Deleting a user is itself an audited action, so
   * resolving `actorId` later can fail; the entry must stay legible regardless.
   */
  actorUsername: string;
  action: AuditAction;
  subjectType: AuditSubjectType;
  /**
   * Stable references to what was acted on: click ids, user ids, hostnames, or
   * "<domain> <keyword>" for a link. Capped by the builder, so `subjectCount`
   * is the authoritative total.
   */
  subjectIds: string[];
  subjectCount: number;
  route: string;
  method: string;
  /** Salted SHA-256 of the administrator's IP, truncated. Never a visitor IP. */
  actorIpHash: string;
  actorUserAgent: string;
  /** Small, redacted, non-sensitive context (filters used, counts affected). */
  detail: AuditDetail;
  createdAt: Date;
}

// Thirteen months. The log has to outlive the data it describes to be worth
// keeping: click retention under P3 is heading for twelve months, and an entry
// that expires first would leave clicks whose access history has already gone.
// Thirteen gives a full year plus a month of overlap, which is enough to cover
// one annual audit or DPA review cycle looking back over the preceding year,
// while still bounding growth so the collection cannot run away. It also
// matches the 400-day ceiling browsers now impose on cookies, so "just over a
// year" is a period this business already reasons in.
const RETENTION_DAYS = 400;

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorUsername: { type: String, default: "" },
    action: { type: String, required: true, enum: AUDIT_ACTIONS },
    subjectType: { type: String, required: true, enum: AUDIT_SUBJECT_TYPES },
    subjectIds: { type: [String], default: [] },
    subjectCount: { type: Number, default: 0 },
    route: { type: String, default: "" },
    method: { type: String, default: "" },
    actorIpHash: { type: String, default: "" },
    actorUserAgent: { type: String, default: "" },
    detail: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    // Anything not declared above is dropped rather than persisted. A caller
    // that accidentally passes a decrypted IP under a novel key must not have
    // it silently stored.
    strict: true,
    versionKey: false,
  }
);

// Retention, enforced by the server rather than by a job we have to remember to
// run. A TTL index is the one deletion path this collection has.
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

// "What did this administrator do", the first question in any investigation.
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
// "Who has decrypted IPs recently", the question a DPA review asks.
AuditLogSchema.index({ action: 1, createdAt: -1 });
// "Who touched this click / user / domain / link".
AuditLogSchema.index({ subjectType: 1, subjectIds: 1, createdAt: -1 });

export class AuditLogImmutableError extends Error {
  constructor(operation: string) {
    super(`Audit log entries are append-only; refusing "${operation}".`);
    this.name = "AuditLogImmutableError";
  }
}

// Append-only, enforced in code as well as by convention. An audit log is
// itself a target: the value of the trail depends on an administrator who has
// just done something not being able to edit or remove the evidence through the
// application. This does not stop someone with direct database credentials, and
// it deliberately does not interfere with the TTL index above, which expires
// documents server-side without going through Mongoose.
const MUTATING_OPS = [
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const;

for (const op of MUTATING_OPS) {
  AuditLogSchema.pre(op as "updateOne", function () {
    throw new AuditLogImmutableError(op);
  });
}

AuditLogSchema.pre("save", function () {
  if (!this.isNew) {
    throw new AuditLogImmutableError("save (modify existing)");
  }
});

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog || mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
