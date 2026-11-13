import test from 'node:test';
import assert from 'node:assert/strict';
import { collectParentStudentReferences, isParentLinkedToStudent } from './parentAccess.ts';

test('parent access comes only from the current database User record', () => {
  const ids = collectParentStudentReferences({
    linked_id: 'student-a',
    linked_student_ids: ['student-a', 'student-b'],
  });

  assert.deepEqual([...ids].sort(), ['student-a', 'student-b']);
});

test('an unlinked database account immediately has no child access', () => {
  const ids = collectParentStudentReferences({
    linked_id: '',
    linked_student_ids: [],
  });

  assert.equal(ids.size, 0);
  assert.equal(ids.has('previously-linked-child'), false);
});

test('missing and malformed link fields are safely ignored', () => {
  const ids = collectParentStudentReferences({
    linked_id: '  student-a  ',
    linked_student_ids: [' ', null, 'student-b'],
  });

  assert.deepEqual([...ids].sort(), ['student-a', 'student-b']);
});

test('missing user record fails closed', () => {
  assert.equal(collectParentStudentReferences(null).size, 0);
  assert.equal(collectParentStudentReferences(undefined).size, 0);
});

test('parent can access only student identifiers in the current account link set', () => {
  const linked = new Set(['student-a', 'ADM-001']);
  assert.equal(isParentLinkedToStudent(linked, ['student-a', 'mongo-id-a']), true);
  assert.equal(isParentLinkedToStudent(linked, ['student-b', 'ADM-002']), false);
  assert.equal(isParentLinkedToStudent(linked, [null, '', undefined]), false);
});

test('parent payment history is restricted to currently linked student IDs only', async () => {
  const { buildParentPaymentHistoryFilter } = await import('./parentAccess.ts');
  assert.deepEqual(buildParentPaymentHistoryFilter(new Set(['student-a', 'student-b'])), {
    student_id: { $in: ['student-a', 'student-b'] },
  });
  assert.deepEqual(buildParentPaymentHistoryFilter(new Set()), { student_id: { $in: [] } });
  assert.equal('parent_user_id' in buildParentPaymentHistoryFilter(new Set(['student-a'])), false);
});

test('guardian link confirmation requires an exact father name match', async () => {
  const { isExactGuardianNameMatch } = await import('./parentAccess.ts');
  assert.equal(isExactGuardianNameMatch('Muhammad Asif Khan', '  muhammad   asif khan '), true);
  assert.equal(isExactGuardianNameMatch('Muhammad Asif Khan', 'Asif Khan'), false);
  assert.equal(isExactGuardianNameMatch('Muhammad Asif Khan', 'Muhammad Asif'), false);
  assert.equal(isExactGuardianNameMatch('Muhammad Asif Khan', 'Muhammad Asif Khan Jr'), false);
  assert.equal(isExactGuardianNameMatch('', 'Muhammad Asif Khan'), false);
  assert.equal(isExactGuardianNameMatch('Muhammad Asif Khan', ''), false);
});

test('fee voucher student identity must match the requested student across known aliases', async () => {
  const { areSameStudentIdentity } = await import('./parentAccess.ts');
  const studentA = ['stu_a', '65aa00000000000000000001', 'ADM-001'];
  const studentB = ['stu_b', '65aa00000000000000000002', 'ADM-002'];
  assert.equal(areSameStudentIdentity(studentA, ['ADM-001']), true);
  assert.equal(areSameStudentIdentity(studentA, ['65aa00000000000000000001']), true);
  assert.equal(areSameStudentIdentity(studentA, studentB), false);
  assert.equal(areSameStudentIdentity([], ['ADM-001']), false);
});

test('a student already assigned to another parent cannot be claimed by this parent', async () => {
  const { isStudentClaimedByAnotherParent } = await import('./parentAccess.ts');
  assert.equal(isStudentClaimedByAnotherParent('parent-a', ['parent-b']), true);
  assert.equal(isStudentClaimedByAnotherParent('parent-a', ['parent-a']), false);
  assert.equal(isStudentClaimedByAnotherParent('', ['parent-b']), false);
  assert.equal(isStudentClaimedByAnotherParent(null, ['parent-b']), false);
});

test('parent student lookup filter includes only linked aliases and fails closed when empty', async () => {
  const { buildParentLinkedStudentFilter } = await import('./parentAccess.ts');
  assert.deepEqual(
    buildParentLinkedStudentFilter(new Set(['student-a', 'ADM-001', '65aa00000000000000000001', 'student-a'])),
    {
      $or: [
        { record_id: { $in: ['student-a', 'ADM-001', '65aa00000000000000000001'] } },
        { admission_no: { $in: ['student-a', 'ADM-001', '65aa00000000000000000001'] } },
        { _id: { $in: ['65aa00000000000000000001'] } },
      ],
    }
  );
  assert.deepEqual(buildParentLinkedStudentFilter(new Set()), { _id: { $in: [] } });
});

test('student unlink ownership release is atomic and restricted to the current parent aliases', async () => {
  const { buildStudentParentReleaseFilter } = await import('./parentAccess.ts');
  assert.deepEqual(
    buildStudentParentReleaseFilter('student-mongo-id', 'parent-record-id', 'parent-mongo-id'),
    { _id: 'student-mongo-id', parent_user_id: { $in: ['parent-record-id', 'parent-mongo-id'] } }
  );
  assert.deepEqual(buildStudentParentReleaseFilter('', '', ''), { _id: null });
});
