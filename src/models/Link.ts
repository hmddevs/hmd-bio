import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface ILink extends Document {
  keyword: string;
  url: string;
  title: string;
  ip: string;
  clicks: number;
  statusCode: 301 | 302;
  isPasswordProtected: boolean;
  password?: string;
  expiresAt?: Date;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  owner?: Types.ObjectId;
  createdVia: "form" | "api" | "bulk" | "dashboard";
  createdAt: Date;
  updatedAt: Date;
}

const LinkSchema = new Schema<ILink>(
  {
    keyword: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: false,
    },
    url: { type: String, required: true },
    title: { type: String, default: "" },
    ip: { type: String, default: "" },
    clicks: { type: Number, default: 0, min: 0 },
    statusCode: { type: Number, enum: [301, 302], default: 301 },
    isPasswordProtected: { type: Boolean, default: false },
    password: { type: String, select: false },
    expiresAt: { type: Date, default: null },
    ogTitle: { type: String, default: null },
    ogDescription: { type: String, default: null },
    ogImage: { type: String, default: null },
    owner: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdVia: { type: String, enum: ["form", "api", "bulk", "dashboard"], default: "form" },
  },
  {
    timestamps: true,
  }
);

// TTL index for auto-expiring links — MongoDB removes docs after expiresAt
LinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
LinkSchema.index({ owner: 1 }, { sparse: true });

export const Link: Model<ILink> =
  mongoose.models.Link || mongoose.model<ILink>("Link", LinkSchema);
