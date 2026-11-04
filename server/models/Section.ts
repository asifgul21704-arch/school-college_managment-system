import mongoose, { Schema, Document } from 'mongoose';

export interface ISection extends Document {
  record_id?: string;
  name: string;
  class_name: string;
  capacity: number;
  room: string;
  teacher_name: string;
  created_at: Date;
  updated_at: Date;
}

const SectionSchema = new Schema<ISection>(
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
      trim: true,
    },
    class_name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    capacity: {
      type: Number,
      default: 40,
      min: 1,
    },
    room: {
      type: String,
      default: '',
      trim: true,
    },
    teacher_name: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

SectionSchema.index({ class_name: 1, name: 1 }, { unique: true });
SectionSchema.index({ created_at: 1, _id: 1 });

export function toSectionDto(doc: any) {
  return {
    id: doc.record_id || String(doc._id),
    name: doc.name,
    class_name: doc.class_name,
    capacity: typeof doc.capacity === 'number' ? doc.capacity : Number(doc.capacity) || 40,
    room: doc.room ?? '',
    teacher_name: doc.teacher_name ?? '',
  };
}

export const SectionModel = mongoose.models.Section || mongoose.model<ISection>('Section', SectionSchema);
