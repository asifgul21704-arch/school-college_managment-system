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
  assert.ok(route.includes('StudentModel.updateOne('));
  assert.ok(route.includes('buildStudentParentReleaseFilter(studentDoc._id, canonicalUserId, userDoc._id.toString())'));
  assert.ok(route.includes("{ $unset: { parent_user_id: '' } }"));
  assert.ok(route.includes('unlinkResult.matchedCount !== 1'));
  assert.ok(route.includes('updatePipeline: true'));
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


test('parent payment history is rebuilt from current account links and ignores stale denormalized ownership', () => {
  const route = between("router.get('/parent/payments/history'", '// 5. Admin Payments Management');
  assert.match(route, /user\.role === 'parent'[\s\S]*?getLinkedStudentIdsForParent\(user\)/);
  assert.match(route, /query = buildParentPaymentHistoryFilter\(linked\)/);
  assert.match(route, /FeePaymentModel\.find\(query\)/);
  assert.doesNotMatch(route, /parent_user_id:\s*user\.id/);
  assert.doesNotMatch(route, /ParentModel\.find/);
});

test('student payment history is scoped to the live linked student aliases', () => {
  const route = between("router.get('/parent/payments/history'", '// 5. Admin Payments Management');
  assert.match(route, /user\.role === 'student'[\s\S]*?findStudentByAnyId\(user\.linked_id\)/);
  assert.match(route, /collectStudentPaymentIdentifiers\(studentDoc\)/);
  assert.match(route, /query = \{ student_id: \{ \$in: studentIds \} \}/);
});

test('payment history has no client-controlled student ID override for parent or student accounts', () => {
  const route = between("router.get('/parent/payments/history'", '// 5. Admin Payments Management');
  assert.doesNotMatch(route, /req\.query\.student_id/);
  assert.match(route, /user\.role === 'parent'[\s\S]*?else if \(user\.role === 'student'\)/);
  assert.match(route, /else \{\s*query = \{\};\s*\}/);
});
