import mongoose, { Schema, Document } from 'mongoose';
import type { FeePaymentMethod } from './Fee.ts';

export type PaymentLifecycleStatus =
  | 'Initiated'
  | 'Pending Verification'
  | 'Processing'
  | 'Paid'
  | 'Failed'
  | 'Rejected'
  | 'Refunded';

export type PaymentVerificationStatus = 'Pending' | 'Verified' | 'Rejected';

export interface IFeePayment extends Document {
  fee_id: string;
  student_id: string;
  payment_reference: string;
  receipt_no?: string;
  transaction_id?: string;
  date: string;
  amount: number;
  method: FeePaymentMethod;
  status: PaymentLifecycleStatus;
  verification_status: PaymentVerificationStatus;
  parent_user_id?: string;
  parent_name?: string;
  parent_phone?: string;
  student_name?: string;
  admission_no?: string;
  class_name?: string;
  fee_month?: string;
  year?: number;
  notes?: string;
  received_by?: string;
  gateway_provider?: string;
  bank_name?: string;
  account_number?: string;
  deposit_date?: string;
  deposit_slip_ref?: string;
  receipt_attachment_url?: string;
  verified_by_id?: string;
  verified_by_name?: string;
  verified_at?: string;
  rejection_reason?: string;
  sms_status?: 'Pending' | 'Delivered' | 'Failed' | 'Skipped';
  sms_message?: string;
  sms_sent_at?: string;
  created_at: Date;
  updated_at: Date;
}

export interface FeePaymentDto {
  id: string;
  fee_id: string;
  student_id: string;
  payment_reference: string;
  receipt_no: string;
  transaction_id?: string;
  date: string;
  amount: number;
  method: FeePaymentMethod;
  status: PaymentLifecycleStatus;
  verification_status: PaymentVerificationStatus;
  parent_user_id?: string;
  parent_name?: string;
  parent_phone?: string;
  student_name?: string;
  admission_no?: string;
  class_name?: string;
  fee_month?: string;
  year?: number;
  notes: string;
  received_by: string;
  gateway_provider?: string;
  bank_name?: string;
  account_number?: string;
  deposit_date?: string;
  deposit_slip_ref?: string;
  receipt_attachment_url?: string;
  verified_by_id?: string;
  verified_by_name?: string;
  verified_at?: string;
  rejection_reason?: string;
  sms_status?: string;
  sms_message?: string;
  sms_sent_at?: string;
  created_at?: string;
}

