import express, { type Response } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requireRole, type AuthenticatedRequest } from './auth.ts';
import { ExpenseModel, PayrollModel, AuditLogModel, FeePaymentModel, TeacherModel } from './models/index.ts';
import { calculatePayrollNet, getPayrollStatus, isValidIsoDate } from './financeUtils.ts';

export const financeRouter = express.Router();
financeRouter.use(authenticateToken, requireRole(['super_admin', 'admin']));

function dbReady(res: Response): boolean {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: 'Finance service is temporarily unavailable because the database is offline. No changes were saved.' });
  return false;
}

function audit(req: AuthenticatedRequest, action: string, targetType: string, targetId: string, details: string) {
  return AuditLogModel.create({
    user_id: req.user?.id || 'unknown',
    user_name: req.user?.name || 'Administrator',
    user_role: req.user?.role || 'admin',
    action,
    target_type: targetType,
    target_id: targetId,
    details,
    timestamp: new Date().toISOString(),
  });
}

function cleanText(value: unknown, max = 160): string {
  return String(value ?? '').trim().slice(0, max);
}

financeRouter.get('/expenses', async (req: AuthenticatedRequest, res: Response) => {
  if (!dbReady(res)) return;
  try {
    const filter: Record<string, any> = {};
    if (req.query.from || req.query.to) {
      filter.expense_date = {};
      if (req.query.from) filter.expense_date.$gte = cleanText(req.query.from, 10);
      if (req.query.to) filter.expense_date.$lte = cleanText(req.query.to, 10);
    }
    if (req.query.category) filter.category = cleanText(req.query.category, 40);
    const rows = await ExpenseModel.find(filter).sort({ expense_date: -1, created_at: -1 }).limit(2000).lean();
    return res.json(rows.map(row => ({ ...row, id: row.record_id })));
  } catch {
    return res.status(500).json({ error: 'Unable to load expense records.' });
  }
});

financeRouter.get('/collections', async (req: AuthenticatedRequest, res: Response) => {
  if (!dbReady(res)) return;
  try {
    const filter: Record<string, any> = { status: 'Paid', verification_status: 'Verified' };
    const month = cleanText(req.query.month, 7);
    if (month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'Month must use YYYY-MM format.' });
      filter.date = { $gte: `${month}-01`, $lte: `${month}-31` };
    }
    if (req.query.class_name) filter.class_name = cleanText(req.query.class_name, 100);
    const rows = await FeePaymentModel.find(filter).sort({ date: -1, created_at: -1 }).limit(5000).lean();
    return res.json(rows.map(row => ({
      id: String(row._id),
      date: row.date,
      amount: Number(row.amount || 0),
      method: row.method,
      receipt_no: row.receipt_no || '',
      student_id: row.student_id,
      student_name: row.student_name || '',
      class_name: row.class_name || '',
      fee_month: row.fee_month || '',
      year: row.year || null,
      verification_status: row.verification_status,
    })));
  } catch {
    return res.status(500).json({ error: 'Unable to load verified fee collections.' });
  }
});

financeRouter.post('/expenses', async (req: AuthenticatedRequest, res: Response) => {
  if (!dbReady(res)) return;
  try {
    const title = cleanText(req.body?.title);
    const category = cleanText(req.body?.category, 40);
    const amount = Number(req.body?.amount);
    const expenseDate = cleanText(req.body?.expense_date, 10);
    const allowedCategories = ['Utilities', 'Salaries', 'Maintenance', 'Supplies', 'Transport', 'Events', 'Other'];
    const allowedMethods = ['Cash', 'Bank Transfer', 'Cheque', 'JazzCash', 'Easypaisa', 'Other'];
    const method = cleanText(req.body?.payment_method || 'Cash', 30);
    if (!title || !allowedCategories.includes(category) || !Number.isFinite(amount) || amount <= 0 || !isValidIsoDate(expenseDate) || !allowedMethods.includes(method)) {
      return res.status(400).json({ error: 'Provide a valid title, category, positive amount, date and payment method.' });
    }
    const now = new Date().toISOString();
    const recordId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const row = await ExpenseModel.create({
      record_id: recordId, title, category, amount: Number(amount.toFixed(2)), expense_date: expenseDate,
      payment_method: method, reference: cleanText(req.body?.reference, 100), notes: cleanText(req.body?.notes, 1000),
      created_by: req.user?.id || 'unknown', created_by_name: req.user?.name || 'Administrator',
      created_at: now, updated_at: now,
    });
    await audit(req, 'FINANCE_EXPENSE_CREATED', 'Expense', recordId, `Created ${category} expense: PKR ${amount}`);
    return res.status(201).json({ ...row.toObject(), id: recordId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.code === 11000 ? 'Duplicate expense record.' : 'Unable to save expense record.' });
  }
});

