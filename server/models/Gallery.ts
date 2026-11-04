import mongoose, { Schema, type Document } from 'mongoose';

export interface IGalleryItem extends Document {
  record_id?: string;
  title: string;
  caption: string;
  category: 'Campus' | 'Academics' | 'Sports' | 'Events' | 'Laboratories';
  image_url: string;
  date: string;
  created_at: Date;
  updated_at: Date;
}

export function toGalleryItemDto(doc: any) {
  return {
    id: doc.record_id || String(doc._id),
    title: doc.title || '',
    caption: doc.caption || '',
    category: doc.category || 'Campus',
    image_url: doc.image_url || '',
    date: doc.date || new Date().toISOString().split('T')[0],
  };
}

const GallerySchema = new Schema<IGalleryItem>(
  {
    record_id: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    caption: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      enum: ['Campus', 'Academics', 'Sports', 'Events', 'Laboratories'],
      default: 'Campus',
      index: true,
    },
    image_url: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
      index: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

GallerySchema.index({ category: 1, created_at: -1 });
GallerySchema.index({ date: -1, created_at: -1 });

export const GalleryModel = mongoose.models.Gallery || mongoose.model<IGalleryItem>('Gallery', GallerySchema);
