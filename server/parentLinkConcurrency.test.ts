import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStudentParentClaimFilter } from './parentAccess.ts';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
const envConfig = readFileSync(new URL('./config/env.ts', import.meta.url), 'utf8');

test('parent claim filter permits only unclaimed or same-owner student records', () => {
  assert.deepEqual(buildStudentParentClaimFilter('student-mongo-id', 'parent-record-id', 'parent-mongo-id'), {
    _id: 'student-mongo-id',
    parent_user_id: { $in: [null, '', 'parent-record-id', 'parent-mongo-id'] },
  });
  assert.deepEqual(buildStudentParentClaimFilter('student-mongo-id', 'parent-record-id', 'parent-record-id'), {
    _id: 'student-mongo-id',
    parent_user_id: { $in: [null, '', 'parent-record-id'] },
  });
  assert.deepEqual(buildStudentParentClaimFilter('', '', ''), { _id: null });
});

test('both parent linking endpoints use one atomic conditional ownership update', () => {
  const helperStart = routes.indexOf('async function claimStudentForParent');
  const helperEnd = routes.indexOf("// Parent link student endpoint", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = routes.slice(helperStart, helperEnd);
  assert.match(helper, /StudentModel\.findOneAndUpdate\(/);
  assert.match(helper, /buildStudentParentClaimFilter\(studentDoc\._id, canonicalUserId, mongoUserId\)/);
  assert.match(helper, /\$set: \{ parent_user_id: canonicalUserId \}/);

  const firstStart = routes.indexOf("router.post('/parents/link-student'");
  const secondStart = routes.indexOf("router.post('/parents/confirm-link-child'");
  const unlinkStart = routes.indexOf("router.post('/parents/unlink-child'");
  assert.ok(firstStart >= 0 && secondStart > firstStart && unlinkStart > secondStart);
  const firstFlow = routes.slice(firstStart, secondStart);
  const secondFlow = routes.slice(secondStart, unlinkStart);
  assert.match(firstFlow, /claimStudentForParent\(studentDoc, canonicalUserId, userDoc\._id\.toString\(\)\)/);
  assert.match(secondFlow, /claimStudentForParent\(studentDoc, canonicalUserId, userDoc\._id\.toString\(\)\)/);
  assert.match(firstFlow, /\$addToSet: \{ linked_student_ids: canonicalStudentId \}/);
  assert.match(secondFlow, /\$addToSet: \{ linked_student_ids: canonicalStudentId \}/);
  assert.doesNotMatch(firstFlow, /studentDoc\.save\(\)/);
  assert.doesNotMatch(secondFlow, /studentDoc\.save\(\)/);

  const unlinkEnd = routes.indexOf('// Parent directory & profile CRUD', unlinkStart);
  const unlinkFlow = routes.slice(unlinkStart, unlinkEnd);
  assert.match(unlinkFlow, /StudentModel\.updateOne\([\s\S]*parent_user_id: \{ \$in:/);
  assert.doesNotMatch(unlinkFlow, /studentDoc\.save\(\)/);
});

test('parent payment history is limited to currently linked children', () => {
  const start = routes.indexOf("router.get('/parent/payments/history'");
  const end = routes.indexOf('// 5. Admin Payments Management', start);
  assert.ok(start >= 0 && end > start);
  const historyRoute = routes.slice(start, end);
  assert.match(historyRoute, /query = \{ student_id: \{ \$in: Array\.from\(linked\) \} \}/);
  assert.doesNotMatch(historyRoute, /\{\s*parent_user_id\s*:/);
  assert.match(historyRoute, /status\(403\)/);
  assert.doesNotMatch(historyRoute, /query = \{\s*\}/);
});

test('development env loader never reads other processes environment variables', () => {
  assert.doesNotMatch(envConfig, /\/proc/);
  assert.doesNotMatch(envConfig, /readFileSync/);
  assert.doesNotMatch(envConfig, /process\.env\.(MONGODB_URI|JWT_SECRET)\s*=/);
});

test('online gateway requests cannot be marked paid without provider verification', () => {
  const start = routes.indexOf('if (isOnlineGateway) {');
  assert.ok(start >= 0);
  const guard = routes.slice(start, start + 500);
  assert.match(guard, /status\(503\)/);
  assert.match(guard, /verified payment gateway integration/);
  assert.doesNotMatch(guard, /FeePaymentModel\.create/);
});

test('parent payment initiation is restricted to parent and student roles', () => {
  const start = routes.indexOf("router.post('/parent/payments/initiate'");
  const end = routes.indexOf("// 4. Parent Payment History", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['parent', 'student'\]\)/);
});

test('manual payment approval is locked and checks the exact voucher balance before marking paid', () => {
  const start = routes.indexOf("router.post('/admin/payments/:id/approve'");
  const end = routes.indexOf("// 7. Admin Reject Manual Payment", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /status: 'Pending Verification', verification_status: 'Pending'/);
  assert.match(route, /\$set: \{ status: 'Processing' \}/);
  assert.match(route, /pending_amount: currentPending, paid_amount: currentPaid/);
  assert.ok(route.indexOf('FeeModel.findOneAndUpdate') < route.indexOf("status: 'Paid',"));
  assert.match(route, /status: 'Pending Verification'/);
});

test('fee payment initiation verifies the voucher belongs to the authorized student', () => {
  const start = routes.indexOf("router.post('/parent/payments/initiate'");
  const end = routes.indexOf("// 4. Parent Payment History", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /authorizedStudentAliases\.has\(String\(feeDoc\.student_id/);
  assert.match(route, /This fee voucher does not belong to the selected student/);
});

test('fee summary is not accessible to teacher or other unsupported roles', () => {
  assert.match(
    routes,
    /router\.get\('\/parent\/fees\/summary', authenticateToken, requireRole\(\['parent', 'student', 'super_admin', 'admin'\]\)/
  );
});
