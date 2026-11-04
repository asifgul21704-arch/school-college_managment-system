import mongoose, { Schema, Document } from 'mongoose';

export interface IStudent extends Document {
  record_id?: string;
  admission_no: string;
  roll_no: string;
  full_name: string;
  father_name: string;
  dob: string;
  gender: 'Male' | 'Female' | 'Other';
  class_name: string;
  section: string;
  contact_no: string;
  address: string;
  emergency_contact: string;
  profile_image?: string;
  admission_date: string;
  academic_status: 'Active' | 'Inactive' | 'Graduated' | 'Suspended';
  parent_user_id?: string;
  user_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface StudentDto {
  id: string;
  admission_no: string;
  roll_no: string;
  full_name: string;
  father_name: string;
  dob: string;
  gender: 'Male' | 'Female' | 'Other';
  class_name: string;
  section: string;
  contact_no: string;
  address: string;
  emergency_contact: string;
  profile_image?: string;
  admission_date: string;
  academic_status: 'Active' | 'Inactive' | 'Graduated' | 'Suspended';
  parent_user_id?: string;
  user_id?: string;
}

const StudentSchema = new Schema<IStudent>(
  {
    record_id: {
      type: String,
      trim: true,
    },
    admission_no: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    roll_no: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    full_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    father_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
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
    contact_no: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    emergency_contact: {
      type: String,
      trim: true,
      default: '',
    },
    profile_image: {
      type: String,
      default: '',
    },
    admission_date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    academic_status: {
      type: String,
      enum: ['Active', 'Inactive', 'Graduated', 'Suspended'],
      default: 'Active',
      index: true,
    },
    parent_user_id: {
      type: String,
      trim: true,
    },
    user_id: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

StudentSchema.index({ record_id: 1 }, { unique: true, sparse: true });
StudentSchema.index({ user_id: 1 }, { unique: true, sparse: true });
StudentSchema.index({ class_name: 1, section: 1, roll_no: 1 }, { unique: true, sparse: true });
StudentSchema.index({ class_name: 1, academic_status: 1 });
StudentSchema.index({ parent_user_id: 1 });

export function toStudentDto(doc: any): StudentDto {
  const id = String(doc?.record_id || doc?.id || doc?._id || '');
  return {
    id,
    admission_no: String(doc?.admission_no || ''),
    roll_no: String(doc?.roll_no || ''),
    full_name: String(doc?.full_name || ''),
    father_name: String(doc?.father_name || ''),
    dob: doc?.dob !== undefined && doc?.dob !== null ? String(doc.dob) : '',
    gender: (doc?.gender === 'Female' || doc?.gender === 'Other' ? doc.gender : 'Male') as 'Male' | 'Female' | 'Other',
    class_name: String(doc?.class_name || ''),
    section: String(doc?.section || 'A'),
    contact_no: String(doc?.contact_no || ''),
    address: String(doc?.address || ''),
    emergency_contact: String(doc?.emergency_contact || ''),
    ...(doc?.profile_image ? { profile_image: String(doc.profile_image) } : {}),
    admission_date: String(doc?.admission_date || ''),
    academic_status: (doc?.academic_status || 'Active') as 'Active' | 'Inactive' | 'Graduated' | 'Suspended',
    ...(doc?.parent_user_id ? { parent_user_id: String(doc.parent_user_id) } : {}),
    ...(doc?.user_id ? { user_id: String(doc.user_id) } : {}),
  };
}

export const StudentModel = mongoose.models.Student || mongoose.model<IStudent>('Student', StudentSchema);
