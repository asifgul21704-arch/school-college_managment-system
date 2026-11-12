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
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
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
