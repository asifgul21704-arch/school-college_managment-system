import mongoose, { Schema, type Document } from 'mongoose';

export interface IStoredDocument extends Document {
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  visibility: 'public' | 'private';
  category: 'school_media' | 'student_document' | 'admission_document';
  uploaded_by_user_id: string;
  uploaded_by_role: string;
  student_id?: string;
  application_no?: string;
  storage_backend: 'local_fs';
  relative_path: string;
  created_at: Date;
  updated_at: Date;
}

const StoredDocumentSchema = new Schema<IStoredDocument>(
  {
    filename: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    original_name: {
      type: String,
      required: true,
      trim: true,
    },
    mime_type: {
      type: String,
      required: true,
      trim: true,
    },
    size_bytes: {
      type: Number,
      required: true,
      min: 1,
    },
    visibility: {
      type: String,
      enum: ['public', 'private'],
      required: true,
      default: 'private',
      index: true,
    },
    category: {
      type: String,
      enum: ['school_media', 'student_document', 'admission_document'],
      default: 'student_document',
      index: true,
    },
    uploaded_by_user_id: {
      type: String,
      required: true,
      index: true,
    },
    uploaded_by_role: {
      type: String,
      required: true,
    },
    student_id: {
      type: String,
      default: '',
      index: true,
    },
    application_no: {
      type: String,
      default: '',
      index: true,
    },
    storage_backend: {
      type: String,
      enum: ['local_fs'],
      default: 'local_fs',
    },
    relative_path: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const StoredDocumentModel =
  mongoose.models.StoredDocument || mongoose.model<IStoredDocument>('StoredDocument', StoredDocumentSchema);