financeRouter.put('/expenses/:id', async (req: AuthenticatedRequest, res: Response) => {
  if (!dbReady(res)) return;
  try {
    const updates: Record<string, any> = {};
    if (req.body?.title !== undefined) updates.title = cleanText(req.body.title);
    if (req.body?.category !== undefined) updates.category = cleanText(req.body.category, 40);
    if (req.body?.amount !== undefined) updates.amount = Number(req.body.amount);
    if (req.body?.expense_date !== undefined) updates.expense_date = cleanText(req.body.expense_date, 10);
    if (req.body?.payment_method !== undefined) updates.payment_method = cleanText(req.body.payment_method, 30);
    if (req.body?.reference !== undefined) updates.reference = cleanText(req.body.reference, 100);
    if (req.body?.notes !== undefined) updates.notes = cleanText(req.body.notes, 1000);
    const allowedCategories = ['Utilities', 'Salaries', 'Maintenance', 'Supplies', 'Transport', 'Events', 'Other'];
    const allowedMethods = ['Cash', 'Bank Transfer', 'Cheque', 'JazzCash', 'Easypaisa', 'Other'];
    if (updates.title !== undefined && !updates.title) return res.status(400).json({ error: 'Expense title cannot be empty.' });
    if (updates.category !== undefined && !allowedCategories.includes(updates.category)) return res.status(400).json({ error: 'Choose a supported expense category.' });
    if (updates.payment_method !== undefined && !allowedMethods.includes(updates.payment_method)) return res.status(400).json({ error: 'Choose a supported payment method.' });
    if (updates.amount !== undefined && (!Number.isFinite(updates.amount) || updates.amount <= 0)) return res.status(400).json({ error: 'Expense amount must be greater than zero.' });
    if (updates.expense_date !== undefined && !isValidIsoDate(updates.expense_date)) return res.status(400).json({ error: 'Expense date must use a real calendar date in YYYY-MM-DD format.' });
    updates.updated_at = new Date().toISOString();
    const row = await ExpenseModel.findOneAndUpdate({ record_id: req.params.id }, { $set: updates }, { new: true, runValidators: true }).lean();
    if (!row) return res.status(404).json({ error: 'Expense record not found.' });
    await audit(req, 'FINANCE_EXPENSE_UPDATED', 'Expense', req.params.id, 'Updated expense record.');
    return res.json({ ...row, id: row.record_id });
  } catch {
    return res.status(400).json({ error: 'Unable to update expense. Check the supplied values.' });
  }
});

financeRouter.delete('/expenses/:id', async (req: AuthenticatedRequest, res: Response) => {
  if (!dbReady(res)) return;
  try {
    const row = await ExpenseModel.findOneAndDelete({ record_id: req.params.id }).lean();
    if (!row) return res.status(404).json({ error: 'Expense record not found.' });
    await audit(req, 'FINANCE_EXPENSE_DELETED', 'Expense', req.params.id, `Deleted expense record ${row.title} for PKR ${row.amount}.`);
    return res.json({ success: true, message: 'Expense record deleted.' });
  } catch {
    return res.status(500).json({ error: 'Unable to delete expense record.' });
  }
});

financeRouter.get('/payroll', async (req: AuthenticatedRequest, res: Response) => {
  if (!dbReady(res)) return;
  try {
    const filter: Record<string, any> = {};
    if (req.query.year) filter.salary_year = Number(req.query.year);
    if (req.query.month) filter.salary_month = Number(req.query.month);
    if (req.query.status) filter.status = cleanText(req.query.status, 30);
    const rows = await PayrollModel.find(filter).sort({ salary_year: -1, salary_month: -1, staff_name: 1 }).limit(2000).lean();
    return res.json(rows.map(row => ({ ...row, id: row.record_id })));
  } catch {
    return res.status(500).json({ error: 'Unable to load payroll records.' });
  }
});

