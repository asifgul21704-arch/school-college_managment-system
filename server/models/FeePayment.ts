import mongoose, { Schema, Document } from 'mongoose';
import type { FeePaymentMethod } from './Fee.ts';

export interface IFeePayment extends Document {
  fee_id: string;
  student_id: string;
  receipt_no: string;
  transaction_id?: string;
  date: string;
  amount: number;
  method: FeePaymentMethod;
  notes?: string;
  received_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface FeePaymentDto {
  id: string;
  fee_id: string;
  student_id: string;
  receipt_no: string;
  transaction_id?: string;
  date: string;
  amount: number;
  method: FeePaymentMethod;
  notes: string;
  received_by: string;
}

const FeePaymentSchema = new Schema<IFeePayment>(
  {
    fee_id: {
      type: String,
      required: true,
    },
    student_id: {
      type: String,
      required: true,
    },
    receipt_no: {
      type: String,
      required: true,
      unique: true,
    },
    transaction_id: {
      type: String,
      trim: true,
      set: (val: unknown) => {
        if (typeof val !== 'string') return undefined;
        const clean = val.trim();
        return clean ? clean : undefined;
      },
    },
    date: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Payment amount must be greater than zero'],
    },
    method: {
      type: String,
      enum: ['Cash', 'Bank Deposit', 'Bank Transfer', 'Easypaisa / JazzCash', 'Online Slip'],
      default: 'Cash',
    },
    notes: {
      type: String,
      default: '',
    },
    received_by: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

FeePaymentSchema.index({ student_id: 1, date: -1 });
FeePaymentSchema.index({ fee_id: 1 });
FeePaymentSchema.index({ transaction_id: 1 }, { unique: true, sparse: true });

export function toFeePaymentDto(doc: any): FeePaymentDto {
  return {
    id: String(doc._id ? doc._id.toString() : ''),
    fee_id: String(doc.fee_id || ''),
    student_id: String(doc.student_id || ''),
    receipt_no: String(doc.receipt_no || ''),
    ...(doc.transaction_id ? { transaction_id: String(doc.transaction_id) } : {}),
    date: String(doc.date || ''),
    amount: Number(doc.amount || 0),
    method: (doc.method || 'Cash') as FeePaymentMethod,
    notes: String(doc.notes || ''),
    received_by: String(doc.received_by || ''),
  };
}

export const FeePaymentModel =
  mongoose.models.FeePayment || mongoose.model<IFeePayment>('FeePayment', FeePaymentSchema);
