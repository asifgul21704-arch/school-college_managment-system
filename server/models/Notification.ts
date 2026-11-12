import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  user_id?: string;
  role?: string;
  action_id?: string;
  title: string;
  message: string;
  read: boolean;
  link?: string;
  created_at: Date;
  updated_at: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    user_id: {
      type: String,
      default: '',
      index: true,
    },
    role: {
      type: String,
      default: 'all',
      index: true,
    },
    action_id: {
      type: String,
      default: undefined,
      maxlength: 64,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    link: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// A single confirmed action can create at most one notification per account.
// Legacy notifications without action_id are excluded from this unique index.
NotificationSchema.index(
  { action_id: 1, user_id: 1 },
  {
    unique: true,
    partialFilterExpression: { action_id: { $type: 'string' } },
    name: 'unique_notification_action_recipient',
  }
);

export const NotificationModel = mongoose.models.Notification || mongoose.model<INotification>('Notification', NotificationSchema);
