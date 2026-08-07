import mongoose, { Schema, Document, Model, Types } from "mongoose";

export type DomainStatus =
  | "pending_dns"
  | "verifying"
  | "provisioning"
  | "active"
  | "failed"
  | "suspended";

// A deeplink domain is a different kind of tenant, not a shortener domain
// with extra fields set. Keeping this as its own mode (rather than inferring
// it from appLinks being populated) stops the two roles being combined in
// states that make no sense.
export type DomainMode = "shortener" | "deeplink";

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
  mode: DomainMode;
  /**
   * Raw text of the two association files, exactly as the customer supplied
   * them. String, never Mixed/Object: parsing and re-stringifying reorders
   * keys, and Apple's CDN caches whatever it first served, so we must be able
   * to serve the original bytes back verbatim.
   */
  appLinks: {
    aasa: string | null;
    assetlinks: string | null;
  };
  /** Where an unmatched path goes on a deeplink domain, instead of /not-found. */
  fallbackTarget?: string | null;
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

const DOMAIN_MODES: DomainMode[] = ["shortener", "deeplink"];

// Generous cap: real association files run under 2 KB. 128 KB just guards
// against abuse without ever being a realistic ceiling for a legitimate file.
export const APP_LINKS_MAXLENGTH = 128 * 1024;

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
    mode: { type: String, enum: DOMAIN_MODES, default: "shortener" },
    appLinks: {
      aasa: { type: String, default: null, maxlength: APP_LINKS_MAXLENGTH },
      assetlinks: { type: String, default: null, maxlength: APP_LINKS_MAXLENGTH },
    },
    fallbackTarget: { type: String, default: null },
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
