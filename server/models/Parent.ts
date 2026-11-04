import mongoose, { Schema, Document } from 'mongoose';

export interface IParent extends Document {
  record_id?: string;
  user_id: string;
  name: string;
  father_name?: string;
  phone: string;
  email: string;
  address?: string;
  occupation?: string;
  linked_students: string[];
  created_at: Date;
  updated_at: Date;
}

export interface ParentDto {
  id: string;
  user_id: string;
  name: string;
  father_name: string;
  phone: string;
  email: string;
  address: string;
  occupation: string;
  linked_students: string[];
  created_at: string;
}

const ParentSchema = new Schema<IParent>(
  {
    record_id: {
      type: String,
      trim: true,
    },
    user_id: {
      type: String,
      required: true,
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
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    occupation: {
      type: String,
      trim: true,
      default: '',
    },
    linked_students: {
      type: [String],
      default: [],
      index: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ParentSchema.index({ record_id: 1 }, { unique: true, sparse: true });

export function toParentDto(doc: any): ParentDto {
  const id = String(doc?.record_id || doc?.id || doc?._id || '');
  const createdRaw = doc?.created_at;
  const createdIso =
    createdRaw instanceof Date
      ? createdRaw.toISOString()
      : typeof createdRaw === 'string' && createdRaw
      ? createdRaw
      : new Date().toISOString();

  return {
    id,
    user_id: String(doc?.user_id || ''),
    name: String(doc?.name || ''),
    father_name: String(doc?.father_name || ''),
    phone: String(doc?.phone || ''),
    email: String(doc?.email || '').toLowerCase(),
    address: String(doc?.address || ''),
    occupation: String(doc?.occupation || ''),
    linked_students: Array.isArray(doc?.linked_students)
      ? doc.linked_students.map((s: unknown) => String(s)).filter(Boolean)
      : [],
    created_at: createdIso,
  };
}

export const ParentModel = mongoose.models.Parent || mongoose.model<IParent>('Parent', ParentSchema);
