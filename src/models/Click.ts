import mongoose, { Schema, Document, Model } from "mongoose";
import { PRIMARY_DOMAIN } from "../lib/domains";

export interface IClick extends Document {
  // Hostname the click was served on. Analytics are always scoped to
  // (domain, keyword) so two tenants sharing a keyword never merge.
  domain: string;
  keyword: string;
  referrer: string;
  userAgent: string;
  // AES-256-GCM encrypted IP, admin-decryptable only — never queried in plaintext.
  ipRaw: string;
  ipIv: string;
  countryCode: string;
  browser: string;
  os: string;
  createdAt: Date;
}

const ClickSchema = new Schema<IClick>(
  {
    domain: { type: String, required: true, lowercase: true, default: PRIMARY_DOMAIN },
    keyword: { type: String, required: true },
    referrer: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    ipRaw: { type: String, default: "" },
    ipIv: { type: String, default: "" },
    countryCode: { type: String, default: "", maxlength: 2 },
    browser: { type: String, default: "" },
    os: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
  }
);

// Every per-link analytics query is now scoped to (domain, keyword), so each
// index that used to lead with keyword leads with domain instead. The
// { domain, keyword } prefix also serves a plain "all clicks for this link"
// count, which is what the old standalone keyword index did.
ClickSchema.index({ domain: 1, keyword: 1, createdAt: -1 });
ClickSchema.index({ domain: 1, keyword: 1, referrer: 1 });
ClickSchema.index({ domain: 1, keyword: 1, browser: 1 });
ClickSchema.index({ domain: 1, keyword: 1, os: 1 });
ClickSchema.index({ countryCode: 1 });

export const Click: Model<IClick> =
  mongoose.models.Click || mongoose.model<IClick>("Click", ClickSchema);
