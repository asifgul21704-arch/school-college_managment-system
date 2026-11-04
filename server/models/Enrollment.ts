import mongoose, { Schema, Document } from 'mongoose';

export type EnrollmentStatus = 'Active' | 'Transferred' | 'Completed' | 'Dropped';

export interface IEnrollment extends Document {
  record_id?: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  academic_year: string;
  roll_no: string;
  enrollment_date: string;
  status: EnrollmentStatus;
  transfer_reason?: string;
  active_enrollment_key?: string;
  created_at: Date;
  updated_at: Date;
}

export interface EnrollmentDto {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  academic_year: string;
  roll_no: string;
  enrollment_date: string;
  status: EnrollmentStatus;
  transfer_reason?: string;
}

export function computeActiveEnrollmentKey(
  studentId: string,
  academicYear: string,
  status: string
): string | undefined {
  const sid = String(studentId || '').trim();
  const yr = String(academicYear || '').trim();
  if (!sid || !yr || status !== 'Active') {
    return undefined;
  }
  return `${sid}::${yr}`;
}

const EnrollmentSchema = new Schema<IEnrollment>(
  {
    record_id: {
      type: String,
      trim: true,
    },
    student_id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    student_name: {
      type: String,
      trim: true,
      default: '',
    },
    class_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    section: {
      type: String,
      trim: true,
      default: 'A',
    },
    academic_year: {
      type: String,
      trim: true,
      default: '2026-2027',
      index: true,
    },
    roll_no: {
      type: String,
      trim: true,
      default: '',
    },
    enrollment_date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    status: {
      type: String,
      enum: ['Active', 'Transferred', 'Completed', 'Dropped'],
      default: 'Active',
      index: true,
    },
    transfer_reason: {
      type: String,
      trim: true,
    },
    active_enrollment_key: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

EnrollmentSchema.index({ record_id: 1 }, { unique: true, sparse: true });
EnrollmentSchema.index({ active_enrollment_key: 1 }, { unique: true, sparse: true });
EnrollmentSchema.index({ student_id: 1, academic_year: 1 });

export function toEnrollmentDto(doc: any): EnrollmentDto {
  const id = String(doc?.record_id || doc?.id || doc?._id || '');
  return {
    id,
    student_id: String(doc?.student_id || ''),
    student_name: String(doc?.student_name || ''),
    class_name: String(doc?.class_name || ''),
    section: String(doc?.section || 'A'),
    academic_year: String(doc?.academic_year || '2026-2027'),
    roll_no: String(doc?.roll_no || ''),
    enrollment_date: String(doc?.enrollment_date || ''),
    status: (doc?.status || 'Active') as EnrollmentStatus,
    ...(doc?.transfer_reason ? { transfer_reason: String(doc.transfer_reason) } : {}),
  };
}

export const EnrollmentModel =
  mongoose.models.Enrollment || mongoose.model<IEnrollment>('Enrollment', EnrollmentSchema);
