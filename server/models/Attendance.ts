import mongoose, { Schema, Document } from 'mongoose';

export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Leave';

export interface IAttendance extends Document {
  record_id?: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  remarks?: string;
  marked_by?: string;
  academic_session?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AttendanceDto {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  date: string;
  status: AttendanceStatus;
  remarks?: string;
  marked_by: string;
  academic_session?: string;
}

const AttendanceSchema = new Schema<IAttendance>(
  {
    record_id: {
      type: String,
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
      required: true,
      trim: true,
      default: 'A',
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['Present', 'Absent', 'Late', 'Leave'],
      required: true,
      default: 'Present',
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
    marked_by: {
      type: String,
      trim: true,
      default: '',
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

AttendanceSchema.index({ record_id: 1 }, { unique: true, sparse: true });
AttendanceSchema.index({ student_id: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ class_name: 1, date: 1 });
AttendanceSchema.index({ class_name: 1, section: 1, date: 1 });
AttendanceSchema.index({ student_id: 1, status: 1, date: -1 });
AttendanceSchema.index({ date: -1, status: 1 });

export function toAttendanceDto(doc: any): AttendanceDto {
  return {
    id: String(doc.record_id || doc.id || (doc._id ? doc._id.toString() : '')),
    student_id: String(doc.student_id || ''),
    student_name: String(doc.student_name || ''),
    class_name: String(doc.class_name || ''),
    section: String(doc.section || 'A'),
    date: String(doc.date || ''),
    status: (doc.status || 'Present') as AttendanceStatus,
    remarks: String(doc.remarks ?? ''),
    marked_by: String(doc.marked_by || ''),
    ...(doc.academic_session ? { academic_session: String(doc.academic_session) } : {}),
  };
}

export const AttendanceModel =
  mongoose.models.Attendance || mongoose.model<IAttendance>('Attendance', AttendanceSchema);
