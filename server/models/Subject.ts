import mongoose, { Schema, Document } from 'mongoose';

export interface ISubject extends Document {
  record_id?: string;
  class_name: string;
  name: string;
  code: string;
  teacher_name: string;
  weekly_periods: number;
  status?: 'Active' | 'Inactive';
  max_marks?: number;
  passing_marks?: number;
  created_at: Date;
  updated_at: Date;
}

const SubjectSchema = new Schema<ISubject>(
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
      default: '',
    },
    teacher_name: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    weekly_periods: {
      type: Number,
      default: 5,
      min: 1,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    max_marks: {
      type: Number,
      min: 1,
    },
    passing_marks: {
      type: Number,
      min: 0,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

SubjectSchema.index({ class_name: 1, name: 1 }, { unique: true });
SubjectSchema.index({ created_at: 1, _id: 1 });

export function toSubjectDto(doc: any) {
  return {
    id: doc.record_id || String(doc._id),
    class_name: doc.class_name,
    name: doc.name,
    code: doc.code ?? '',
    teacher_name: doc.teacher_name ?? '',
    weekly_periods:
      typeof doc.weekly_periods === 'number'
        ? doc.weekly_periods
        : Number(doc.weekly_periods) || 5,
    status: doc.status || 'Active',
    ...(typeof doc.max_marks === 'number' ? { max_marks: doc.max_marks } : {}),
    ...(typeof doc.passing_marks === 'number' ? { passing_marks: doc.passing_marks } : {}),
  };
}

export const SubjectModel = mongoose.models.Subject || mongoose.model<ISubject>('Subject', SubjectSchema);
