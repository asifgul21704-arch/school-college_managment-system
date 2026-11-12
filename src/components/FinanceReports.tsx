import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownToLine, CalendarDays, ChartNoAxesCombined, FileSpreadsheet, Printer, RefreshCw, Sparkles, Wallet } from 'lucide-react';
import { api } from '../services/api';
import type { AttendanceRecord, FeeRecord, Student } from '../types';

type ReportTab = 'overview' | 'fees' | 'defaulters' | 'attendance' | 'expenses' | 'payroll';

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

export const FinanceReports: React.FC<FinanceReportsProps> = ({ onAskAI }) => {
  const [tab, setTab] = useState<ReportTab>('overview');
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [expenseDraft, setExpenseDraft] = useState({ title: '', category: 'Utilities', amount: '', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'Cash' });
  const [payrollDraft, setPayrollDraft] = useState({ staff_id: '', staff_name: '', designation: 'Teacher', salary_month: new Date().getMonth() + 1, salary_year: new Date().getFullYear(), basic_salary: '', allowances: '0', deductions: '0' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const [feeRows, studentRows, attendanceRows, expenseRows, payrollRows] = await Promise.all([
        api.getFees(),
        api.getStudents(),
        api.getAttendance(),
        api.getFinanceExpenses(),
        api.getFinancePayroll(),
      ]);
      setFees(Array.isArray(feeRows) ? feeRows : []);
      setStudents(Array.isArray(studentRows) ? studentRows : []);
      setAttendance(Array.isArray(attendanceRows) ? attendanceRows : []);
      setExpenses(Array.isArray(expenseRows) ? expenseRows : []);
      setPayroll(Array.isArray(payrollRows) ? payrollRows : []);
    } catch (err: any) {
      setError(err?.message || 'Reports could not be loaded from the school database.');
    } finally {
      setLoading(false);
      se  const filteredFees = useMemo(() => fees.filter(f => {
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

  const attendanceRows = filteredAttendance.map(a => ({
    Date: a.date, Student: a.student_name, Class: a.class_name, Section: a.section, Status: a.status,
  }));

  const filteredExpenses = expenses.filter(e => !monthFilter || String(e.expense_date || '').startsWith(monthFilter));
  const filteredPayroll = payroll.filter(p => !monthFilter || (Number(p.salary_year) === Number(monthFilter.slice(0, 4)) && Number(p.salary_month) === Number(monthFilter.slice(5, 7))));
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
  const paySalary = async (row: any) => {
    const remaining = Number(row.net_salary || 0) - Number(row.paid_amount || 0);
    const raw = window.prompt(`Remaining salary: PKR ${remaining.toLocaleString()}. Enter payment amount:`);
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) { setError('Enter a valid payment amount within the remaining balance.'); return; }
    try { await api.recordFinanceSalaryPayment(row.id, { amount, payment_date: new Date().toISOString().slice(0, 10), payment_method: 'Cash' }); await load(true); }
    catch (err: any) { setError(err?.message || 'Unable to record salary payment.'); }
  };

  const tabs: Array<{ id: ReportTab; label: string; icon: React.ElementType }> = [
    { id: 'overview', label: 'Overview', icon: ChartNoAxesCombined },
    { id: 'fees', label: 'Fee collection', icon: Wallet },
    { id: 'defaulters', label: 'Defaulters', icon: AlertTriangle },
    { id: 'attendance', label: 'Attendance', icon: Activity },
    { id: 'expenses', label: 'Expenses', icon: ArrowDownToLine },
    { id: 'payroll', label: 'Payroll', icon: Wallet },
  ];

  if (loading) return <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center"><RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-800" /><p className="text-sm font-semibold text-neutral-800">Loading live reports…</p><p className="mt-1 text-xs text-neutral-500">Reading fee and attendance records from the school database.</p></div>;

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
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-neutral-200 bg-white p-5"><h3 className="font-bold text-neutral-900">Fee collection performance</h3><div className="mt-5 h-3 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-emerald-700" style={{ width: `${totals.collectionRate}%` }} /></div><div className="mt-3 flex justify-between text-xs"><span className="text-neutral-500">Collected: {money(totals.collected)}</span><span className="font-semibold text-neutral-800">{totals.collectionRate}%</span></div><p className="mt-4 text-xs text-neutral-500">Calculated from fee voucher paid_amount and total_amount fields.</p></article>
          <article className="rounded-2xl border border-neutral-200 bg-white p-5"><h3 className="font-bold text-neutral-900">Attendance distribution</h3><div className="mt-4 grid grid-cols-2 gap-3">{[['Present', totals.present], ['Absent', totals.absent], ['Late', totals.late], ['Leave', totals.leave]].map(([label, value]) => <div key={label} className="rounded-xl bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{label}</p><p className="mt-1 text-xl font-bold text-neutral-900">{value}</p></div>)}</div></article>
        </div>
        <div className="flex flex-wrap gap-2"><button onClick={() => downloadCsv('school-fee-summary.csv', feeRows)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"><FileSpreadsheet className="h-4 w-4" /> Export fee summary CSV</button><button onClick={() => downloadCsv('school-attendance-report.csv', attendanceRows)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"><ArrowDownToLine className="h-4 w-4" /> Export attendance CSV</button></div>
      </>}

      {tab === 'fees' && <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Fee collection report</h3><p className="mt-1 text-xs text-neutral-500">Voucher-level billed, collected and remaining balances.</p></div><button onClick={() => downloadCsv('fee-collection-report.csv', feeRows)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white"><FileSpreadsheet className="h-4 w-4" /> Export CSV</button></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-neutral-50 text-neutral-500"><tr>{['Student','Class','Month','Billed','Collected','Outstanding','Status'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{filteredFees.map(f => <tr key={f.id}><td className="px-4 py-3 font-semibold text-neutral-900">{f.student_name}</td><td className="px-4 py-3">{f.class_name}</td><td className="px-4 py-3">{f.fee_month} {f.year}</td><td className="px-4 py-3">{money(f.total_amount)}</td><td className="px-4 py-3 text-emerald-800">{money(f.paid_amount)}</td><td className="px-4 py-3 text-rose-700">{money(f.pending_amount)}</td><td className="px-4 py-3">{f.status}</td></tr>)}</tbody></table>{filteredFees.length === 0 && <p className="p-8 text-center text-sm text-neutral-500">No fee vouchers found for this filter.</p>}</div></div>}

      {tab === 'defaulters' && <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex items-center justify-between border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Fee defaulters</h3><p className="mt-1 text-xs text-neutral-500">Students with a positive outstanding voucher balance.</p></div><button onClick={() => downloadCsv('fee-defaulters.csv', defaulters.map(f => ({ Student: f.student_name, Class: f.class_name, Month: f.fee_month, Year: f.year, Outstanding: f.pending_amount, DueDate: f.due_date })))} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white"><FileSpreadsheet className="h-4 w-4" /> Export CSV</button></div><div className="divide-y divide-neutral-100">{defaulters.map(f => <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-neutral-900">{f.student_name}</p><p className="mt-1 text-xs text-neutral-500">{f.class_name} · {f.fee_month} {f.year} · Due {f.due_date || 'date not recorded'}</p></div><p className="text-sm font-bold text-rose-700">{money(f.pending_amount)}</p></div>)}{defaulters.length === 0 && <p className="p-8 text-center text-sm text-neutral-500">No outstanding fee vouchers found for this filter.</p>}</div><div className="border-t border-neutral-200 p-4"><button onClick={() => onAskAI('Analyze the current fee defaulters report. Group dues by class and identify high outstanding balances using live records only. Do not send reminders.')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900"><Sparkles className="h-4 w-4" /> Ask AI to analyze defaulters</button></div></div>}

      {tab === 'attendance' && <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4"><div><h3 className="font-bold text-neutral-900">Attendance report</h3><p className="mt-1 text-xs text-neutral-500">Recorded attendance for the selected month and class.</p></div><button onClick={() => downloadCsv('attendance-report.csv', attendanceRows)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white"><FileSpreadsheet className="h-4 w-4" /> Export CSV</button></div><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="bg-neutral-50 text-neutral-500"><tr>{['Date','Student','Class','Section','Status'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{filteredAttendance.map((a,i) => <tr key={a.id || `${a.student_id}-${a.date}-${i}`}><td className="px-4 py-3">{a.date}</td><td className="px-4 py-3 font-semibold text-neutral-900">{a.student_name}</td><td className="px-4 py-3">{a.class_name}</td><td className="px-4 py-3">{a.section}</td><td className="px-4 py-3">{a.status}</td></tr>)}</tbody></table>{filteredAttendance.length === 0 && <p className="p-8 text-center text-sm text-neutral-500">No attendance records found for this filter.</p>}</div></div>}


      {tab === 'expenses' && <div className="space-y-4">
        <form onSubmit={saveExpense} className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-5">
          <input required maxLength={160} placeholder="Expense title" value={expenseDraft.title} onChange={e => setExpenseDraft(v => ({...v,title:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm xl:col-span-2" />
          <select value={expenseDraft.category} onChange={e => setExpenseDraft(v => ({...v,category:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm">{['Utilities','Salaries','Maintenance','Supplies','Transport','Events','Other'].map(x=><option key={x}>{x}</option>)}</select>
          <input required type="number" min="0.01" step="0.01" placeholder="Amount PKR" value={expenseDraft.amount} onChange={e => setExpenseDraft(v => ({...v,amount:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input required type="date" value={expenseDraft.expense_date} onChange={e => setExpenseDraft(v => ({...v,expense_date:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <select value={expenseDraft.payment_method} onChange={e => setExpenseDraft(v => ({...v,payment_method:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm">{['Cash','Bank Transfer','Cheque','JazzCash','Easypaisa','Other'].map(x=><option key={x}>{x}</option>)}</select>
          <button type="submit" className="min-h-10 rounded-lg bg-neutral-950 px-4 text-xs font-bold text-white">Save expense</button>
        </form>
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex items-center justify-between border-b border-neutral-200 p-4"><h3 className="font-bold text-neutral-900">Expense ledger · {money(filteredExpenses.reduce((n,e)=>n+Number(e.amount||0),0))}</h3><button onClick={()=>downloadCsv('expense-ledger.csv',filteredExpenses.map(e=>({Date:e.expense_date,Title:e.title,Category:e.category,Amount:e.amount,Method:e.payment_method})))} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Export CSV</button></div><div className="divide-y divide-neutral-100">{filteredExpenses.map(e=><div key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-neutral-900">{e.title}</p><p className="mt-1 text-xs text-neutral-500">{e.category} · {e.expense_date} · {e.payment_method}</p></div><p className="font-bold text-neutral-900">{money(e.amount)}</p></div>)}{filteredExpenses.length===0&&<p className="p-8 text-center text-sm text-neutral-500">No expense records for this month.</p>}</div></div>
      </div>}
      {tab === 'payroll' && <div className="space-y-4">
        <form onSubmit={savePayroll} className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
          <input required placeholder="Staff ID" value={payrollDraft.staff_id} onChange={e=>setPayrollDraft(v=>({...v,staff_id:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input required placeholder="Staff name" value={payrollDraft.staff_name} onChange={e=>setPayrollDraft(v=>({...v,staff_name:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input required placeholder="Designation" value={payrollDraft.designation} onChange={e=>setPayrollDraft(v=>({...v,designation:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input required type="number" min="0" step="0.01" placeholder="Basic salary PKR" value={payrollDraft.basic_salary} onChange={e=>setPayrollDraft(v=>({...v,basic_salary:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input type="number" min="0" step="0.01" placeholder="Allowances" value={payrollDraft.allowances} onChange={e=>setPayrollDraft(v=>({...v,allowances:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <input type="number" min="0" step="0.01" placeholder="Deductions" value={payrollDraft.deductions} onChange={e=>setPayrollDraft(v=>({...v,deductions:e.target.value}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <select value={payrollDraft.salary_month} onChange={e=>setPayrollDraft(v=>({...v,salary_month:Number(e.target.value)}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm">{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{new Date(2020,i,1).toLocaleString('en',{month:'long'})}</option>)}</select>
          <input type="number" min="2020" max="2100" value={payrollDraft.salary_year} onChange={e=>setPayrollDraft(v=>({...v,salary_year:Number(e.target.value)}))} className="min-h-10 rounded-lg border border-neutral-200 px-3 text-sm" />
          <button type="submit" className="min-h-10 rounded-lg bg-neutral-950 px-4 text-xs font-bold text-white xl:col-span-4">Create salary record</button>
        </form>
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="flex items-center justify-between border-b border-neutral-200 p-4"><h3 className="font-bold text-neutral-900">Staff payroll</h3><button onClick={()=>downloadCsv('staff-payroll.csv',filteredPayroll.map(p=>({Staff:p.staff_name,Designation:p.designation,Period:`${p.salary_month}/${p.salary_year}`,Net:p.net_salary,Paid:p.paid_amount,Balance:Number(p.net_salary)-Number(p.paid_amount),Status:p.status})))} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">Export CSV</button></div><div className="divide-y divide-neutral-100">{filteredPayroll.map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-neutral-900">{p.staff_name} · {p.designation}</p><p className="mt-1 text-xs text-neutral-500">{p.salary_month}/{p.salary_year} · Net {money(p.net_salary)} · Paid {money(p.paid_amount)} · {p.status}</p></div><button disabled={p.status==='Paid'} onClick={()=>void paySalary(p)} className="min-h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 disabled:opacity-40">Record payment</button></div>)}{filteredPayroll.length===0&&<p className="p-8 text-center text-sm text-neutral-500">No payroll records for this month.</p>}</div></div>
      </div>}

      <p className="text-[11px] leading-relaxed text-neutral-400">Reports reflect records currently saved in the connected database. Expense and payroll reports are not shown until dedicated expense and salary records are implemented; no estimated values are substituted.</p>
    </section>
  );
};
