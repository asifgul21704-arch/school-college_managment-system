import test from 'node:test';
import assert from 'node:assert/strict';
import { collectParentStudentReferences } from './parentAccess.ts';

test('parent access is derived from current database relationship records', () => {
  const ids = collectParentStudentReferences({
    userRecord: { linked_id: 'student-a', linked_student_ids: ['student-a', 'student-b'] },
    parentRecord: { linked_students: ['student-b', 'student-c'] },
    childRecords: [{ record_id: 'student-d', _id: 'mongo-id-d', admission_no: 'ADM-004' }],
  });

  assert.deepEqual([...ids].sort(), [
    'ADM-004',
    'mongo-id-d',
    'student-a',
    'student-b',
    'student-c',
    'student-d',
  ]);
});

test('removed links are absent when the current database records no longer contain them', () => {
  const ids = collectParentStudentReferences({
    userRecord: { linked_id: '', linked_student_ids: [] },
    parentRecord: { linked_students: [] },
    childRecords: [],
  });

  assert.equal(ids.size, 0);
  assert.equal(ids.has('previously-linked-child'), false);
});

test('missing and malformed relationship fields are safely ignored', () => {
  const ids = collectParentStudentReferences({
    userRecord: { linked_id: '  student-a  ', linked_student_ids: [' ', null, 'student-b'] },
    parentRecord: { linked_students: 'not-an-array' },
    childRecords: [{ record_id: null, _id: undefined, admission_no: 'ADM-01' }],
  });

  assert.deepEqual([...ids].sort(), ['ADM-01', 'student-a', 'student-b']);
});
