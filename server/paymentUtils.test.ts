import test from 'node:test';
import assert from 'node:assert/strict';
import { getParentPaymentMethodMode } from './paymentUtils.ts';

test('wallet and online gateway methods are unavailable until provider verification is integrated', () => {
  for (const method of ['Online Gateway', 'JazzCash', 'Easypaisa', 'Raast', 'Easypaisa / JazzCash']) {
    assert.equal(getParentPaymentMethodMode(method), 'gateway_unavailable', method);
  }
});

test('bank deposit and transfer methods require manual verification', () => {
  for (const method of ['Bank Deposit', 'Bank Transfer', 'Online Slip']) {
    assert.equal(getParentPaymentMethodMode(method), 'manual_verification', method);
  }
});

test('cash and unknown methods cannot be submitted through the parent payment endpoint', () => {
  for (const method of ['Cash', 'Crypto', 'Gateway', '', null, undefined, 123]) {
    assert.equal(getParentPaymentMethodMode(method), 'unsupported');
  }
});
