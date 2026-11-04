import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  target_type: string;
  target_id?: string;
  details?: string;
  timestamp: string;
  created_at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    user_name: {
      type: String,
      required: true,
    },
    user_role: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    target_type: {
      type: String,
      required: true,
    },
    target_id: {
      type: String,
      default: '',
    },
    details: {
      type: String,
      default: '',
    },
    timestamp: {
      type: String,
      default: () => new Date().toISOString(),
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

export const AuditLogModel = mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
