import mongoose, { Schema, type Document } from 'mongoose';

export type PayrollStatus = 'Unpaid' | 'Partially Paid' | 'Paid';

export interface IPayroll extends Document {
  record_id: string;
  staff_id: string;
  staff_name: string;
  designation: string;
  salary_month: number;
  salary_year: number;
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_salary: number;
  paid_amount: number;
  payment_date?: string;
  payment_method?: string;
  payment_history: Array<{ amount: number; payment_date: string; payment_method: string; recorded_by: string; recorded_at: string; idempotency_key?: string }>;
  notes?: string;
  status: PayrollStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const PayrollSchema = new Schema<IPayroll>({
  record_id: { type: String, required: true, unique: true, index: true },
  staff_id: { type: String, required: true, trim: true },
  staff_name: { type: String, required: true, trim: true, maxlength: 120 },
  designation: { type: String, required: true, trim: true, maxlength: 100 },
  salary_month: { type: Number, required: true, min: 1, max: 12 },
  salary_year: { type: Number, required: true, min: 2020, max: 2100 },
  basic_salary: { type: Number, required: true, min: 0 },
  allowances: { type: Number, default: 0, min: 0 },
  deductions: { type: Number, default: 0, min: 0 },
  net_salary: { type: Number, required: true, min: 0 },
  paid_amount: { type: Number, default: 0, min: 0 },
  payment_date: { type: String },
  payment_method: { type: String, enum: ['Cash','Bank Transfer','Cheque','JazzCash','Easypaisa','Other'] },
  payment_history: { type: [{ amount: { type: Number, required: true, min: 0.01 }, payment_date: { type: String, required: true }, payment_method: { type: String, required: true }, recorded_by: { type: String, required: true }, recorded_at: { type: String, required: true }, idempotency_key: { type: String, trim: true, maxlength: 100 } }], default: [] },
  notes: { type: String, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['Unpaid','Partially Paid','Paid'], default: 'Unpaid' },
  created_by: { type: String, required: true },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true },
}, { versionKey: false });

PayrollSchema.index({ staff_id: 1, salary_year: 1, salary_month: 1 }, { unique: true });
PayrollSchema.index({ salary_year: -1, salary_month: -1, status: 1 });

export const PayrollModel = mongoose.models.Payroll || mongoose.model<IPayroll>('Payroll', PayrollSchema);
