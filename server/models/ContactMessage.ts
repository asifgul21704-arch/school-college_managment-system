import mongoose, { Schema, type Document } from 'mongoose';

export interface IContactMessage extends Document {
  record_id?: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  read: boolean;
  replied: boolean;
  created_at: Date;
  updated_at: Date;
}

export function toContactMessageDto(doc: any) {
  const createdIso =
    doc.created_at instanceof Date
      ? doc.created_at.toISOString()
      : typeof doc.created_at === 'string' && doc.created_at
      ? new Date(doc.created_at).toISOString()
      : new Date().toISOString();

  return {
    id: doc.record_id || String(doc._id),
    name: doc.name || '',
    email: doc.email || '',
    phone: doc.phone || '',
    subject: doc.subject || 'General Inquiry',
    message: doc.message || '',
    created_at: createdIso,
    read: Boolean(doc.read),
    ...(doc.replied ? { replied: Boolean(doc.replied) } : {}),
  };
}

const ContactMessageSchema = new Schema<IContactMessage>(
  {
    record_id: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    subject: {
      type: String,
      default: 'General Inquiry',
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    replied: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ContactMessageSchema.index({ created_at: -1 });
ContactMessageSchema.index({ read: 1, created_at: -1 });

export const ContactMessageModel =
  mongoose.models.ContactMessage || mongoose.model<IContactMessage>('ContactMessage', ContactMessageSchema);
