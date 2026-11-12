import test from 'node:test';
import assert from 'node:assert/strict';
import { collectParentStudentReferences } from './parentAccess.ts';

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
