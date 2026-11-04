import mongoose, { Schema, Document } from 'mongoose';

export interface ITimetable extends Document {
  record_id?: string;
  class_name: string;
  section: string;
  subject: string;
  teacher_name: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
  start_time: string;
  end_time: string;
  room: string;
  created_at: Date;
  updated_at: Date;
}

const TimetableSchema = new Schema<ITimetable>(
  {
    record_id: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    class_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    section: {
      type: String,
      required: true,
      trim: true,
      default: 'A',
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    teacher_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    day: {
      type: String,
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      required: true,
      index: true,
    },
    start_time: {
      type: String,
      required: true,
      trim: true,
    },
    end_time: {
      type: String,
      required: true,
      trim: true,
    },
    room: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

TimetableSchema.index({ class_name: 1, section: 1, day: 1, start_time: 1 });
TimetableSchema.index({ teacher_name: 1, day: 1 });
TimetableSchema.index({ created_at: 1, _id: 1 });

export function toTimetableDto(doc: any) {
  return {
    id: doc.record_id || String(doc._id),
    class_name: doc.class_name,
    section: doc.section || 'A',
    subject: doc.subject,
    teacher_name: doc.teacher_name,
    day: doc.day,
    start_time: doc.start_time,
    end_time: doc.end_time,
    room: doc.room ?? '',
  };
}

export const TimetableModel = mongoose.models.Timetable || mongoose.model<ITimetable>('Timetable', TimetableSchema);
