import mongoose, { Schema, Document, Model, Types } from "mongoose";

export type DomainStatus =
  | "pending_dns"
  | "verifying"
  | "provisioning"
  | "active"
  | "failed"
  | "suspended";

export interface IDomain extends Document {
  hostname: string;
  owner: Types.ObjectId;
  status: DomainStatus;
  verificationToken: string;
  verifiedAt?: Date | null;
  lastCheckedAt?: Date | null;
  failureReason?: string | null;
  vercelDomainId?: string | null;
  linkCount: number;
  /** Admin-supplied reason for a suspension, cleared on reactivation. */
  suspendedReason?: string | null;
  /** When the domain was last suspended, cleared on reactivation. */
  suspendedAt?: Date | null;
  /** Consecutive DNS re-verification failures since the last success, reset on a match. */
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

const DOMAIN_STATUSES: DomainStatus[] = [
  "pending_dns",
  "verifying",
  "provisioning",
  "active",
  "failed",
  "suspended",
];

const DomainSchema = new Schema<IDomain>(
  {
    hostname: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: DOMAIN_STATUSES, default: "pending_dns" },
    verificationToken: { type: String, required: true },
    verifiedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    vercelDomainId: { type: String, default: null },
    linkCount: { type: Number, default: 0, min: 0 },
    suspendedReason: { type: String, default: null },
    suspendedAt: { type: Date, default: null },
    consecutiveFailures: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
  }
);

// Serves the dashboard listing ("my domains") and the recheck cron, which
// scans by status within an owner.
DomainSchema.index({ owner: 1, status: 1 });

export const Domain: Model<IDomain> =
  mongoose.models.Domain || mongoose.model<IDomain>("Domain", DomainSchema);
