import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownToLine, CalendarDays, ChartNoAxesCombined, FileSpreadsheet, Printer, RefreshCw, Sparkles, Wallet } from 'lucide-react';
import { api } from '../services/api';
import type { AttendanceRecord, ExpenseRecord, FeeRecord, PayrollRecord, Student, Teacher, VerifiedFeeCollectionRecord } from '../types';
import { sumPayrollPayments } from '../utils/finance';

type ReportTab = 'overview' | 'fees' | 'defaulters' | 'attendance' | 'sessions' | 'expenses' | 'payroll';

interface FinanceReportsProps {
  onAskAI: (prompt: string) => void;
}

const money = (value: number) => `PKR ${Math.round(value || 0).toLocaleString('en-PK')}`;
const monthNumber = (value: string) => {
  const raw = String(value || '').trim().toLowerCase();
  const numeric = raw.match(/^(0?[1-9]|1[0-2])$/);
  if (numeric) return Number(numeric[1]);
  const parsed = new Date(`${raw} 1, 2020`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getMonth() + 1;
};
const dateKey = (value: unknown) => {
  if (!value) return '';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10);
};

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(row => headers.map(key => escape(row[key])).join(','))].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadExcel(filename: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const xmlEscape = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const cell = (value: unknown) => {
    const numeric = typeof value === 'number' && Number.isFinite(value);
    return `<Cell><Data ss:Type="${numeric ? 'Number' : 'String'}">${xmlEscape(value)}</Data></Cell>`;
  };
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="School Report"><Table><Row>${headers.map(cell).join('')}</Row>${rows.map(row => `<Row>${headers.map(key => cell(row[key])).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/\.xlsx?$/i, '') + '.xls';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function htmlEscape(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const FinanceReports: React.FC<FinanceReportsProps> = ({ onAskAI }) => {
  const [tab, setTab] = useState<ReportTab>('overview');
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [payroll, setPayroll] = useState<PayrollRecord[]>([]);
  const [collections, setCollections] = useState<VerifiedFeeCollectionRecord[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [expenseDraft, setExpenseDraft] = useState({ title: '', category: 'Utilities', amount: '', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'Cash' });
  const [payrollDraft, setPayrollDraft] = useState({ staff_id: '', staff_name: '', designation: 'Teacher', salary_month: new Date().getMonth() + 1, salary_year: new Date().getFullYear(), basic_salary: '', allowances: '0', deductions: '0' });
  const [pendingPayrollPayments, setPendingPayrollPayments] = useState<Record<string, { amount: number; payment_date: string; payment_method: string; idempotency_key: string }>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const [feeRows, studentRows, attendanceRows, expenseRows, payrollRows, collectionRows, teacherRows, enrollmentRows] = await Promise.all([
        api.getFees(),
        api.getStudents(),
        api.getAttendance(),
        api.getFinanceExpenses(),
        api.getFinancePayroll(),
        api.getFinanceCollections({ month: monthFilter || undefined }),
        api.getTeachers(),
        api.getEnrollments(),
      ]);
      setFees(Array.isArray(feeRows) ? feeRows : []);
      setStudents(Array.isArray(studentRows) ? studentRows : []);
      setAttendance(Array.isArray(attendanceRows) ? attendanceRows : []);
      setExpenses(Array.isArray(expenseRows) ? expenseRows : []);
      setPayroll(Array.isArray(payrollRows) ? payrollRows : []);
      setCollections(Array.isArray(collectionRows) ? collectionRows : []);
      setTeachers(Array.isArray(teacherRows) ? teacherRows : []);
      setEnrollments(Array.isArray(enrollmentRows) ? enrollmentRows : []);
    } catch (err: any) {
      setError(err?.message || 'Reports could not be loaded from the school database.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, [monthFilter]);

  const classes = useMemo(() => Array.from(new Set([
    ...fees.map(f => f.class_name),
    ...students.map(student => student.class_name),
    ...attendance.map(a => a.class_name),
    ...enrollments.map(e => e.class_name),
  ].filter(Boolean))).sort(), [fees, students, attendance, enrollments]);

  const filteredFees = useMemo(() => fees.filter(f => {
    if (classFilter !== 'all' && f.class_name !== classFilter) return false;
    if (!monthFilter) return true;
    const [year, month] = monthFilter.split('-').map(Number);
    const matchesVoucherPeriod = Number(f.year) === year && monthNumber(String(f.fee_month || '')) === month;
    return matchesVoucherPeriod || dateKey(f.due_date).startsWith(monthFilter);
  }), [fees, classFilter, monthFilter]);

  const filteredAttendance = useMemo(() => attendance.filter(a =>
    (classFilter === 'all' || a.class_name === classFilter) &&
    (!monthFilter || dateKey(a.date).startsWith(monthFilter))
  ), [attendance, classFilter, monthFilter]);

  const totals = useMemo(() => {
    const billed = filteredFees.reduce((sum, f) => sum + Number(f.total_amount || 0), 0);
    const collected = filteredFees.reduce((sum, f) => sum + Number(f.paid_amount || 0), 0);
    const outstanding = filteredFees.reduce((sum, f) => sum + Number(f.pending_amount || 0), 0);
    const present = filteredAttendance.filter(a => a.status === 'Present').length;
    const absent = filteredAttendance.filter(a => a.status === 'Absent').length;
    const late = filteredAttendance.filter(a => a.status === 'Late').length;
    const leave = filteredAttendance.filter(a => a.status === 'Leave').length;
    const marked = filteredAttendance.length;
    return { billed, collected, outstanding, collectionRate: billed > 0 ? Math.round(collected / billed * 100) : 0, present, absent, late, leave, marked, attendanceRate: marked > 0 ? Math.round(present / marked * 100) : 0 };
  }, [filteredFees, filteredAttendance]);

  const classFeeSummary = useMemo(() => {
    const grouped = new Map<string, { billed: number; collected: number; outstanding: number; vouchers: number }>();
    filteredFees.forEach(f => {
      const key = f.class_name || 'Unassigned';
      const current = grouped.get(key) || { billed: 0, collected: 0, outstanding: 0, vouchers: 0 };
      current.billed += Number(f.total_amount || 0);
      current.collected += Number(f.paid_amount || 0);
      current.outstanding += Number(f.pending_amount || 0);
      current.vouchers += 1;
      grouped.set(key, current);
    });
    return Array.from(grouped.entries()).map(([className, values]) => ({ className, ...values })).sort((a,b) => b.collected - a.collected);
  }, [filteredFees]);

  const defaulters = filteredFees.filter(f => Number(f.pending_amount || 0) > 0)
    .sort((a, b) => Number(b.pending_amount || 0) - Number(a.pending_amount || 0));

  const feeRows = filteredFees.map(f => ({
    Student: f.student_name,
    Class: f.class_name,
    Month: `${f.fee_month} ${f.year}`,
    Billed: f.total_amount,
    Collected: f.paid_amount,
    Outstanding: f.pending_amount,
    Status: f.status,
    'Due date': f.due_date,
  }));

  const dayWiseCollections = useMemo(() => {
    const grouped = new Map<string, { amount: number; transactions: number }>();
    collections.filter(payment =>
      (!monthFilter || payment.date.startsWith(monthFilter)) &&
      (classFilter === 'all' || payment.class_name === classFilter)
    ).forEach(payment => {
      const current = grouped.get(payment.date) || { amount: 0, transactions: 0 };
      current.amount += Number(payment.amount || 0);
      current.transactions += 1;
      grouped.set(payment.date, current);
    });
    return Array.from(grouped.entries()).map(([date, values]) => ({ date, ...values })).sort((a,b) => b.date.localeCompare(a.date));
  }, [collections, monthFilter, classFilter]);

  const filteredEnrollments = enrollments.filter(e => classFilter === 'all' || e.class_name === classFilter);
  const sessionSummary = useMemo(() => {
    const grouped = new Map<string, { students: Set<string>; classes: Map<string, number>; active: number; completed: number; transferred: number; dropped: number }>();
    filteredEnrollments.forEach(e => {
      const year = String(e.academic_year || 'Session not recorded');
      const row = grouped.get(year) || { students: new Set<string>(), classes: new Map<string, number>(), active: 0, completed: 0, transferred: 0, dropped: 0 };
      if (e.student_id) row.students.add(String(e.student_id));
      row.classes.set(String(e.class_name || 'Unassigned'), (row.classes.get(String(e.class_name || 'Unassigned')) || 0) + 1);
      const status = String(e.status || '').toLowerCase();
      if (status === 'active') row.active += 1;
      else if (status === 'completed') row.completed += 1;
      else if (status === 'transferred') row.transferred += 1;
      else if (status === 'dropped') row.dropped += 1;
      grouped.set(year, row);
    });
    return Array.from(grouped.entries()).map(([academicYear, row]) => ({
      academicYear, uniqueStudents: row.students.size, enrollments: Array.from(row.classes.values()).reduce((a,b)=>a+b,0),
      active: row.active, completed: row.completed, transferred: row.transferred, dropped: row.dropped,
      classes: Array.from(row.classes.entries()).map(([name,count])=>`${name}: ${count}`).join('; '),
    })).sort((a,b)=>b.academicYear.localeCompare(a.academicYear));
  }, [filteredEnrollments]);

  const attendanceRows = filteredAttendance.map(a => ({
    Date: a.date, Student: a.student_name, Class: a.class_name, Section: a.section, Status: a.status,
  }));

  const filteredExpenses = expenses.filter(e => !monthFilter || String(e.expense_date || '').startsWith(monthFilter));
  const filteredPayroll = payroll.filter(p => !monthFilter || (Number(p.salary_year) === Number(monthFilter.slice(0, 4)) && Number(p.salary_month) === Number(monthFilter.slice(5, 7))));

  const financeSummary = useMemo(() => {
    const verifiedIncome = collections.filter(p => (!monthFilter || p.date.startsWith(monthFilter)) && (classFilter === 'all' || p.class_name === classFilter)).reduce((sum,p)=>sum+Number(p.amount||0),0);
    const operatingExpense = filteredExpenses.filter(e=>e.category!=='Salaries').reduce((sum,e)=>sum+Number(e.amount||0),0);
    const payrollPaid = sumPayrollPayments(payroll, monthFilter || undefined);
    const outflow = operatingExpense + payrollPaid;
    return { verifiedIncome, operatingExpense, payrollPaid, outflow, netCashIndicator: verifiedIncome-outflow };
  }, [collections, monthFilter, classFilter, filteredExpenses, payroll]);
  const saveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.createFinanceExpense({ ...expenseDraft, amount: Number(expenseDraft.amount) });
      setExpenseDraft({ title: '', category: 'Utilities', amount: '', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'Cash' });
      await load(true);
    } catch (err: any) { setError(err?.message || 'Unable to save expense.'); }
  };
  const savePayroll = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.createFinancePayroll({ ...payrollDraft, basic_salary: Number(payrollDraft.basic_salary), allowances: Number(payrollDraft.allowances), deductions: Number(payrollDraft.deductions) });
      setPayrollDraft(v => ({ ...v, staff_id: '', staff_name: '', basic_salary: '', allowances: '0', deductions: '0' }));
      await load(true);
    } catch (err: any) { setError(err?.message || 'Unable to create salary record.'); }
  };
  const editExpense = async (row: ExpenseRecord) => {
    const title = window.prompt('Expense title', row.title);
    if (title === null) return;
    const amountRaw = window.prompt('Amount in PKR', String(row.amount));
    if (amountRaw === null) return;
    const amount = Number(amountRaw);
    if (!title.trim() || !Number.isFinite(amount) || amount <= 0) { setError('Enter a valid title and positive amount.'); return; }
    try { await api.updateFinanceExpense(row.id, { title: title.trim(), amount }); await load(true); }
    catch (err: any) { setError(err?.message || 'Unable to update expense.'); }
  };
  const deleteExpense = async (row: ExpenseRecord) => {
    if (!window.confirm(`Delete expense "${row.title}" for ${money(row.amount)}? This action will be recorded in the audit log.`)) return;
    try { await api.deleteFinanceExpense(row.id); await load(true); }
    catch (err: any) { setError(err?.message || 'Unable to delete expense.'); }
  };
  const paySalary = async (row: PayrollRecord) => {
    const pendingRequest = pendingPayrollPayments[row.id];
    let paymentRequest = pendingRequest;
    if (!paymentRequest) {
      const remaining = Number(row.net_salary || 0) - Number(row.paid_amount || 0);
      const raw = window.prompt(`Remaining salary: PKR ${remaining.toLocaleString()}. Enter payment amount:`);
      if (raw === null) return;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) { setError('Enter a valid payment amount within the remaining balance.'); return; }
      const method = window.prompt('Payment method: Cash, Bank Transfer, Cheque, JazzCash, Easypaisa, Other', 'Cash');
      if (method === null) return;
      const allowed = ['Cash','Bank Transfer','Cheque','JazzCash','Easypaisa','Other'];
      if (!allowed.includes(method)) { setError('Choose a supported payment method.'); return; }
      paymentRequest = {
        amount,
        payment_date: new Date().toISOString().slice(0, 10),
        payment_method: method,
        idempotency_key: crypto.randomUUID(),
      };
      setPendingPayrollPayments(current => ({ ...current, [row.id]: paymentRequest! }));
    }
    try {
      await api.recordFinanceSalaryPayment(row.id, paymentRequest);
      setPendingPayrollPayments(current => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await load(true);
    } catch (err: any) {
      const message = err?.message || 'Unable to record salary payment.';
      if (String(message).toLowerCase().includes('already recorded')) {
        setPendingPayrollPayments(current => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
        await load(true);
      }
      setError(message);
    }
  };

  const printSalarySlip = (row: PayrollRecord) => {
    const popup = window.open('', '_blank', 'width=850,height=900');
    if (!popup) { setError('Allow pop-ups to print the salary slip.'); return; }
    const history = (row.payment_history || []).map((payment, index) => `<tr><td>Payment ${index + 1}</td><td>${htmlEscape(payment.payment_date)}</td><td>${htmlEscape(payment.payment_method)}</td><td>PKR ${Number(payment.amount).toLocaleString('en-PK')}</td></tr>`).join('');
    popup.document.write(`<!doctype html><html><head><title>Salary Slip - ${htmlEscape(row.staff_name)}</title><style>body{font-family:Arial,sans-serif;padding:36px;color:#111}h1{margin:0 0 6px;font-size:24px}.muted{color:#666;font-size:12px}.panel{border:1px solid #ddd;border-radius:12px;padding:18px;margin:18px 0}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left;font-size:13px}.total{font-size:20px;font-weight:bold;text-align:right;margin-top:18px}@media print{button{display:none}}</style></head><body><h1>Staff Salary Slip</h1><p class="muted">Academic Finance · Generated ${htmlEscape(new Date().toLocaleDateString())}</p><div class="panel"><b>${htmlEscape(row.staff_name)}</b><p>${htmlEscape(row.designation)} · Staff ID: ${htmlEscape(row.staff_id)}</p><p>Salary period: ${htmlEscape(row.salary_month)}/${htmlEscape(row.salary_year)}</p></div><table><tr><td>Basic salary</td><td>PKR ${Number(row.basic_salary).toLocaleString('en-PK')}</td></tr><tr><td>Allowances</td><td>PKR ${Number(row.allowances).toLocaleString('en-PK')}</td></tr><tr><td>Deductions</td><td>PKR ${Number(row.deductions).toLocaleString('en-PK')}</td></tr><tr><th>Net salary</th><th>PKR ${Number(row.net_salary).toLocaleString('en-PK')}</th></tr><tr><td>Total paid</td><td>PKR ${Number(row.paid_amount).toLocaleString('en-PK')}</td></tr><tr><td>Remaining balance</td><td>PKR ${(Number(row.net_salary)-Number(row.paid_amount)).toLocaleString('en-PK')}</td></tr></table><h2>Payment history</h2><table><tr><th>Transaction</th><th>Date</th><th>Method</th><th>Amount</th></tr>${history || '<tr><td colspan="4">No payments recorded</td></tr>'}</table><p class="muted">This document reflects salary and payment records currently saved in the school system.</p></body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const tabs: Array<{ id: ReportTab; label: string; icon: React.ElementType }> = [
    { id: 'overview', label: 'Overview', icon: ChartNoAxesCombined },
    { id: 'fees', label: 'Fee collection', icon: Wallet },
    { id: 'defaulters', label: 'Defaulters', icon: AlertTriangle },
    { id: 'attendance', label: 'Attendance', icon: Activity },
    { id: 'sessions', label: 'Sessions', icon: CalendarDays },
    { id: 'expenses', label: 'Expenses', icon: ArrowDownToLine },
    { id: 'payroll', label: 'Payroll', icon: Wallet },
  ];

  if (loading) return <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center"><RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-800" /><p className="text-sm font-semibold text-neutral-800">Loading live reports…</p><p className="mt-1 text-xs text-neutral-500">Reading fees, attendance, verified collections, staff and enrollment records from the school database.</p></div>;

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800">Institution intelligence</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-neutral-950">Reports &amp; Analytics</h2>
          <p className="mt-1 text-sm text-neutral-500">Live financial and academic summaries calculated from saved school records.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void load(true)} disabled={refreshing} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh</button>
          <button onClick={() => {
            const rows = tab === 'fees' ? feeRows : tab === 'defaulters' ? defaulters.map(f => ({ Student: f.student_name, Class: f.class_name, Month: f.fee_month, Year: f.year, Outstanding: f.pending_amount, DueDate: f.due_date })) : tab === 'attendance' ? attendanceRows : tab === 'sessions' ? sessionSummary.map(row => ({ Session: row.academicYear, Students: row.uniqueStudents, Enrollments: row.enrollments, Active: row.active, Completed: row.completed, Transferred: row.transferred, Dropped: row.dropped })) : tab === 'expenses' ? filteredExpenses.map(e => ({ Date: e.expense_date, Title: e.title, Category: e.category, Amount: e.amount, Method: e.payment_method })) : tab === 'payroll' ? filteredPayroll.map(p => ({ Staff: p.staff_name, Designation: p.designation, Period: `${p.salary_month}/${p.salary_year}`, Net: p.net_salary, Paid: p.paid_amount, Balance: Number(p.net_salary)-Number(p.paid_amount), Status: p.status })) : classFeeSummary.map(row => ({ Class: row.className, Billed: row.billed, Collected: row.collected, Outstanding: row.outstanding, Vouchers: row.vouchers }));
            downloadExcel(`school-${tab}-report.xls`, rows);
          }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"><FileSpreadsheet className="h-4 w-4" /> Export Excel</button>
          <button onClick={() => window.print()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"><Printer className="h-4 w-4" /> Print / PDF</button>
          <button onClick={() => onAskAI('Analyze the current fee collection, outstanding dues and attendance reports. Use live records and explain trends without guessing missing data.')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-950 px-3 text-xs font-semibold text-white hover:bg-emerald-900"><Sparkles className="h-4 w-4" /> Ask School AI</button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}<button onClick={() => void load()} className="ml-3 font-bold underline">Try again</button></div>}

      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600"><CalendarDays className="h-4 w-4" /> Report period and class</div>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Report month" type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="min-h-10 rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-800" />
          <select aria-label="Filter report by class" value={classFilter} onChange={e => setClassFilter(e.target.value)} className="min-h-10 rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-800"><option value="all">All classes</option>{classes.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1" aria-label="Report categories">
        {tabs.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors ${tab === item.id ? 'bg-neutral-950 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}
      </nav>

      {tab === 'overview' && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Total fee billed', value: money(totals.billed), hint: `${filteredFees.length} fee vouchers` },
            { label: 'Fees collected', value: money(totals.collected), hint: `${totals.collectionRate}% collection rate` },
            { label: 'Outstanding balance', value: money(totals.outstanding), hint: `${defaulters.length} vouchers with dues` },
            { label: 'Attendance rate', value: `${totals.attendanceRate}%`, hint: `${totals.marked} attendance records` },
          ].map(card => <article key={card.label} className="rounded-2xl border border-neutral-200 bg-white p-5"><p className="text-xs font-semibold text-neutral-500">{card.label}</p><p className="mt-2 text-2xl font-bold tracking-tight text-neutral-950">{card.value}</p><p className="mt-1 text-xs text-neutral-500">{card.hint}</p></article>)}
        </div>
        <article className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-neutral-900">Income vs expense</h3><p className="mt-1 text-xs text-neutral-500">Verified fee receipts compared with recorded operating expenses and salary disbursements.</p></div><button onClick={()=>onAskAI('Analyze verified fee collections, operating expenses and paid payroll for the selected month. Explain the cash position and unusual costs using only saved records.')} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900"><Sparkles className="h-4 w-4"/> Ask AI</button></div>
          <div className="mt-5 space-y-4"><div><div className="mb-2 flex justify-between text-xs"><span className="font-semibold text-neutral-700">Verified fee income</span><strong>{money(financeSummary.verifiedIncome)}</strong></div><div className="h-3 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-emerald-700" style={{width:`${financeSummary.verifiedIncome>0?100:0}%`}}/></div></div><div><div className="mb-2 flex justify-between text-xs"><span className="font-semibold text-neutral-700">Operating expenses + paid payroll</span><strong>{money(financeSummary.outflow)}</strong></div><div className="h-3 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-rose-600" style={{width:`${financeSummary.verifiedIncome>0?Math.min(100,financeSummary.outflow/financeSummary.verifiedIncome*100):financeSummary.outflow>0?100:0}%`}}/></div></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[11px] text-neutral-500">Operating expenses</p><p className="mt-1 text-sm font-bold">{money(financeSummary.operatingExpense)}</p></div><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[11px] text-neutral-500">Payroll paid</p><p className="mt-1 text-sm font-bold">{money(financeSummary.payrollPaid)}</p></div><div className="rounded-xl bg-neutral-50 p-3"><p className="text-[11px] text-neutral-500">Cash indicator</p><p className={`mt-1 text-sm font-bold ${financeSummary.netCashIndicator<0?'text-rose-700':'text-emerald-800'}`}>{money(financeSummary.netCashIndicator)}</p></div></div>
          <p className="mt-3 text-[11px] text-neutral-400">This is a cash activity indicator, not an audited profit/loss statement. Payroll is counted by paid amount; salary expenses are excluded to avoid double counting.</p>
        </article>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-neutral-200 bg-white p-5"><h3 className="font-bold text-neutral-900">Fee collection performance</h3><div className="mt-5 h-3 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-emerald-700" style={{ width: `${totals.collectionRate}%` }} /></div><div className="mt-3 flex justify-between text-xs"><span className="text-neutral-500">Collected: {money(totals.collected)}</span><span className="font-semibold text-neutral-800">{totals.collectionRate}%</span></div><p className="mt-4 text-xs text-neutral-500">Calculated from fee voucher paid_amount and total_amount fields.</p></article>
          <article className="rounded-2xl border border-neutral-200 bg-white p-5"><h3 className="font-bold text-neutral-900">Attendance distribution</h3><div className="mt-4 grid grid-cols-2 gap-3">{[['Present', totals.present], ['Absent', totals.absent], ['Late', totals.late], ['Leave', totals.leave]].map(([label, value]) => <div key={label} className="rounded-xl bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{label}</p><p className="mt-1 text-xl font-bold text-neutral-900">{value}</p></div>)}</div></article>
        </div>
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Class-wise fee summary</h3><p className="mt-1 text-xs text-neutral-500">Collection and outstanding totals by class for the selected period.</p></div><button onClick={() => downloadCsv('class-wise-fee-summary.csv', classFeeSummary.map(row => ({ Class: row.className, Billed: row.billed, Collected: row.collected, Outstanding: row.outstanding, Vouchers: row.vouchers })))} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Export CSV</button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-neutral-50 text-neutral-500"><tr>{['Class','Billed','Collected','Outstanding','Vouchers'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{classFeeSummary.map(row => <tr key={row.className}><td className="px-4 py-3 font-semibold text-neutral-900">{row.className}</td><td className="px-4 py-3">{money(row.billed)}</td><td className="px-4 py-3 text-emerald-800">{money(row.collected)}</td><td className="px-4 py-3 text-rose-700">{money(row.outstanding)}</td><td className="px-4 py-3">{row.vouchers}</td></tr>)}</tbody></table>{classFeeSummary.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">No fee vouchers found for this period.</p>}</div>
        </div>
        <div className="flex flex-wrap gap-2"><button onClick={() => downloadExcel('all-students.xls', students.map(student=>({AdmissionNo:student.admission_no,Name:student.full_name,FatherName:student.father_name,Class:student.class_name,Section:student.section,RollNo:student.roll_no,Status:student.academic_status,AdmissionDate:student.admission_date})))} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"><FileSpreadsheet className="h-4 w-4" /> Export all students</button><button onClick={() => downloadCsv('school-fee-summary.csv', feeRows)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"><FileSpreadsheet className="h-4 w-4" /> Export fee summary CSV</button><button onClick={() => downloadCsv('school-attendance-report.csv', attendanceRows)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"><ArrowDownToLine className="h-4 w-4" /> Export attendance CSV</button></div>
      </>}

      {tab === 'fees' && <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Fee collection report</h3><p className="mt-1 text-xs text-neutral-500">Voucher-level billed, collected and remaining balances.</p></div><button onClick={() => downloadCsv('fee-collection-report.csv', feeRows)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white"><FileSpreadsheet className="h-4 w-4" /> Export CSV</button></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-neutral-50 text-neutral-500"><tr>{['Student','Class','Month','Billed','Collected','Outstanding','Status'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{filteredFees.map(f => <tr key={f.id}><td className="px-4 py-3 font-semibold text-neutral-900">{f.student_name}</td><td className="px-4 py-3">{f.class_name}</td><td className="px-4 py-3">{f.fee_month} {f.year}</td><td className="px-4 py-3">{money(f.total_amount)}</td><td className="px-4 py-3 text-emerald-800">{money(f.paid_amount)}</td><td className="px-4 py-3 text-rose-700">{money(f.pending_amount)}</td><td className="px-4 py-3">{f.status}</td></tr>)}</tbody></table>{filteredFees.length === 0 && <p className="p-8 text-center text-sm text-neutral-500">No fee vouchers found for this filter.</p>}</div></div>}

      {tab === 'fees' && <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Day-wise collection</h3><p className="mt-1 text-xs text-neutral-500">Daily sums from saved fee payment history entries.</p></div><button onClick={() => downloadCsv('day-wise-fee-collection.csv', dayWiseCollections.map(row => ({ Date: row.date, Collected: row.amount, Transactions: row.transactions })))} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Export CSV</button></div>
        <div className="divide-y divide-neutral-100">{dayWiseCollections.map(row => <div key={row.date} className="flex items-center justify-between gap-3 px-4 py-3"><span className="text-xs font-semibold text-neutral-700">{row.date}</span><div className="text-right"><p className="text-sm font-bold text-emerald-800">{money(row.amount)}</p><p className="text-[11px] text-neutral-500">{row.transactions} payment(s)</p></div></div>)}{dayWiseCollections.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">No dated payment history is available for this period.</p>}</div>
      </div>}

      {tab === 'defaulters' && <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex items-center justify-between border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Fee defaulters</h3><p className="mt-1 text-xs text-neutral-500">Students with a positive outstanding voucher balance.</p></div><button onClick={() => downloadCsv('fee-defaulters.csv', defaulters.map(f => ({ Student: f.student_name, Class: f.class_name, Month: f.fee_month, Year: f.year, Outstanding: f.pending_amount, DueDate: f.due_date })))} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white"><FileSpreadsheet className="h-4 w-4" /> Export CSV</button></div><div className="divide-y divide-neutral-100">{defaulters.map(f => <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-neutral-900">{f.student_name}</p><p className="mt-1 text-xs text-neutral-500">{f.class_name} · {f.fee_month} {f.year} · Due {f.due_date || 'date not recorded'}</p></div><p className="text-sm font-bold text-rose-700">{money(f.pending_amount)}</p></div>)}{defaulters.length === 0 && <p className="p-8 text-center text-sm text-neutral-500">No outstanding fee vouchers found for this filter.</p>}</div><div className="border-t border-neutral-200 p-4"><button onClick={() => onAskAI('Analyze the current fee defaulters report. Group dues by class and identify high outstanding balances using live records only. Do not send reminders.')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900"><Sparkles className="h-4 w-4" /> Ask AI to analyze defaulters</button></div></div>}

      {tab === 'attendance' && <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Attendance report</h3><p className="mt-1 text-xs text-neutral-500">Recorded attendance for the selected month and class.</p></div><button onClick={() => downloadCsv('attendance-report.csv', attendanceRows)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white"><FileSpreadsheet className="h-4 w-4" /> Export CSV</button></div><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="bg-neutral-50 text-neutral-500"><tr>{['Date','Student','Class','Section','Status'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{filteredAttendance.map((a,i) => <tr key={a.id || `${a.student_id}-${a.date}-${i}`}><td className="px-4 py-3">{a.date}</td><td className="px-4 py-3 font-semibold text-neutral-900">{a.student_name}</td><td className="px-4 py-3">{a.class_name}</td><td className="px-4 py-3">{a.section}</td><td className="px-4 py-3">{a.status}</td></tr>)}</tbody></table>{filteredAttendance.length === 0 && <p className="p-8 text-center text-sm text-neutral-500">No attendance records found for this filter.</p>}</div></div>}


      {tab === 'sessions' && <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Session-wise student report</h3><p className="mt-1 text-xs text-neutral-500">Based on saved enrollment history, not estimated from admission dates.</p></div><button onClick={()=>downloadCsv('session-wise-students.csv',sessionSummary.map(row=>({Session:row.academicYear,UniqueStudents:row.uniqueStudents,Enrollments:row.enrollments,Active:row.active,Completed:row.completed,Transferred:row.transferred,Dropped:row.dropped,Classes:row.classes})))} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Export CSV</button></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-neutral-50 text-neutral-500"><tr>{['Academic session','Unique students','Enrollments','Active','Completed','Transferred','Dropped'].map(h=><th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{sessionSummary.map(row=><tr key={row.academicYear}><td className="px-4 py-3 font-semibold text-neutral-900">{row.academicYear}</td><td className="px-4 py-3">{row.uniqueStudents}</td><td className="px-4 py-3">{row.enrollments}</td><td className="px-4 py-3">{row.active}</td><td className="px-4 py-3">{row.completed}</td><td className="px-4 py-3">{row.transferred}</td><td className="px-4 py-3">{row.dropped}</td></tr>)}</tbody></table>{sessionSummary.length===0&&<p className="p-8 text-center text-sm text-neutral-500">No enrollment history found for this period.</p>}</div>
      </div>}

      {tab === 'expenses' && <div className="space-y-4">
        <form onSubmit={saveExpense} className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-5">
          <input required maxLength={160} placeholder="Expense title" value={expenseDraft.title} onChange={e => setExpenseDraft(v => ({...v,title:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm xl:col-span-2" />
          <select value={expenseDraft.category} onChange={e => setExpenseDraft(v => ({...v,category:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm">{['Utilities','Salaries','Maintenance','Supplies','Transport','Events','Other'].map(x=><option key={x}>{x}</option>)}</select>
          <input required type="number" min="0.01" step="0.01" placeholder="Amount PKR" value={expenseDraft.amount} onChange={e => setExpenseDraft(v => ({...v,amount:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input required type="date" value={expenseDraft.expense_date} onChange={e => setExpenseDraft(v => ({...v,expense_date:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <select value={expenseDraft.payment_method} onChange={e => setExpenseDraft(v => ({...v,payment_method:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm">{['Cash','Bank Transfer','Cheque','JazzCash','Easypaisa','Other'].map(x=><option key={x}>{x}</option>)}</select>
          <button type="submit" className="min-h-10 rounded-lg bg-neutral-950 px-4 text-xs font-bold text-white">Save expense</button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-neutral-500">Record verified operating expenses here. Staff salaries belong in Payroll to avoid duplicate reporting.</p><button onClick={() => onAskAI('Analyze this month’s recorded operating expenses by category and identify the largest cost areas. Use only saved expense records.')} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900"><Sparkles className="h-4 w-4" /> Ask AI to analyze expenses</button></div>
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex items-center justify-between border-b border-neutral-200 p-4"><h3 className="font-bold text-neutral-900">Expense ledger · {money(filteredExpenses.reduce((n,e)=>n+Number(e.amount||0),0))}</h3><button onClick={()=>downloadCsv('expense-ledger.csv',filteredExpenses.map(e=>({Date:e.expense_date,Title:e.title,Category:e.category,Amount:e.amount,Method:e.payment_method})))} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Export CSV</button></div><div className="divide-y divide-neutral-100">{filteredExpenses.map(e=><div key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-neutral-900">{e.title}</p><p className="mt-1 text-xs text-neutral-500">{e.category} · {e.expense_date} · {e.payment_method}</p></div><div className="flex items-center gap-3"><p className="font-bold text-neutral-900">{money(e.amount)}</p><button type="button" onClick={()=>void editExpense(e)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Edit</button><button type="button" onClick={()=>void deleteExpense(e)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Delete</button></div></div>)}{filteredExpenses.length===0&&<p className="p-8 text-center text-sm text-neutral-500">No expense records for this month.</p>}</div></div>
      </div>}
      {tab === 'payroll' && <div className="space-y-4">
        <form onSubmit={savePayroll} className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
          <select required value={payrollDraft.staff_id} onChange={e=>{const staff=teachers.find(t=>t.id===e.target.value);setPayrollDraft(v=>({...v,staff_id:e.target.value,staff_name:staff?.name||'',designation:staff?.subject||'Teacher'}));}} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm"><option value="">Select staff member</option>{teachers.filter(t=>t.status==='Active').map(t=><option key={t.id} value={t.id}>{t.name} · {t.subject || 'Teacher'}</option>)}</select>
          <input required readOnly placeholder="Staff name" value={payrollDraft.staff_name} className="min-h-10 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm" />
          <input required readOnly placeholder="Designation" value={payrollDraft.designation} className="min-h-10 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm" />
          <input required type="number" min="0" step="0.01" placeholder="Basic salary PKR" value={payrollDraft.basic_salary} onChange={e=>setPayrollDraft(v=>({...v,basic_salary:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input type="number" min="0" step="0.01" placeholder="Allowances" value={payrollDraft.allowances} onChange={e=>setPayrollDraft(v=>({...v,allowances:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input type="number" min="0" step="0.01" placeholder="Deductions" value={payrollDraft.deductions} onChange={e=>setPayrollDraft(v=>({...v,deductions:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <select value={payrollDraft.salary_month} onChange={e=>setPayrollDraft(v=>({...v,salary_month:Number(e.target.value)}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm">{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{new Date(2020,i,1).toLocaleString('en',{month:'long'})}</option>)}</select>
          <input type="number" min="2020" max="2100" value={payrollDraft.salary_year} onChange={e=>setPayrollDraft(v=>({...v,salary_year:Number(e.target.value)}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <button type="submit" className="min-h-10 rounded-lg bg-neutral-950 px-4 text-xs font-bold text-white xl:col-span-4">Create salary record</button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-neutral-500">Salary records and disbursements are visible only to administrators.</p><button onClick={() => onAskAI('Analyze this month’s payroll records, total net salary, paid salary and remaining balances. Use live payroll records only.')} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900"><Sparkles className="h-4 w-4" /> Ask AI to analyze payroll</button></div>
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex items-center justify-between border-b border-neutral-200 p-4"><h3 className="font-bold text-neutral-900">Staff payroll</h3><button onClick={()=>downloadCsv('staff-payroll.csv',filteredPayroll.map(p=>({Staff:p.staff_name,Designation:p.designation,Period:`${p.salary_month}/${p.salary_year}`,Net:p.net_salary,Paid:p.paid_amount,Balance:Number(p.net_salary)-Number(p.paid_amount),Status:p.status})))} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Export CSV</button></div><div className="divide-y divide-neutral-100">{filteredPayroll.map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-neutral-900">{p.staff_name} · {p.designation}</p><p className="mt-1 text-xs text-neutral-500">{p.salary_month}/{p.salary_year} · Net {money(p.net_salary)} · Paid {money(p.paid_amount)} · Balance {money(Number(p.net_salary)-Number(p.paid_amount))} · {p.status}</p>{(p.payment_history || []).length>0 && <div className="mt-2 space-y-1">{p.payment_history.map((payment,i)=><p key={i} className="text-[11px] text-neutral-500">Payment {i+1}: {money(payment.amount)} · {payment.payment_date} · {payment.payment_method}</p>)}</div>}</div><div className="flex gap-2"><button type="button" onClick={()=>printSalarySlip(p)} className="min-h-9 rounded-lg border px-3 text-xs font-semibold">Print slip</button><button disabled={p.status==='Paid'} onClick={()=>void paySalary(p)} className="min-h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 disabled:opacity-40">Record payment</button></div></div>)}{filteredPayroll.length===0&&<p className="p-8 text-center text-sm text-neutral-500">No payroll records for this month.</p>}</div></div>
      </div>}

      <p className="text-[11px] leading-relaxed text-neutral-400">Reports reflect records saved in the connected database. Payroll is tracked separately from the expense ledger to prevent double counting. Add only verified real transactions; no sample values are inserted.</p>
    </section>
  );
};
