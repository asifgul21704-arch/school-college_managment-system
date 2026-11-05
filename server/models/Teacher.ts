import mongoose, { Schema, Document } from 'mongoose';

export interface ITeacher extends Document {
  record_id?: string;
  user_id?: string;
  name: string;
  father_name?: string;
  cnic?: string;
  profile_photo?: string;
  qualification: string;
  subject: string;
  specialization?: string;
  classes: string[];
  contact_no: string;
  email?: string;
  joining_date: string;
  experience: string;
  status: 'Active' | 'Pending' | 'On Leave' | 'Resigned' | 'Suspended';
  bio: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeacherDto {
  id: string;
  user_id?: string;
  name: string;
  father_name?: string;
  cnic?: string;
  profile_photo: string;
  qualification: string;
  subject: string;
  specialization?: string;
  classes: string[];
  contact_no: string;
  email: string;
  joining_date: string;
  experience: string;
  status: 'Active' | 'Pending' | 'On Leave' | 'Resigned' | 'Suspended';
  bio: string;
}

const TeacherSchema = new Schema<ITeacher>(
  {
    record_id: {
      type: String,
      trim: true,
    },
    user_id: {
      type: String,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    father_name: {
      type: String,
      trim: true,
      default: '',
    },
    cnic: {
      type: String,
      trim: true,
      default: '',
    },
    profile_photo: {
      type: String,
      default: '',
    },
    qualification: {
      type: String,
      trim: true,
      default: '',
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    specialization: {
      type: String,
      trim: true,
      default: '',
    },
    classes: {
      type: [String],
      default: [],
    },
    contact_no: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    joining_date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    experience: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['Active', 'Pending', 'On Leave', 'Resigned', 'Suspended'],
      default: 'Active',
      index: true,
    },
    bio: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

TeacherSchema.index({ record_id: 1 }, { unique: true, sparse: true });
TeacherSchema.index({ email: 1 }, { unique: true, sparse: true });

export function toTeacherDto(doc: any): TeacherDto {
  const id = String(doc?.record_id || doc?.id || doc?._id || '');
  const rawStatus = String(doc?.status || 'Active');
  const validStatus = ['Active', 'Pending', 'On Leave', 'Resigned', 'Suspended'].includes(rawStatus)
    ? (rawStatus as 'Active' | 'Pending' | 'On Leave' | 'Resigned' | 'Suspended')
    : 'Active';

  return {
    id,
    ...(doc?.user_id ? { user_id: String(doc.user_id) } : {}),
    name: String(doc?.name || ''),
    father_name: String(doc?.father_name || ''),
    cnic: String(doc?.cnic || ''),
    profile_photo: String(doc?.profile_photo || ''),
    qualification: String(doc?.qualification || ''),
    subject: String(doc?.subject || ''),
    specialization: String(doc?.specialization || doc?.subject || ''),
    classes: Array.isArray(doc?.classes) ? doc.classes.map((c: unknown) => String(c)).filter(Boolean) : [],
    contact_no: String(doc?.contact_no || ''),
    email: doc?.email ? String(doc.email).toLowerCase() : '',
    joining_date: String(doc?.joining_date || ''),
    experience: String(doc?.experience || ''),
    status: validStatus,
    bio: String(doc?.bio || ''),
  };
}

export const TeacherModel = mongoose.models.Teacher || mongoose.model<ITeacher>('Teacher', TeacherSchema);
