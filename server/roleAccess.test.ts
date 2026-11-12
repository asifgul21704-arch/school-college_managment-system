import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRole, requireExactRole } from './auth.ts';
import { hasAnyRole, hasExactRole } from './roleAccess.ts';

function runGuard(guard: any, user?: Record<string, unknown>) {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  let nextCalled = false;
  guard({ user } as any, response, () => { nextCalled = true; });
  return { response, nextCalled };
}

test('admin-only middleware returns 401 without authentication', () => {
  const { response, nextCalled } = runGuard(requireRole(['admin']));
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('admin-only middleware permits admin and super-admin, rejects other roles', () => {
  for (const role of ['super_admin', 'admin', 'teacher', 'parent', 'student']) {
    const { response, nextCalled } = runGuard(requireRole(['admin']), { role });
    assert.equal(nextCalled, role === 'super_admin' || role === 'admin');
    assert.equal(response.statusCode, role === 'super_admin' || role === 'admin' ? 200 : 403);
  }
});

test('exact-role middleware does not apply the super-admin bypass', () => {
  const superAdmin = runGuard(requireExactRole(['admin']), { role: 'super_admin' });
  const admin = runGuard(requireExactRole(['admin']), { role: 'admin' });
  assert.equal(superAdmin.response.statusCode, 403);
  assert.equal(superAdmin.nextCalled, false);
  assert.equal(admin.response.statusCode, 200);
  assert.equal(admin.nextCalled, true);
});

test('role policy helpers match the middleware contract', () => {
  assert.equal(hasAnyRole('super_admin', ['teacher']), true);
  assert.equal(hasAnyRole('parent', ['teacher']), false);
  assert.equal(hasExactRole('super_admin', ['admin']), false);
  assert.equal(hasExactRole('admin', ['admin']), true);
});
