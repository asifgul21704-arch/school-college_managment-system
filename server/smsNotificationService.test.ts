import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSimulatedSmsResult } from './services/smsNotificationService.ts';

test('simulated SMS never claims delivery and retains a preview for audit', () => {
  const result = buildSimulatedSmsResult(
    'Fee payment confirmation preview',
    '+92 300 0000000',
    '2026-11-12T12:00:00.000Z'
  );
  assert.equal(result.sent, false);
  assert.equal(result.status, 'Skipped');
  assert.equal(result.message, 'Fee payment confirmation preview');
  assert.equal(result.destination_phone, '+92 300 0000000');
  assert.equal(result.timestamp, '2026-11-12T12:00:00.000Z');
});

test('simulated SMS result does not include a destination when none is supplied', () => {
  const result = buildSimulatedSmsResult('Preview only', undefined, '2026-11-12T12:00:00.000Z');
  assert.equal(result.sent, false);
  assert.equal(result.status, 'Skipped');
  assert.equal('destination_phone' in result, false);
});
