import mongoose, { Schema, Document, Model, Types } from "mongoose";
import { PRIMARY_DOMAIN } from "../lib/domains";

// A single platform's deeplink override. Subdocument only (no _id): these
// are always read/written as a whole array alongside the parent link, never
// addressed individually.
export interface ILinkTarget {
  platform: "ios" | "android" | "desktop";
  url: string;
}

export interface ILink extends Document {
  // Denormalised hostname the link lives on. Uniqueness is (domain, keyword),
  // never keyword alone.
  domain: string;
  /**
   * Set when the Domain record this link lives on was removed or taken over.
   * A stamped link is kept for the original owner's records but must never
   * resolve or be read publicly again, so the next owner of the hostname can
   * never inherit it. Null (or absent) means live.
   */
  domainDetachedAt?: Date | null;
  keyword: string;
  url: string;
  title: string;
  // AES-256-GCM encrypted creator IP, admin-decryptable only — never search this in plaintext.
  ipRaw: string;
  ipIv: string;
  clicks: number;
  statusCode: 301 | 302;
  isPasswordProtected: boolean;
  password?: string;
  expiresAt?: Date;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  owner?: Types.ObjectId | null;
  createdVia: "form" | "api" | "bulk" | "dashboard";
  /**
   * Per-platform overrides for a deeplink domain. `url` above stays required
   * and remains the fallback for any platform with no entry here, so an
   * existing link with no targets resolves exactly as it does today.
   */
  targets: ILinkTarget[];
  forwardPath: boolean;
  forwardQuery: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LinkTargetSchema = new Schema<ILinkTarget>(
  {
    platform: { type: String, enum: ["ios", "android", "desktop"], required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const LinkSchema = new Schema<ILink>(
  {
    domain: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      default: PRIMARY_DOMAIN,
    },
    domainDetachedAt: { type: Date, default: null },
    keyword: {
      type: String,
      required: true,
      trim: true,
      lowercase: false,
    },
    url: { type: String, required: true },
    title: { type: String, default: "" },
    ipRaw: { type: String, default: "" },
    ipIv: { type: String, default: "" },
    clicks: { type: Number, default: 0, min: 0 },
    statusCode: { type: Number, enum: [301, 302], default: 302 },
    isPasswordProtected: { type: Boolean, default: false },
    password: { type: String, select: false },
    expiresAt: { type: Date, default: null },
    ogTitle: { type: String, default: null },
    ogDescription: { type: String, default: null },
    ogImage: { type: String, default: null },
    owner: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdVia: { type: String, enum: ["form", "api", "bulk", "dashboard"], default: "form" },
    targets: { type: [LinkTargetSchema], default: [] },
    forwardPath: { type: Boolean, default: false },
    forwardQuery: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// Uniqueness is compound: the same keyword may exist once per domain. This
// index also serves the redirect lookup, findOne({ domain, keyword }).
LinkSchema.index({ domain: 1, keyword: 1 }, { unique: true });

// TTL index for auto-expiring links — MongoDB removes docs after expiresAt
LinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
LinkSchema.index({ owner: 1 }, { sparse: true });

/**
 * The filter fragment every public read of a link must carry alongside
 * `{ domain, keyword }`: resolution, expand, stats, and the preview page.
 *
 * `domainDetachedAt: null` also matches documents where the field is absent,
 * which is every link written before this field existed, so no backfill is
 * needed. Owner-scoped dashboard listings deliberately do not apply it: a user
 * keeps seeing their own history after a domain is removed.
 */
export const LIVE_LINK_FILTER = { domainDetachedAt: null } as const;

export const Link: Model<ILink> =
  mongoose.models.Link || mongoose.model<ILink>("Link", LinkSchema);
