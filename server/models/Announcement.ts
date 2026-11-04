import mongoose, { Schema, type Document } from 'mongoose';

export interface IAnnouncement extends Document {
  record_id?: string;
  title: string;
  content: string;
  category: 'General' | 'Exam' | 'Admission' | 'Holiday' | 'Event' | 'Academic';
  audience: 'All' | 'Students' | 'Teachers' | 'Public';
  date: string;
  priority: 'Normal' | 'High' | 'Urgent';
  author: string;
  published: boolean;
  created_at: Date;
  updated_at: Date;
}

export function toAnnouncementDto(doc: any) {
  return {
    id: doc.record_id || String(doc._id),
    title: doc.title || '',
    content: doc.content || '',
    category: doc.category || 'General',
    audience: doc.audience || 'All',
    date: doc.date || new Date().toISOString().split('T')[0],
    priority: doc.priority || 'Normal',
    author: doc.author || 'Administration',
  };
}

const AnnouncementSchema = new Schema<IAnnouncement>(
  {
    record_id: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: ['General', 'Exam', 'Admission', 'Holiday', 'Event', 'Academic'],
      default: 'General',
      index: true,
    },
    audience: {
      type: String,
      enum: ['All', 'Students', 'Teachers', 'Public'],
      default: 'All',
      index: true,
    },
    date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
      index: true,
    },
    priority: {
      type: String,
      enum: ['Normal', 'High', 'Urgent'],
      default: 'Normal',
    },
    author: {
      type: String,
      default: 'Administration',
    },
    published: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

AnnouncementSchema.index({ date: -1, created_at: -1 });
AnnouncementSchema.index({ category: 1, audience: 1, date: -1 });

export const AnnouncementModel =
  mongoose.models.Announcement || mongoose.model<IAnnouncement>('Announcement', AnnouncementSchema);
