import mongoose, { Schema, Document } from 'mongoose';

export interface IResultSubject {
  subject_name: string;
  total_marks: number;
  obtained_marks: number;
  grade: string;
}

export interface IResult extends Document {
  record_id?: string;
  exam_id: string;
  exam_title: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  subjects: IResultSubject[];
  total_marks: number;
  obtained_marks: number;
  percentage: number;
  overall_grade: string;
  remarks?: string;
  published: boolean;
  academic_session?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ResultSubjectDto {
  subject_name: string;
  total_marks: number;
  obtained_marks: number;
  grade: string;
}

export interface ResultDto {
  id: string;
  exam_id: string;
  exam_title: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  subjects: ResultSubjectDto[];
  total_marks: number;
  obtained_marks: number;
  percentage: number;
  overall_grade: string;
  remarks: string;
  published: boolean;
  academic_session?: string;
}

const ResultSchema = new Schema<IResult>(
  {
    record_id: {
      type: String,
      trim: true,
    },
    exam_id: {
      type: String,
      required: true,
      index: true,
    },
    exam_title: {
      type: String,
      required: true,
      trim: true,
    },
    student_id: {
      type: String,
      required: true,
      index: true,
    },
    student_name: {
      type: String,
      required: true,
      trim: true,
    },
    class_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    section: {
      type: String,
      default: 'A',
    },
    subjects: [
      {
        subject_name: { type: String, required: true },
        total_marks: { type: Number, required: true, min: [1, 'Total marks must be positive'] },
        obtained_marks: { type: Number, required: true, min: [0, 'Obtained marks cannot be negative'] },
        grade: { type: String, default: 'A' },
      },
    ],
    total_marks: {
      type: Number,
      required: true,
      min: [1, 'Total marks must be positive'],
    },
    obtained_marks: {
      type: Number,
      required: true,
      min: [0, 'Obtained marks cannot be negative'],
    },
    percentage: {
      type: Number,
      required: true,
      min: [0, 'Percentage cannot be negative'],
      max: [100, 'Percentage cannot exceed 100'],
    },
    overall_grade: {
      type: String,
      required: true,
    },
    remarks: {
      type: String,
      default: '',
    },
    published: {
      type: Boolean,
      default: true,
      index: true,
    },
    academic_session: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ResultSchema.index({ record_id: 1 }, { unique: true, sparse: true });
ResultSchema.index({ exam_id: 1, student_id: 1 }, { unique: true });
ResultSchema.index({ class_name: 1, exam_id: 1 });
ResultSchema.index({ student_id: 1, published: 1 });

export function toResultDto(doc: any): ResultDto {
  return {
    id: String(doc.record_id || doc.id || (doc._id ? doc._id.toString() : '')),
    exam_id: String(doc.exam_id || ''),
    exam_title: String(doc.exam_title || ''),
    student_id: String(doc.student_id || ''),
    student_name: String(doc.student_name || ''),
    class_name: String(doc.class_name || ''),
    section: String(doc.section || 'A'),
    subjects: Array.isArray(doc.subjects)
      ? doc.subjects.map((s: any) => ({
          subject_name: String(s.subject_name || ''),
          total_marks: Number(s.total_marks || 0),
          obtained_marks: Number(s.obtained_marks ?? 0),
          grade: String(s.grade || 'F'),
        }))
      : [],
    total_marks: Number(doc.total_marks || 0),
    obtained_marks: Number(doc.obtained_marks ?? 0),
    percentage: Number(doc.percentage ?? 0),
    overall_grade: String(doc.overall_grade || 'F'),
    remarks: String(doc.remarks ?? ''),
    published: doc.published !== false,
    ...(doc.academic_session ? { academic_session: String(doc.academic_session) } : {}),
  };
}

export const ResultModel = mongoose.models.Result || mongoose.model<IResult>('Result', ResultSchema);
