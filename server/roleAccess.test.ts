import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAnyRole, hasExactRole } from './roleAccess.ts';

const roles = ['super_admin', 'admin', 'teacher', 'parent', 'student'] as const;

test('admin-only routes admit admins and super-admins only', () => {
  for (const role of roles) {
    assert.equal(hasAnyRole(role, ['admin']), role === 'admin' || role === 'super_admin');
  }
});

test('teacher-only routes deny students, parents and admins unless super-admin bypass is intended', () => {
  assert.equal(hasAnyRole('teacher', ['teacher']), true);
  assert.equal(hasAnyRole('student', ['teacher']), false);
  assert.equal(hasAnyRole('parent', ['teacher']), false);
  assert.equal(hasAnyRole('admin', ['teacher']), false);
  assert.equal(hasAnyRole('super_admin', ['teacher']), true);
});

test('exact-role guards do not implicitly grant super-admin access', () => {
  assert.equal(hasExactRole('super_admin', ['admin']), false);
  assert.equal(hasExactRole('admin', ['admin']), true);
  assert.equal(hasExactRole('teacher', ['teacher']), true);
  assert.equal(hasExactRole('student', ['teacher']), false);
});
