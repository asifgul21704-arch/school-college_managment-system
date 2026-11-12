import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = routes.indexOf(startMarker);
  const end = routes.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Missing route section: ${startMarker}`);
  return routes.slice(start, end);
}

test('parent unlink removes authoritative links atomically and cannot clear a new owner', () => {
  const route = between("router.post('/parents/unlink-child'", '// Parent directory & profile CRUD');
  assert.match(route, /UserModel\.updateOne\([\s\S]*?linked_student_ids: remainingLinksExpression[\s\S]*?linked_id: \{[\s\S]*?\$cond:[\s\S]*?idsToRemove/);
  assert.match(route, /remainingLinksExpression = \{[\s\S]*?\$filter:[\s\S]*?\$in: \['\$\$linkedId', idsToRemove\]/);
  assert.doesNotMatch(route, /\$pull: \{ linked_student_ids:/);
  assert.match(route, /finalUserDoc\?\.linked_id/);
});

test('parent payment initiation enforces linked child ownership and voucher identity', () => {
  const route = between("router.post('/parent/payments/initiate'", '// 4. Parent Payment History');
  assert.match(route, /if \(user\.role === 'parent'\)[\s\S]*?getLinkedStudentIdsForParent\(user\)/);
  assert.match(route, /isParentLinkedToStudent\(linked, feeStudentAliases\)/);
  assert.match(route, /areSameStudentIdentity\(feeStudentAliases, requestedStudentAliases\)/);
  assert.match(route, /paymentAmount > currentPending/);
  assert.match(route, /normalizeDepositReference\(deposit_slip_ref\)/);
  assert.match(route, /createNotificationOnce\(/);
});

test('payment attachments are validated and method labels are normalized', () => {
  const route = between("router.post('/parent/payments/initiate'", '// 4. Parent Payment History');
  assert.match(route, /isSafeMediaOrWebUrl\(receipt_attachment_url, true\)/);
  assert.match(route, /const paymentMethodLabel = String\(method \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'bank transfer'/);
  assert.match(route, /method: paymentMethodLabel as any/);
  assert.match(route, /sanitizePlainText\(notes/);
});
