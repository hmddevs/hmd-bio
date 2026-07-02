import mongoose, { Schema, Document, Model } from "mongoose";

export interface IClick extends Document {
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
    keyword: { type: String, required: true, index: true },
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

ClickSchema.index({ keyword: 1, createdAt: -1 });
ClickSchema.index({ keyword: 1, referrer: 1 });
ClickSchema.index({ keyword: 1, browser: 1 });
ClickSchema.index({ keyword: 1, os: 1 });
ClickSchema.index({ countryCode: 1 });

export const Click: Model<IClick> =
  mongoose.models.Click || mongoose.model<IClick>("Click", ClickSchema);
