export interface PayrollAmounts {
  basicSalary: number;
  allowances?: number;
  deductions?: number;
}

export interface FinanceCashPosition {
  verifiedFeeCollections: number;
  operatingExpenses: number;
  payrollPaid: number;
  totalOutflow: number;
  netCashIndicator: number;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function calculatePayrollNet({ basicSalary, allowances = 0, deductions = 0 }: PayrollAmounts): number {
  if (![basicSalary, allowances, deductions].every(Number.isFinite) || basicSalary < 0 || allowances < 0 || deductions < 0) {
    throw new RangeError('Salary amounts must be finite and non-negative.');
  }
  const gross = basicSalary + allowances;
  if (deductions > gross) throw new RangeError('Deductions cannot exceed gross salary.');
  return Number((gross - deductions).toFixed(2));
}

export function getPayrollStatus(netSalary: number, paidAmount: number): 'Unpaid' | 'Partially Paid' | 'Paid' {
  if (paidAmount <= 0) return 'Unpaid';
  return paidAmount >= netSalary ? 'Paid' : 'Partially Paid';
}

export function calculateFinanceCashPosition(input: {
  verifiedFeeCollections: number;
  operatingExpenses: number;
  payrollPaid: number;
}): FinanceCashPosition {
  const values = [input.verifiedFeeCollections, input.operatingExpenses, input.payrollPaid];
  if (!values.every(value => Number.isFinite(value) && value >= 0)) {
    throw new RangeError('Finance totals must be finite and non-negative.');
  }
  const totalOutflow = Number((input.operatingExpenses + input.payrollPaid).toFixed(2));
  return {
    verifiedFeeCollections: Number(input.verifiedFeeCollections.toFixed(2)),
    operatingExpenses: Number(input.operatingExpenses.toFixed(2)),
    payrollPaid: Number(input.payrollPaid.toFixed(2)),
    totalOutflow,
    netCashIndicator: Number((input.verifiedFeeCollections - totalOutflow).toFixed(2)),
  };
}


export interface PayrollCashRecord {
  paid_amount: number;
  payment_date?: string;
  payment_history?: ReadonlyArray<{ amount: number; payment_date: string }>;
}

/**
 * Sums payroll cash outflows by payment date, not by the salary period.
 * Older records without payment_history use their legacy payment_date.
 */
export function sumPayrollPayments(records: readonly PayrollCashRecord[], month?: string): number {
  if (month && !/^\\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError('Payroll payment month must use YYYY-MM format.');
  }

  const total = records.reduce((sum, record) => {
    if (!month) return sum + (Number.isFinite(record.paid_amount) ? record.paid_amount : 0);

    const history = Array.isArray(record.payment_history) ? record.payment_history : [];
    if (history.length > 0) {
      return sum + history.reduce((paymentSum, payment) => {
        const amount = Number(payment.amount);
        return payment.payment_date?.startsWith(month) && Number.isFinite(amount) && amount > 0
          ? paymentSum + amount
          : paymentSum;
      }, 0);
    }

    const legacyAmount = Number(record.paid_amount);
    return record.payment_date?.startsWith(month) && Number.isFinite(legacyAmount) && legacyAmount > 0
      ? sum + legacyAmount
      : sum;
  }, 0);

  return Number(total.toFixed(2));
}
