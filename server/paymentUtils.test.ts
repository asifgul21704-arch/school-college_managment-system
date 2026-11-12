import test from 'node:test';
import assert from 'node:assert/strict';
import { getParentPaymentMethodMode } from './paymentUtils.ts';

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
