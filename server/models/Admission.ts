import mongoose, { Schema, type Document } from 'mongoose';

export interface IAdmission extends Document {
  record_id?: string;
  application_no: string;
  student_name: string;
  father_name: string;
  dob: string;
  gender: 'Male' | 'Female' | 'Other';
  class_applying: string;
  previous_school: string;
  parent_phone: string;
  parent_email: string;
  address: string;
  documents: { title: string; filename: string; verified?: boolean }[];
  status: 'Pending' | 'Under Review' | 'Approved' | 'Rejected' | 'Completed';
  remarks?: string;
  active_dedupe_key?: string;
  created_at: Date;
  updated_at: Date;
}

export function computeAdmissionDedupeKey(
  studentName: string,
  fatherName: string,
  classApplying: string,
  status: string
): string | undefined {
  if (status === 'Rejected') {
    return undefined;
  }
  const cleanName = String(studentName || '').trim().toLowerCase();
  const cleanFather = String(fatherName || '').trim().toLowerCase();
  const cleanClass = String(classApplying || '').trim().toLowerCase();
  if (!cleanName || !cleanFather || !cleanClass) {
    return undefined;
  }
  return `${cleanName}|${cleanFather}|${cleanClass}`;
}

export function toAdmissionDto(doc: any) {
  const createdIso =
    doc.created_at instanceof Date
      ? doc.created_at.toISOString()
      : typeof doc.created_at === 'string' && doc.created_at
      ? new Date(doc.created_at).toISOString()
      : new Date().toISOString();

  return {
    id: doc.record_id || String(doc._id),
    application_no: doc.application_no,
    student_name: doc.student_name,
    father_name: doc.father_name,
    dob: doc.dob || '',
    gender: doc.gender || 'Male',
    class_applying: doc.class_applying,
    previous_school: doc.previous_school || '',
    parent_phone: doc.parent_phone,
    parent_email: doc.parent_email || '',
    address: doc.address || '',
    documents: Array.isArray(doc.documents)
      ? doc.documents.map((d: any) => ({
          title: d?.title || '',
          filename: d?.filename || '',
          verified: Boolean(d?.verified),
        }))
      : [],
    status: doc.status || 'Pending',
    remarks: doc.remarks || '',
    created_at: createdIso,
  };
}

const AdmissionSchema = new Schema<IAdmission>(
  {
    record_id: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    application_no: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    student_name: {
      type: String,
      required: true,
      trim: true,
    },
    father_name: {
      type: String,
      required: true,
      trim: true,
    },
    dob: {
      type: String,
      default: '',
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      required: true,
    },
    class_applying: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    previous_school: {
      type: String,
      default: '',
    },
    parent_phone: {
      type: String,
      required: true,
      trim: true,
    },
    parent_email: {
      type: String,
      default: '',
      trim: true,
    },
    address: {
      type: String,
      default: '',
    },
    documents: [
      {
        title: { type: String, default: '' },
        filename: { type: String, default: '' },
        verified: { type: Boolean, default: false },
      },
    ],
    status: {
      type: String,
      enum: ['Pending', 'Under Review', 'Approved', 'Rejected', 'Completed'],
      default: 'Pending',
      index: true,
    },
    remarks: {
      type: String,
      default: '',
    },
    active_dedupe_key: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

AdmissionSchema.index({ created_at: -1, status: 1 });
AdmissionSchema.index({ student_name: 1, father_name: 1, class_applying: 1 });
AdmissionSchema.index({ parent_phone: 1 });
AdmissionSchema.index(
  { active_dedupe_key: 1 },
  {
    unique: true,
    partialFilterExpression: { active_dedupe_key: { $type: 'string' } },
  }
);

export const AdmissionModel = mongoose.models.Admission || mongoose.model<IAdmission>('Admission', AdmissionSchema);
