import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  role: "admin" | "editor";
  apiKeys: { key: string; label: string; createdAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, default: "Default" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "editor"], default: "admin" },
    apiKeys: { type: [ApiKeySchema], default: [] },
  },
  {
    timestamps: true,
  }
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
