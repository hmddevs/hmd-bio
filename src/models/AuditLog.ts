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

// Audit entries are kept for 400 days, roughly thirteen months, and then
// removed by the TTL index below.
//
// This is a standalone choice, not one derived from click retention. It is long
// enough that an annual audit or DPA review can look back over the whole of the
// preceding year with a month of margin either side, and short enough that the
// collection's growth stays bounded without a job anyone has to remember to
// run. 400 days is also the ceiling browsers now impose on cookies, so it is a
// period this business already reasons in.
//
// Revisitable: if a customer contract or a regulator asks for a different
// window, change the number here and re-run
// scripts/migrate-audit-log-indexes.ts, which recreates the TTL index when the
// declared period no longer matches the live one.
export const AUDIT_RETENTION_DAYS = 400;
export const AUDIT_RETENTION_SECONDS = AUDIT_RETENTION_DAYS * 24 * 60 * 60;

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
//
// `autoIndex` is off (see src/lib/db.ts), so declaring an index here does NOT
// create it. Every index below reaches the live database only through
// scripts/migrate-audit-log-indexes.ts, which must be run before this feature
// is relied upon.
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_RETENTION_SECONDS });

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
