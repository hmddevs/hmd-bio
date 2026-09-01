import { Schema, Document, Model } from "mongoose";
import { connectionScopedModel } from "./connection-scoped-model";

export interface IOption extends Document {
  key: string;
  value: unknown;
}

const OptionSchema = new Schema<IOption>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
  }
);

export const Option: Model<IOption> = connectionScopedModel<IOption>(
  "Option",
  OptionSchema
);
