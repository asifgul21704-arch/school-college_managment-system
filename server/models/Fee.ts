import mongoose, { Schema, Document } from 'mongoose';

export type FeePaymentMethod =
  | 'Cash'
  | 'Bank Deposit'
  | 'Bank Transfer'
  | 'Easypaisa / JazzCash'
  | 'Online Slip';

export type FeeVoucherStatus = 'Paid' | 'Unpaid' | 'Partial' | 'Overdue';

export interface IFeePaymentHistory {
  receipt_no: string;
  date: string;
  amount: number;
  method: FeePaymentMethod;
  transaction_id?: string;
  notes?: string;
}

export interface IFee extends Document {
  voucher_id?: string;
  student_id: string;
  student_name: string;
  class_name: string;
  fee_month: string;
  fee_month_key?: string;
  year: number;
  tuition_fee: number;
  admission_fee: number;
  other_charges: number;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  due_date: string;
  status: FeeVoucherStatus;
  payment_history: IFeePaymentHistory[];
  created_at: Date;
  updated_at: Date;
}

export interface FeePaymentHistoryDto {
  receipt_no: string;
  date: string;
  amount: number;
  method: FeePaymentMethod;
  transaction_id?: string;
  notes?: string;
}

export interface FeeDto {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  fee_month: string;
  year: number;
  tuition_fee: number;
  admission_fee: number;
  other_charges: number;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  due_date: string;
  status: FeeVoucherStatus;
  payment_history: FeePaymentHistoryDto[];
}

const FeeSchema = new Schema<IFee>(
  {
    voucher_id: {
      type: String,
      trim: true,
    },
    student_id: {
      type: String,
      required: true,
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
    },
    fee_month: {
      type: String,
      required: true,
      trim: true,
    },
    fee_month_key: {
      type: String,
      trim: true,
      lowercase: true,
    },
    year: {
      type: Number,
      required: true,
    },
    tuition_fee: {
      type: Number,
      default: 0,
      min: [0, 'Tuition fee cannot be negative'],
    },
    admission_fee: {
      type: Number,
      default: 0,
      min: [0, 'Admission fee cannot be negative'],
    },
    other_charges: {
      type: Number,
      default: 0,
      min: [0, 'Other charges cannot be negative'],
    },
    total_amount: {
      type: Number,
      required: true,
      min: [0, 'Total fee amount cannot be negative'],
    },
    paid_amount: {
      type: Number,
      default: 0,
      min: [0, 'Paid amount cannot be negative'],
    },
    pending_amount: {
      type: Number,
      default: 0,
      min: [0, 'Pending amount cannot be negative'],
    },
    due_date: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['Paid', 'Unpaid', 'Partial', 'Overdue'],
      default: 'Unpaid',
    },
    payment_history: [
      {
        receipt_no: { type: String, required: true },
        date: { type: String, required: true },
        amount: { type: Number, required: true, min: [1, 'Payment amount must be greater than zero'] },
        method: { type: String, default: 'Cash' },
        transaction_id: { type: String, default: '' },
        notes: { type: String, default: '' },
      },
    ],
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

FeeSchema.pre('validate', function () {
  if (this.fee_month && !this.fee_month_key) {
    this.fee_month_key = String(this.fee_month).trim().toLowerCase();
  }
});

FeeSchema.index({ voucher_id: 1 }, { unique: true, sparse: true });
FeeSchema.index({ student_id: 1, fee_month: 1, year: 1 }, { unique: true });
FeeSchema.index({ student_id: 1, fee_month_key: 1, year: 1 }, { unique: true, sparse: true });
FeeSchema.index({ student_id: 1, status: 1 });
FeeSchema.index({ status: 1, fee_month: 1, year: 1 });
FeeSchema.index({ class_name: 1, status: 1 });

export function toFeeDto(doc: any): FeeDto {
  return {
    id: String(doc.voucher_id || doc.record_id || doc.id || (doc._id ? doc._id.toString() : '')),
    student_id: String(doc.student_id || ''),
    student_name: String(doc.student_name || ''),
    class_name: String(doc.class_name || ''),
    fee_month: String(doc.fee_month || ''),
    year: Number(doc.year || 2026),
    tuition_fee: Number(doc.tuition_fee ?? 0),
    admission_fee: Number(doc.admission_fee ?? 0),
    other_charges: Number(doc.other_charges ?? 0),
    total_amount: Number(doc.total_amount ?? 0),
    paid_amount: Number(doc.paid_amount ?? 0),
    pending_amount: Number(doc.pending_amount ?? 0),
    due_date: String(doc.due_date || ''),
    status: (doc.status || 'Unpaid') as FeeVoucherStatus,
    payment_history: Array.isArray(doc.payment_history)
      ? doc.payment_history.map((p: any) => ({
          receipt_no: String(p.receipt_no || ''),
          date: String(p.date || ''),
          amount: Number(p.amount || 0),
          method: (p.method || 'Cash') as FeePaymentMethod,
          ...(p.transaction_id ? { transaction_id: String(p.transaction_id) } : {}),
          ...(p.notes !== undefined ? { notes: String(p.notes ?? '') } : {}),
        }))
      : [],
  };
}

export const FeeModel = mongoose.models.Fee || mongoose.model<IFee>('Fee', FeeSchema);
