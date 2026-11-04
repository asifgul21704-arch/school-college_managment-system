import mongoose, { Schema, Document } from 'mongoose';

export interface IExam extends Document {
  record_id?: string;
  title: string;
  term: string;
  academic_year: string;
  start_date: string;
  end_date: string;
  classes: string[];
  status: 'Scheduled' | 'Ongoing' | 'Completed';
  max_marks?: number;
  passing_marks?: number;
  created_at: Date;
  updated_at: Date;
}

const ExamSchema = new Schema<IExam>(
  {
    record_id: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    term: {
      type: String,
      required: true,
      trim: true,
    },
    academic_year: {
      type: String,
      default: '2026-2027',
      trim: true,
    },
    start_date: {
      type: String,
      required: true,
      trim: true,
    },
    end_date: {
      type: String,
      default: '',
      trim: true,
    },
    classes: {
      type: [String],
      default: ['All Classes'],
    },
    status: {
      type: String,
      enum: ['Scheduled', 'Ongoing', 'Completed'],
      default: 'Scheduled',
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

ExamSchema.index({ start_date: 1, created_at: -1 });
ExamSchema.index({ academic_year: 1, term: 1 });
ExamSchema.index({ created_at: 1, _id: 1 });

export function toExamDto(doc: any) {
  return {
    id: doc.record_id || String(doc._id),
    title: doc.title,
    term: doc.term,
    academic_year: doc.academic_year || '2026-2027',
    start_date: doc.start_date,
    end_date: doc.end_date ?? '',
    classes: Array.isArray(doc.classes) ? doc.classes : ['All Classes'],
    status: doc.status || 'Scheduled',
    ...(typeof doc.max_marks === 'number' ? { max_marks: doc.max_marks } : {}),
    ...(typeof doc.passing_marks === 'number' ? { passing_marks: doc.passing_marks } : {}),
  };
}

export const ExamModel = mongoose.models.Exam || mongoose.model<IExam>('Exam', ExamSchema);
