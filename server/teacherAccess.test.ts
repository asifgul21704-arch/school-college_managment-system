import test from 'node:test';
import assert from 'node:assert/strict';
import { isExactTeacherName } from './teacherAccess.ts';

test('matches exact teacher names case-insensitively', () => {
  assert.equal(isExactTeacherName('Muhammad Asif Khan', 'muhammad asif khan'), true);
});

test('normalizes whitespace but not partial names', () => {
  assert.equal(isExactTeacherName('  Ali   Khan ', 'ali khan'), true);
  assert.equal(isExactTeacherName('Ali', 'Alina'), false);
  assert.equal(isExactTeacherName('Ali Khan', 'Ali'), false);
});

test('fails closed for missing or malformed identity labels', () => {
  assert.equal(isExactTeacherName('', 'Ali'), false);
  assert.equal(isExactTeacherName('Ali', ''), false);
  assert.equal(isExactTeacherName(null, 'Ali'), false);
});

test('teacher subject authorization requires exact normalized subject', async () => {
  const { isExactTeacherSubject } = await import('./teacherAccess.ts');
  assert.equal(isExactTeacherSubject(['Computer Science', 'Physics'], ' computer   science '), true);
  assert.equal(isExactTeacherSubject(['Computer Science'], 'Computer'), false);
  assert.equal(isExactTeacherSubject(['Computer Science'], 'Science'), false);
  assert.equal(isExactTeacherSubject(['Physics'], ''), false);
});

test('teacher may manage a multi-subject result only when every subject is assigned', async () => {
  const { areAllResultSubjectsAssignedToTeacher } = await import('./teacherAccess.ts');
  assert.equal(areAllResultSubjectsAssignedToTeacher(['Physics', 'Math'], ['Physics', ' Math ']), true);
  assert.equal(areAllResultSubjectsAssignedToTeacher(['Physics'], ['Physics', 'Chemistry']), false);
  assert.equal(areAllResultSubjectsAssignedToTeacher(['Physics'], []), false);
});