const FeePaymentSchema = new Schema<IFeePayment>(
  {
    fee_id: {
      type: String,
      required: true,
      index: true,
    },
    student_id: {
      type: String,
      required: true,
      index: true,
    },
    payment_reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    receipt_no: {
      type: String,
      default: '',
      trim: true,
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
    status: {
      type: String,
      enum: ['Initiated', 'Pending Verification', 'Processing', 'Paid', 'Failed', 'Rejected', 'Refunded'],
      default: 'Paid',
      index: true,
    },
    verification_status: {
      type: String,
      enum: ['Pending', 'Verified', 'Rejected'],
      default: 'Verified',
      index: true,
    },
    parent_user_id: {
      type: String,
      default: '',
      index: true,
    },
    parent_name: {
      type: String,
      default: '',
    },
    parent_phone: {
      type: String,
      default: '',
    },
    student_name: {
      type: String,
      default: '',
    },
    admission_no: {
      type: String,
      default: '',
    },
    class_name: {
      type: String,
      default: '',
    },
    fee_month: {
      type: String,
      default: '',
    },
    year: {
      type: Number,
    },
    notes: {
      type: String,
      default: '',
    },
    received_by: {
      type: String,
      default: '',
    },
    gateway_provider: {
      type: String,
      default: '',
    },
    bank_name: {
      type: String,
      default: '',
    },
    account_number: {
      type: String,
      default: '',
    },
    deposit_date: {
      type: String,
      default: '',
    },
    deposit_slip_ref: {
      type: String,
      default: '',
    },
    receipt_attachment_url: {
      type: String,
      default: '',
    },
    verified_by_id: {
      type: String,
      default: '',
    },
    verified_by_name: {
      type: String,
      default: '',
    },
    verified_at: {
      type: String,
      default: '',
    },
    rejection_reason: {
      type: String,
      default: '',
    },
    sms_status: {
      type: String,
      enum: ['Pending', 'Delivered', 'Failed', 'Skipped'],
      default: 'Pending',
    },
    sms_message: {
      type: String,
      default: '',
    },
    sms_sent_at: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

FeePaymentSchema.index({ student_id: 1, date: -1 });

FeePaymentSchema.index({ transaction_id: 1 }, { unique: true, sparse: true });
FeePaymentSchema.index({ receipt_no: 1 }, { sparse: true });
FeePaymentSchema.index({ status: 1, created_at: -1 });

export function toFeePaymentDto(doc: any): FeePaymentDto {
  return {
    id: String(doc._id ? doc._id.toString() : ''),
    fee_id: String(doc.fee_id || ''),
    student_id: String(doc.student_id || ''),
    payment_reference: String(doc.payment_reference || doc.receipt_no || `PAY-${doc._id}`),
    receipt_no: String(doc.receipt_no || ''),
    ...(doc.transaction_id ? { transaction_id: String(doc.transaction_id) } : {}),
    date: String(doc.date || ''),
    amount: Number(doc.amount || 0),
    method: (doc.method || 'Cash') as FeePaymentMethod,
    status: (doc.status || (doc.verification_status === 'Pending' ? 'Pending Verification' : 'Paid')) as PaymentLifecycleStatus,
    verification_status: (doc.verification_status || (doc.status === 'Paid' ? 'Verified' : 'Pending')) as PaymentVerificationStatus,
    parent_user_id: doc.parent_user_id ? String(doc.parent_user_id) : undefined,
    parent_name: doc.parent_name ? String(doc.parent_name) : undefined,
    parent_phone: doc.parent_phone ? String(doc.parent_phone) : undefined,
    student_name: doc.student_name ? String(doc.student_name) : undefined,
    admission_no: doc.admission_no ? String(doc.admission_no) : undefined,
    class_name: doc.class_name ? String(doc.class_name) : undefined,
    fee_month: doc.fee_month ? String(doc.fee_month) : undefined,
    year: doc.year ? Number(doc.year) : undefined,
    notes: String(doc.notes || ''),
    received_by: String(doc.received_by || ''),
    gateway_provider: doc.gateway_provider ? String(doc.gateway_provider) : undefined,
    bank_name: doc.bank_name ? String(doc.bank_name) : undefined,
    account_number: doc.account_number ? String(doc.account_number) : undefined,
    deposit_date: doc.deposit_date ? String(doc.deposit_date) : undefined,
    deposit_slip_ref: doc.deposit_slip_ref ? String(doc.deposit_slip_ref) : undefined,
    receipt_attachment_url: doc.receipt_attachment_url ? String(doc.receipt_attachment_url) : undefined,
    verified_by_id: doc.verified_by_id ? String(doc.verified_by_id) : undefined,
    verified_by_name: doc.verified_by_name ? String(doc.verified_by_name) : undefined,
    verified_at: doc.verified_at ? String(doc.verified_at) : undefined,
    rejection_reason: doc.rejection_reason ? String(doc.rejection_reason) : undefined,
    sms_status: doc.sms_status ? String(doc.sms_status) : undefined,
    sms_message: doc.sms_message ? String(doc.sms_message) : undefined,
    sms_sent_at: doc.sms_sent_at ? String(doc.sms_sent_at) : undefined,
    created_at: doc.created_at ? new Date(doc.created_at).toISOString() : undefined,
  };
}

export const FeePaymentModel =
  mongoose.models.FeePayment || mongoose.model<IFeePayment>('FeePayment', FeePaymentSchema);

