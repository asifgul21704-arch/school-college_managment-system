import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationVisibilityFilter, canMarkNotificationRead } from './notificationAccess.ts';

test('private parent notification is visible only to its exact parent account', () => {
  const filterA = buildNotificationVisibilityFilter('parent', ['parent-a', 'student-1']);
  const privateRecord = { user_id: 'parent-a', role: 'private' };
  assert.equal(canMarkNotificationRead('parent', ['parent-a', 'student-1'], privateRecord), true);
  assert.equal(canMarkNotificationRead('parent', ['parent-b', 'student-2'], privateRecord), false);
  assert.deepEqual(filterA.$or, [
    { user_id: { $in: ['parent-a', 'student-1'] } },
    { role: 'parent', user_id: { $in: ['', null] } },
    { role: 'all', user_id: { $in: ['', null] } },
  ]);
  assert.equal(canMarkNotificationRead('parent', ['parent-b'], { user_id: 'parent-a', role: 'parent' }), false);
  assert.equal(canMarkNotificationRead('parent', ['parent-a'], { user_id: 'parent-a', role: 'parent' }), true);
});

test('role-wide and all-role notifications retain intended visibility', () => {
  assert.equal(canMarkNotificationRead('teacher', ['teacher-1'], { user_id: '', role: 'teacher' }), true);
  assert.equal(canMarkNotificationRead('student', ['student-1'], { user_id: '', role: 'all' }), true);
});

test('non-admin cannot mark another account private notification as read', () => {
  assert.equal(canMarkNotificationRead('student', ['student-1'], { user_id: 'student-2', role: 'private' }), false);
  assert.equal(canMarkNotificationRead('parent', ['parent-a'], { user_id: 'parent-a', role: 'private' }), true);
});

test('admin can moderate notification read state and IDs are normalized', () => {
  assert.equal(canMarkNotificationRead('admin', [], { user_id: 'parent-a', role: 'private' }), true);
  assert.deepEqual(buildNotificationVisibilityFilter('parent', ['parent-a', '', 'parent-a']).$or[0], {
    user_id: { $in: ['parent-a'] },
  });
});
