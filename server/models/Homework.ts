import mongoose, { Schema, Document } from 'mongoose';

export interface IHomework extends Document {
  homework_id: string;
  title: string;
  description: string;
  class_name: string;
  section: string;
  subject: string;
  teacher_id: string;
  teacher_name?: string;
  assigned_date: string;
  due_date: string;
  total_marks?: number;
  instructions?: string;
  created_at: Date;
  updated_at: Date;
}

export interface HomeworkDto {
  id: string;
  homework_id: string;
  title: string;
  description: string;
  class_name: string;
  section: string;
  subject: string;
  teacher_id: string;
  teacher_name: string;
  assigned_date: string;
  due_date: string;
  total_marks?: number;
  instructions: string;
  created_at: string;
}

const HomeworkSchema = new Schema<IHomework>(
  {
    homework_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
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
      required: true,
      trim: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    teacher_id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    teacher_name: {
      type: String,
      default: '',
      trim: true,
    },
    assigned_date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    due_date: {
      type: String,
      required: true,
      trim: true,
    },
    total_marks: {
      type: Number,
      default: 10,
    },
    instructions: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

HomeworkSchema.index({ class_name: 1, section: 1, due_date: 1 });
HomeworkSchema.index({ teacher_id: 1, due_date: 1 });

export function toHomeworkDto(doc: any): HomeworkDto {
  const id = String(doc?.homework_id || doc?._id || '');
  return {
    id,
    homework_id: String(doc?.homework_id || id),
    title: String(doc?.title || ''),
    description: String(doc?.description || ''),
    class_name: String(doc?.class_name || ''),
    section: String(doc?.section || ''),
    subject: String(doc?.subject || ''),
    teacher_id: String(doc?.teacher_id || ''),
    teacher_name: String(doc?.teacher_name || ''),
    assigned_date: String(doc?.assigned_date || ''),
    due_date: String(doc?.due_date || ''),
    total_marks: typeof doc?.total_marks === 'number' ? doc.total_marks : undefined,
    instructions: String(doc?.instructions || ''),
    created_at: doc?.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
  };
}

export const HomeworkModel =
  mongoose.models.Homework || mongoose.model<IHomework>('Homework', HomeworkSchema);
