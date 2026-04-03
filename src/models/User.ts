import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
  isVerified: boolean;
  status: "pending" | "approved" | "disabled";
  verificationToken?: string;
  verificationExpires?: Date;
  apiKeys: { key: string; label: string; createdAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, default: "Default" },
    createdAt: { type: Date, default: Date.now },
  }
);

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    isVerified: { type: Boolean, default: false },
    status: { type: String, enum: ["pending", "approved", "disabled"], default: "pending" },
    verificationToken: { type: String, default: null },
    verificationExpires: { type: Date, default: null },
    apiKeys: { type: [ApiKeySchema], default: [] },
  },
  {
    timestamps: true,
  }
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
