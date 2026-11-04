import mongoose, { Schema, Document } from 'mongoose';

export interface ITeacherAssignment extends Document {
  record_id?: string;
  teacher_id: string;
  teacher_name: string;
  class_name: string;
  section: string;
  subject: string;
  academic_session: string;
  assigned_date: string;
  is_class_teacher?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TeacherAssignmentDto {
  id: string;
  teacher_id: string;
  teacher_name: string;
  class_name: string;
  section: string;
  subject: string;
  academic_session: string;
  assigned_date: string;
  is_class_teacher?: boolean;
}

const TeacherAssignmentSchema = new Schema<ITeacherAssignment>(
  {
    record_id: {
      type: String,
      trim: true,
    },
    teacher_id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    teacher_name: {
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
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    academic_session: {
      type: String,
      default: '2026-2027',
      trim: true,
    },
    assigned_date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    is_class_teacher: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

TeacherAssignmentSchema.index({ record_id: 1 }, { unique: true, sparse: true });
TeacherAssignmentSchema.index(
  { teacher_id: 1, class_name: 1, section: 1, subject: 1, academic_session: 1 },
  { unique: true }
);

export function toTeacherAssignmentDto(doc: any): TeacherAssignmentDto {
  const id = String(doc?.record_id || doc?.id || doc?._id || '');
  const fallbackDate =
    doc?.created_at instanceof Date ? doc.created_at.toISOString().split('T')[0] : '';
  return {
    id,
    teacher_id: String(doc?.teacher_id || ''),
    teacher_name: String(doc?.teacher_name || ''),
    class_name: String(doc?.class_name || ''),
    section: String(doc?.section || 'A'),
    subject: String(doc?.subject || ''),
    academic_session: String(doc?.academic_session || '2026-2027'),
    assigned_date: String(doc?.assigned_date || fallbackDate),
    ...(doc?.is_class_teacher !== undefined ? { is_class_teacher: Boolean(doc.is_class_teacher) } : {}),
  };
}

export const TeacherAssignmentModel =
  mongoose.models.TeacherAssignment ||
  mongoose.model<ITeacherAssignment>('TeacherAssignment', TeacherAssignmentSchema);
