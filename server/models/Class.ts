import mongoose, { Schema, Document } from 'mongoose';

export interface IClass extends Document {
  record_id?: string;
  name: string;
  grade_level: string;
  stream: string;
  monthly_tuition_fee: number;
  capacity: number;
  class_teacher: string;
  created_at: Date;
  updated_at: Date;
}

const ClassSchema = new Schema<IClass>(
  {
    record_id: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    grade_level: {
      type: String,
      default: '',
      trim: true,
    },
    stream: {
      type: String,
      default: 'General',
      trim: true,
    },
    monthly_tuition_fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    capacity: {
      type: Number,
      default: 40,
      min: 1,
    },
    class_teacher: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ClassSchema.index({ created_at: 1, _id: 1 });

export function toClassDto(doc: any) {
  return {
    id: doc.record_id || String(doc._id),
    name: doc.name,
    grade_level: doc.grade_level ?? '',
    stream: doc.stream || 'General',
    monthly_tuition_fee:
      typeof doc.monthly_tuition_fee === 'number'
        ? doc.monthly_tuition_fee
        : Number(doc.monthly_tuition_fee) || 0,
    capacity: typeof doc.capacity === 'number' ? doc.capacity : Number(doc.capacity) || 40,
    class_teacher: doc.class_teacher ?? '',
  };
}

export const ClassModel = mongoose.models.Class || mongoose.model<IClass>('Class', ClassSchema);
