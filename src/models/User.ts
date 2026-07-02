import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IApiKey {
  _id: Types.ObjectId;
  keyHash: string;
  prefix: string;
  label: string;
  createdAt: Date;
}

export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
  isVerified: boolean;
  status: "pending" | "approved" | "disabled";
  verificationToken?: string;
  verificationExpires?: Date;
  pendingEmail?: string;
  emailChangeToken?: string;
  emailChangeExpires?: Date;
  apiKeys: IApiKey[];
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema(
  {
    // SHA-256 hash of the raw key; the raw key is shown to the user once, at creation, and never stored.
    keyHash: { type: String, required: true },
    // First 8 characters of the raw key, kept in plaintext so the UI can show a recognisable identifier.
    prefix: { type: String, required: true },
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
    pendingEmail: { type: String, default: null },
    emailChangeToken: { type: String, default: null },
    emailChangeExpires: { type: Date, default: null },
    apiKeys: { type: [ApiKeySchema], default: [] },
  },
  {
    timestamps: true,
  }
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
