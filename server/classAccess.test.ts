import test from 'node:test';
import assert from 'node:assert/strict';
import { isClassAssignedToTeacher } from './classAccess.ts';

test('allows exact assigned class names', () => {
  assert.equal(isClassAssignedToTeacher(['Class 1', 'Class 2'], 'Class 1'), true);
});

test('normalizes case and repeated whitespace without widening access', () => {
  assert.equal(isClassAssignedToTeacher(['  CLASS   1  '], 'class 1'), true);
});

test('does not confuse similarly named classes', () => {
  assert.equal(isClassAssignedToTeacher(['Class 1'], 'Class 10'), false);
  assert.equal(isClassAssignedToTeacher(['Class 10'], 'Class 1'), false);
  assert.equal(isClassAssignedToTeacher(['Grade 1'], 'Grade 10'), false);
});

test('fails closed for empty or malformed class names', () => {
  assert.equal(isClassAssignedToTeacher(['Class 1'], ''), false);
  assert.equal(isClassAssignedToTeacher(['Class 1'], '   '), false);
  assert.equal(isClassAssignedToTeacher([''], 'Class 1'), false);
  assert.equal(isClassAssignedToTeacher(['Class 1'], 'Class 1 Section A'), false);
});

test('teacher database filter is restricted to exact assigned class names', async () => {
  const { buildTeacherClassFilter } = await import('./classAccess.ts');
  assert.deepEqual(buildTeacherClassFilter(['Class 1', '  CLASS   2  ']), {
    $or: [
      { class_name: { $regex: '^class\\\\s+1$', $options: 'i' } },
      { class_name: { $regex: '^class\\\\s+2$', $options: 'i' } },
    ],
  });
  assert.deepEqual(buildTeacherClassFilter([]), { $or: [] });
});
