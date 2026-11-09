import mongoose, { Schema, type Document } from 'mongoose';

export type InquiryStatus = 'Pending' | 'Processing' | 'Awaiting Admin Approval' | 'Replied' | 'Resolved';

export interface IInquiryReply {
  id: string;
  sender_type: 'admin' | 'ai_system' | 'parent';
  sender_id?: string;
  sender_name: string;
  message: string;
  created_at: Date;
  sent_via_email?: boolean;
  sent_via_notification?: boolean;
  approved_by_id?: string;
  approved_by_name?: string;
}

export interface IContactMessage extends Document {
  record_id?: string;
  reference_no?: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  read: boolean;
  replied: boolean;
  status: InquiryStatus;
  intent?: string;
  parent_user_id?: string;
  verified_parent_id?: string;
  verified_parent_name?: string;
  verified_student_ids?: string[];
  ai_draft_reply?: string;
  ai_generated_at?: Date;
  ai_intent_analysis?: {
    is_fee_inquiry: boolean;
    parent_verified: boolean;
    verification_notes: string;
    student_count: number;
  };
  replies: IInquiryReply[];
  resolved_at?: Date;
  resolved_by?: string;
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

  const replies = Array.isArray(doc.replies)
    ? doc.replies.map((r: any) => ({
        id: String(r.id || r._id || ''),
        sender_type: r.sender_type || 'admin',
        sender_id: r.sender_id ? String(r.sender_id) : undefined,
        sender_name: String(r.sender_name || 'Administration'),
        message: String(r.message || ''),
        created_at:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : typeof r.created_at === 'string' && r.created_at
            ? r.created_at
            : new Date().toISOString(),
        sent_via_email: Boolean(r.sent_via_email),
        sent_via_notification: Boolean(r.sent_via_notification),
        approved_by_id: r.approved_by_id ? String(r.approved_by_id) : undefined,
        approved_by_name: r.approved_by_name ? String(r.approved_by_name) : undefined,
      }))
    : [];

  return {
    id: doc.record_id || String(doc._id),
    reference_no: doc.reference_no || (doc.record_id ? `INQ-${String(doc.record_id).slice(-6).toUpperCase()}` : `INQ-${String(doc._id).slice(-6).toUpperCase()}`),
    name: doc.name || '',
    email: doc.email || '',
    phone: doc.phone || '',
    subject: doc.subject || 'General Inquiry',
    message: doc.message || '',
    created_at: createdIso,
    read: Boolean(doc.read),
    replied: Boolean(doc.replied),
    status: (doc.status || (doc.replied ? 'Replied' : 'Pending')) as InquiryStatus,
    intent: doc.intent || '',
    parent_user_id: doc.parent_user_id ? String(doc.parent_user_id) : undefined,
    verified_parent_id: doc.verified_parent_id ? String(doc.verified_parent_id) : undefined,
    verified_parent_name: doc.verified_parent_name || undefined,
    verified_student_ids: Array.isArray(doc.verified_student_ids) ? doc.verified_student_ids : [],
    ai_draft_reply: doc.ai_draft_reply || undefined,
    ai_generated_at: doc.ai_generated_at ? new Date(doc.ai_generated_at).toISOString() : undefined,
    ai_intent_analysis: doc.ai_intent_analysis || undefined,
    replies,
    resolved_at: doc.resolved_at ? new Date(doc.resolved_at).toISOString() : undefined,
    resolved_by: doc.resolved_by || undefined,
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
    reference_no: {
      type: String,
      trim: true,
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
      index: true,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
      index: true,
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
      index: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Processing', 'Awaiting Admin Approval', 'Replied', 'Resolved'],
      default: 'Pending',
      index: true,
    },
    intent: {
      type: String,
      default: '',
    },
    parent_user_id: {
      type: String,
      default: '',
      index: true,
    },
    verified_parent_id: {
      type: String,
      default: '',
    },
    verified_parent_name: {
      type: String,
      default: '',
    },
    verified_student_ids: {
      type: [String],
      default: [],
    },
    ai_draft_reply: {
      type: String,
      default: '',
    },
    ai_generated_at: {
      type: Date,
    },
    ai_intent_analysis: {
      is_fee_inquiry: { type: Boolean, default: false },
      parent_verified: { type: Boolean, default: false },
      verification_notes: { type: String, default: '' },
      student_count: { type: Number, default: 0 },
    },
    replies: [
      {
        id: { type: String, required: true },
        sender_type: { type: String, enum: ['admin', 'ai_system', 'parent'], default: 'admin' },
        sender_id: { type: String, default: '' },
        sender_name: { type: String, default: 'Administration' },
        message: { type: String, required: true },
        created_at: { type: Date, default: Date.now },
        sent_via_email: { type: Boolean, default: false },
        sent_via_notification: { type: Boolean, default: false },
        approved_by_id: { type: String, default: '' },
        approved_by_name: { type: String, default: '' },
      },
    ],
    resolved_at: {
      type: Date,
    },
    resolved_by: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ContactMessageSchema.index({ created_at: -1 });
ContactMessageSchema.index({ read: 1, created_at: -1 });
ContactMessageSchema.index({ status: 1, created_at: -1 });
ContactMessageSchema.index({ parent_user_id: 1, created_at: -1 });
ContactMessageSchema.index({ reference_no: 1 }, { sparse: true });

export const ContactMessageModel =
  mongoose.models.ContactMessage || mongoose.model<IContactMessage>('ContactMessage', ContactMessageSchema);
