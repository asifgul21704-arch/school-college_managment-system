import mongoose, { Schema, type Document } from 'mongoose';

export interface IRevokedToken extends Document {
  token_hash: string;
  expires_at: Date;
  revoked_at: Date;
  reason?: string;
}

const RevokedTokenSchema = new Schema<IRevokedToken>(
  {
    token_hash: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revoked_at: { type: Date, default: Date.now },
    reason: { type: String, default: 'logout' },
  },
  {
    collection: 'revoked_tokens',
    versionKey: false,
  }
);

export const RevokedTokenModel =
  mongoose.models.RevokedToken || mongoose.model<IRevokedToken>('RevokedToken', RevokedTokenSchema);
