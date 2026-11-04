import mongoose, { Schema, type Document } from 'mongoose';

export interface ISchoolEvent extends Document {
  record_id?: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  cover_image: string;
  status: 'Upcoming' | 'Ongoing' | 'Completed';
  category?: string;
  created_at: Date;
  updated_at: Date;
}

export function toSchoolEventDto(doc: any) {
  return {
    id: doc.record_id || String(doc._id),
    title: doc.title || '',
    description: doc.description || '',
    date: doc.date || '',
    time: doc.time || '09:00 AM',
    location: doc.location || 'Campus Grounds, Paharpur',
    cover_image: doc.cover_image || '/src/assets/images/hero_school_campus_1790606578302.jpg',
    status: doc.status || 'Upcoming',
  };
}

const SchoolEventSchema = new Schema<ISchoolEvent>(
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
    description: {
      type: String,
      default: '',
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    time: {
      type: String,
      default: '09:00 AM',
    },
    location: {
      type: String,
      default: 'Campus Grounds, Paharpur',
    },
    cover_image: {
      type: String,
      default: '/src/assets/images/hero_school_campus_1790606578302.jpg',
    },
    status: {
      type: String,
      enum: ['Upcoming', 'Ongoing', 'Completed'],
      default: 'Upcoming',
      index: true,
    },
    category: {
      type: String,
      default: 'General',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

SchoolEventSchema.index({ status: 1, date: 1 });
SchoolEventSchema.index({ date: 1, created_at: -1 });

export const SchoolEventModel =
  mongoose.models.SchoolEvent || mongoose.model<ISchoolEvent>('SchoolEvent', SchoolEventSchema);
