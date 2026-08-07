import mongoose, { Schema, Document, Model, Types } from "mongoose";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/lib/api-key-scope";

export interface IApiKey {
  _id: Types.ObjectId;
  keyHash: string;
  prefix: string;
  label: string;
  createdAt: Date;
  /**
   * What the key may do. Absent on every key minted before scoping existed,
   * and absent means full access, so those keys are unchanged. Interpreted by
   * `resolveKeyScope` in `@/lib/api-key-scope`, never read directly.
   */
  scope?: ApiKeyScope | null;
  /**
   * Hostnames the key is confined to. Absent means every domain the account
   * owns. Only ever written non-empty; see `resolveKeyDomains` for why an
   * empty list must not be storable.
   */
  domains?: string[] | null;
  /** Absent means the key never expires, which is what every legacy key does. */
  expiresAt?: Date | null;
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
    // Every field below is `default: undefined` on purpose. A default value
    // here would be materialised onto legacy keys the moment their parent
    // document is loaded and re-saved, silently narrowing a key that is in
    // production use. Absent has to stay absent, because absent is what
    // `@/lib/api-key-scope` reads as "full access, no expiry".
    //
    // `domains` in particular: a Mongoose `[String]` path defaults to `[]`
    // rather than undefined unless told otherwise, so omitting this line would
    // stamp an empty list onto existing keys.
    scope: { type: String, enum: API_KEY_SCOPES, default: undefined },
    domains: { type: [String], default: undefined },
    expiresAt: { type: Date, default: undefined },
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

// API-key authentication looks a user up by key hash on every Bearer request,
// and `/api/v1/shorten` now performs that lookup before Turnstile runs, so an
// anonymous caller can reach it. Without this index that is a collection scan
// an unauthenticated request can trigger. `autoIndex` is off (src/lib/db.ts),
// so declaring it here is not enough: scripts/migrate-api-key-index.ts creates
// it on the live database.
UserSchema.index({ "apiKeys.keyHash": 1 });

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
