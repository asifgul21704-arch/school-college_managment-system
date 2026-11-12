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
