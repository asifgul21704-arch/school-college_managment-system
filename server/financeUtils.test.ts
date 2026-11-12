import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFinanceCashPosition,
  calculatePayrollNet,
  getPayrollStatus,
  isValidIsoDate,
} from './financeUtils.ts';
import { sumPayrollPayments } from '../src/utils/finance.ts';

test('accepts valid ISO calendar dates including leap days', () => {
  assert.equal(isValidIsoDate('2024-02-29'), true);
  assert.equal(isValidIsoDate('2026-11-12'), true);
});

test('rejects impossible or malformed calendar dates', () => {
  assert.equal(isValidIsoDate('2025-02-29'), false);
  assert.equal(isValidIsoDate('2026-04-31'), false);
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidIsoDate('12-11-2026'), false);
});

test('calculates net salary and rejects deductions above gross salary', () => {
  assert.equal(calculatePayrollNet({ basicSalary: 100000, allowances: 5000, deductions: 10000 }), 95000);
  assert.throws(() => calculatePayrollNet({ basicSalary: 100000, allowances: 0, deductions: 100001 }), RangeError);
  assert.throws(() => calculatePayrollNet({ basicSalary: -1 }), RangeError);
});

test('derives payroll status from paid amount', () => {
  assert.equal(getPayrollStatus(50000, 0), 'Unpaid');
  assert.equal(getPayrollStatus(50000, 12500), 'Partially Paid');
  assert.equal(getPayrollStatus(50000, 50000), 'Paid');
});

test('cash position uses actual salary paid and avoids counting unpaid payroll as cash outflow', () => {
  assert.deepEqual(calculateFinanceCashPosition({
    verifiedFeeCollections: 150000,
    operatingExpenses: 30000,
    payrollPaid: 40000,
  }), {
    verifiedFeeCollections: 150000,
    operatingExpenses: 30000,
    payrollPaid: 40000,
    totalOutflow: 70000,
    netCashIndicator: 80000,
  });
  assert.throws(() => calculateFinanceCashPosition({
    verifiedFeeCollections: 100,
    operatingExpenses: -1,
    payrollPaid: 0,
  }), RangeError);
});


test('cash payroll reporting follows actual payment dates rather than salary periods', () => {
  const records = [
    {
      paid_amount: 30000,
      payment_history: [
        { amount: 10000, payment_date: '2026-10-31' },
        { amount: 20000, payment_date: '2026-11-02' },
      ],
    },
    {
      paid_amount: 5000,
      payment_date: '2026-11-12',
      payment_history: [],
    },
  ];

  assert.equal(sumPayrollPayments(records, '2026-10'), 10000);
  assert.equal(sumPayrollPayments(records, '2026-11'), 25000);
  assert.equal(sumPayrollPayments(records), 35000);
  assert.throws(() => sumPayrollPayments(records, '2026-13'), RangeError);
});
