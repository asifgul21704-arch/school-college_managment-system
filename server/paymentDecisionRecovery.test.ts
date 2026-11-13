import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
const approvalStart = routes.indexOf("router.post('/admin/payments/:id/approve'");
const rejectionStart = routes.indexOf("router.post('/admin/payments/:id/reject'");
const settingsStart = routes.indexOf("router.get('/admin/payments/settings'");
assert.ok(approvalStart >= 0 && rejectionStart > approvalStart && settingsStart > rejectionStart);
const approvalRoute = routes.slice(approvalStart, rejectionStart);
const rejectionRoute = routes.slice(rejectionStart, settingsStart);

test('approval retry only replays a previously verified payment with an issued receipt', () => {
  assert.match(approvalRoute, /existing\.status === 'Paid' && existing\.verification_status === 'Verified' && existing\.receipt_no/);
  assert.match(approvalRoute, /idempotentReplay = true/);
  assert.match(approvalRoute, /if \(!idempotentReplay\)[\s\S]*?sendPaymentApprovalSms/);
  assert.match(approvalRoute, /createNotificationOnce\([\s\S]*?fee-approve:/);
  assert.match(approvalRoute, /if \(!idempotentReplay\) \{[\s\S]*?recordMongoAudit/);
});

test('rejection retry preserves the stored reason and replays only the idempotent notification', () => {
  assert.match(rejectionRoute, /existing\.status === 'Rejected' && existing\.verification_status === 'Rejected'/);
  assert.match(rejectionRoute, /idempotentReplay = true/);
  assert.match(rejectionRoute, /if \(!idempotentReplay\)[\s\S]*?sendPaymentRejectionSms/);
  assert.match(rejectionRoute, /fee-reject:[\s\S]*?paymentDoc\.rejection_reason \|\| cleanReason/);
  assert.match(rejectionRoute, /if \(!idempotentReplay\) \{[\s\S]*?recordMongoAudit/);
});
