import mongoose, { Schema, type Document } from 'mongoose';

export interface IRateLimitBucket extends Document {
  bucket_key: string;
  count: number;
  reset_at: Date;
}

const RateLimitBucketSchema = new Schema<IRateLimitBucket>(
  {
    bucket_key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 1 },
    reset_at: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  {
    collection: 'rate_limit_buckets',
    versionKey: false,
  }
);

export const RateLimitBucketModel =
  mongoose.models.RateLimitBucket ||
  mongoose.model<IRateLimitBucket>('RateLimitBucket', RateLimitBucketSchema);
