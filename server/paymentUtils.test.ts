import test from 'node:test';
import assert from 'node:assert/strict';
import { getParentPaymentMethodMode, normalizeDepositReference, isExactParentPaymentRetry } from './paymentUtils.ts';

test('wallet and online gateway methods are unavailable until provider verification is integrated', () => {
  for (const method of ['Online Gateway', 'JazzCash', 'Easypaisa', 'Raast', 'Easypaisa / JazzCash']) {
    assert.equal(getParentPaymentMethodMode(method), 'gateway_unavailable', method);
  }
});

test('bank deposit and transfer methods require manual verification', () => {
  for (const method of ['Bank Deposit', 'Bank Transfer']) {
    assert.equal(getParentPaymentMethodMode(method), 'manual_verification', method);
  }
});

test('cash and unknown methods cannot be submitted through the parent payment endpoint', () => {
  for (const method of ['Cash', 'Crypto', 'Gateway', 'Online Slip', '', null, undefined, 123]) {
    assert.equal(getParentPaymentMethodMode(method), 'unsupported');
  }
});

test('student payment filters include every stable student identifier alias', async () => {
  const { collectStudentPaymentIdentifiers } = await import('./paymentUtils.ts');
  assert.deepEqual(
    collectStudentPaymentIdentifiers({
      record_id: 'stu_001',
      _id: '65aa00000000000000000001',
      admission_no: 'ADM-001',
    }),
    ['stu_001', '65aa00000000000000000001', 'ADM-001']
  );
  assert.deepEqual(collectStudentPaymentIdentifiers({ record_id: 'stu_001', admission_no: 'stu_001' }), ['stu_001']);
  assert.deepEqual(collectStudentPaymentIdentifiers(null), []);
});

test('bank deposit references are required, trimmed, and bounded', () => {
  assert.equal(normalizeDepositReference('  SLIP-98412  '), 'SLIP-98412');
  assert.equal(normalizeDepositReference(''), '');
  assert.equal(normalizeDepositReference('   '), '');
  assert.equal(normalizeDepositReference(null), '');
  assert.equal(normalizeDepositReference(12345), '');
  assert.equal(normalizeDepositReference('x'.repeat(129)), '');
  assert.equal(normalizeDepositReference('x'.repeat(128)), 'x'.repeat(128));
});

test('fee payment schema enforces globally unique non-empty bank transaction references', async () => {
  const { FeePaymentModel } = await import('./models/FeePayment.ts');
  const transactionIndex = FeePaymentModel.schema.indexes().find(([keys]) => keys.transaction_id === 1);
  assert.ok(transactionIndex, 'transaction_id unique index must exist');
  assert.equal(transactionIndex?.[1]?.unique, true);
  assert.equal(transactionIndex?.[1]?.sparse, true);
});

test('payment retry recovery requires the same parent, voucher, student, amount, method and pending state', () => {
  const existing = {
    fee_id: 'fee_123',
    student_id: 'student_456',
    amount: 2500,
    method: 'Bank Deposit',
    parent_user_id: 'parent_789',
    verification_status: 'Pending',
  };
  const expected = {
    feeId: 'fee_123',
    studentId: 'student_456',
    amount: 2500,
    method: 'Bank Deposit',
    parentUserId: 'parent_789',
  };

  assert.equal(isExactParentPaymentRetry(existing, expected), true);
  assert.equal(isExactParentPaymentRetry(null, expected), false);
  assert.equal(isExactParentPaymentRetry({ ...existing, parent_user_id: 'another-parent' }, expected), false);
  assert.equal(isExactParentPaymentRetry({ ...existing, fee_id: 'another-fee' }, expected), false);
  assert.equal(isExactParentPaymentRetry({ ...existing, student_id: 'another-student' }, expected), false);
  assert.equal(isExactParentPaymentRetry({ ...existing, amount: 2501 }, expected), false);
  assert.equal(isExactParentPaymentRetry({ ...existing, method: 'Bank Transfer' }, expected), false);
  assert.equal(isExactParentPaymentRetry({ ...existing, verification_status: 'Verified' }, expected), false);
});
