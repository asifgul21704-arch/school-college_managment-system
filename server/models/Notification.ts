import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  user_id?: string;
  role?: string;
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

export const NotificationModel = mongoose.models.Notification || mongoose.model<INotification>('Notification', NotificationSchema);