financeRouter.post('/payroll', async (req: AuthenticatedRequest, res: Response) => {
  if (!dbReady(res)) return;
  try {
    const staffId = cleanText(req.body?.staff_id, 100);
    const staffName = cleanText(req.body?.staff_name, 120);
    const designation = cleanText(req.body?.designation, 100);
    const month = Number(req.body?.salary_month);
    const year = Number(req.body?.salary_year);
    const basic = Number(req.body?.basic_salary);
    const allowances = Number(req.body?.allowances || 0);
    const deductions = Number(req.body?.deductions || 0);
    if (!staffId || !staffName || !designation || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020 || year > 2100 ||
      ![basic, allowances, deductions].every(Number.isFinite) || basic < 0 || allowances < 0 || deductions < 0 || deductions > basic + allowances) {
      return res.status(400).json({ error: 'Provide valid staff details, salary period and non-negative salary amounts. Deductions cannot exceed gross salary.' });
    }
    const staffClauses: Record<string, any>[] = [{ record_id: staffId }];
    if (mongoose.Types.ObjectId.isValid(staffId) && /^[a-fA-F0-9]{24}$/.test(staffId)) {
      staffClauses.push({ _id: new mongoose.Types.ObjectId(staffId) });
    }
    const staffDoc = await TeacherModel.findOne({ $or: staffClauses }).lean();
    if (!staffDoc) return res.status(404).json({ error: 'Select an existing staff member from the staff directory.' });
    if (staffDoc.status !== 'Active') return res.status(400).json({ error: 'Payroll can only be created for active staff members.' });
    const authoritativeStaffName = String(staffDoc.name || staffName);
    const authoritativeDesignation = String(staffDoc.subject || designation);
    const now = new Date().toISOString();
    const recordId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const net = calculatePayrollNet({ basicSalary: basic, allowances, deductions });
    const row = await PayrollModel.create({
      record_id: recordId, staff_id: staffId, staff_name: authoritativeStaffName, designation: authoritativeDesignation, salary_month: month, salary_year: year,
      basic_salary: basic, allowances, deductions, net_salary: net, paid_amount: 0, status: 'Unpaid',
      notes: cleanText(req.body?.notes, 1000), created_by: req.user?.id || 'unknown', created_at: now, updated_at: now,
    });
    await audit(req, 'PAYROLL_RECORD_CREATED', 'Payroll', recordId, `Created payroll for ${authoritativeStaffName}: PKR ${net}`);
    return res.status(201).json({ ...row.toObject(), id: recordId });
  } catch (err: any) {
    if (err?.code === 11000) return res.status(409).json({ error: 'A salary record already exists for this staff member and month.' });
    return res.status(500).json({ error: 'Unable to create payroll record.' });
  }
});

financeRouter.post('/payroll/:id/payment', async (req: AuthenticatedRequest, res: Response) => {
  if (!dbReady(res)) return;
  try {
    const amount = Number(req.body?.amount);
    const paymentDate = cleanText(req.body?.payment_date, 10);
    const method = cleanText(req.body?.payment_method, 30);
    const methods = ['Cash', 'Bank Transfer', 'Cheque', 'JazzCash', 'Easypaisa', 'Other'];
    if (!Number.isFinite(amount) || amount <= 0 || !isValidIsoDate(paymentDate) || !methods.includes(method)) {
      return res.status(400).json({ error: 'Provide a positive payment amount, valid date and payment method.' });
    }
    const existing = await PayrollModel.findOne({ record_id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Payroll record not found.' });
    const previousPaid = Number(existing.paid_amount || 0);
    const remaining = Number(existing.net_salary || 0) - previousPaid;
    if (amount > remaining) return res.status(400).json({ error: 'Payment exceeds the remaining salary balance.' });
    const nextPaid = Number((previousPaid + amount).toFixed(2));
    const now = new Date().toISOString();
    const updated = await PayrollModel.findOneAndUpdate(
      { record_id: req.params.id, paid_amount: previousPaid, net_salary: existing.net_salary },
      {
        $inc: { paid_amount: Number(amount.toFixed(2)) },
        $push: { payment_history: { amount: Number(amount.toFixed(2)), payment_date: paymentDate, payment_method: method, recorded_by: req.user?.id || 'unknown', recorded_at: now } },
        $set: { payment_date: paymentDate, payment_method: method, status: getPayrollStatus(Number(existing.net_salary), nextPaid), updated_at: now },
      },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(409).json({ error: 'This salary record changed during payment. Refresh the payroll and retry to prevent duplicate or excess payment.' });
    await audit(req, 'PAYROLL_PAYMENT_RECORDED', 'Payroll', updated.record_id, `Recorded PKR ${amount} for ${updated.staff_name}; total paid PKR ${updated.paid_amount}.`);
    return res.json({ ...updated.toObject(), id: updated.record_id });
  } catch {
    return res.status(500).json({ error: 'Unable to record salary payment.' });
  }
});
