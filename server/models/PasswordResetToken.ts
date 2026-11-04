import mongoose, { Schema, type Document } from 'mongoose';

export interface IPasswordResetToken extends Document {
  token_hash: string;
  user_id: string;
  email: string;
  expires_at: Date;
  used_at: Date | null;
  request_ip?: string;
  created_at: Date;
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    token_hash: { type: String, required: true, unique: true, index: true },
    user_id: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    // Enforce 15-minute validity in queries; TTL index purges expired documents automatically after 1 hour
    expires_at: { type: Date, required: true, index: { expireAfterSeconds: 3600 } },
    used_at: { type: Date, default: null },
    request_ip: { type: String, default: '' },
    created_at: { type: Date, default: Date.now },
  },
  {
    collection: 'password_reset_tokens',
    versionKey: false,
  }
);

export const PasswordResetTokenModel =
  mongoose.models.PasswordResetToken ||
  mongoose.model<IPasswordResetToken>('PasswordResetToken', PasswordResetTokenSchema);
