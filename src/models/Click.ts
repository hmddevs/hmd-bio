import mongoose, { Schema, Document, Model } from "mongoose";

export interface IClick extends Document {
  keyword: string;
  referrer: string;
  userAgent: string;
  ip: string;
  countryCode: string;
  createdAt: Date;
}

const ClickSchema = new Schema<IClick>(
  {
    keyword: { type: String, required: true, index: true },
    referrer: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    countryCode: { type: String, default: "", maxlength: 2 },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
  }
);

ClickSchema.index({ keyword: 1, createdAt: -1 });
ClickSchema.index({ countryCode: 1 });

export const Click: Model<IClick> =
  mongoose.models.Click || mongoose.model<IClick>("Click", ClickSchema);
