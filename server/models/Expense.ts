import mongoose, { Schema, type Document } from 'mongoose';

export type ExpenseCategory = 'Utilities' | 'Salaries' | 'Maintenance' | 'Supplies' | 'Transport' | 'Events' | 'Other';

export interface IExpense extends Document {
  record_id: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  expense_date: string;
  payment_method: string;
  reference?: string;
  notes?: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

const ExpenseSchema = new Schema<IExpense>({
  record_id: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, enum: ['Utilities','Salaries','Maintenance','Supplies','Transport','Events','Other'], default: 'Other', required: true },
  amount: { type: Number, required: true, min: [0.01, 'Expense amount must be greater than zero'] },
  expense_date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  payment_method: { type: String, enum: ['Cash','Bank Transfer','Cheque','JazzCash','Easypaisa','Other'], default: 'Cash' },
  reference: { type: String, trim: true, maxlength: 100 },
  notes: { type: String, trim: true, maxlength: 1000 },
  created_by: { type: String, required: true },
  created_by_name: { type: String, required: true },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true },
}, { versionKey: false });

ExpenseSchema.index({ expense_date: -1, category: 1 });
ExpenseSchema.index({ created_at: -1 });

export const ExpenseModel = mongoose.models.Expense || mongoose.model<IExpense>('Expense', ExpenseSchema);
