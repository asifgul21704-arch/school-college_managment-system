import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParentNotificationAction } from './notificationUtils.ts';

const validPayload = {
  message: '  Fee reminder  ',
  recipients: [{ studentId: 'student-1' }, { studentId: 'student-1' }, { studentId: 'student-2' }],
};

test('allows only confirmed admin and super-admin notification actions', () => {
  assert.deepEqual(
    validateParentNotificationAction('SEND_SMS_ABSENT', validPayload, true, 'admin'),
    { studentIds: ['student-1', 'student-2'], message: 'Fee reminder' },
  );
  assert.deepEqual(
    validateParentNotificationAction('SEND_SMS_FEES', validPayload, true, 'super_admin'),
    { studentIds: ['student-1', 'student-2'], message: 'Fee reminder' },
  );
});

test('rejects non-admin roles, missing confirmation, and unsupported action types', () => {
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', validPayload, true, 'teacher'), /Forbidden/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', validPayload, false, 'admin'), /confirmation/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_CUSTOM', validPayload, true, 'admin'), /Unsupported/);
});

test('rejects empty, oversized, or malformed recipient lists and invalid student IDs', () => {
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', { message: 'Hi', recipients: [] }, true, 'admin'), /1 to 5000/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', { message: 'Hi', recipients: Array(5001).fill({ studentId: 's' }) }, true, 'admin'), /1 to 5000/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', { message: 'Hi', recipients: [{ studentId: '' }] }, true, 'admin'), /Invalid student/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', { message: 'Hi', recipients: [{ studentId: 'x'.repeat(129) }] }, true, 'admin'), /Invalid student/);
});

test('rejects blank or oversized notification messages', () => {
  assert.throws(() => validateParentNotificationAction('SEND_SMS_FEES', { message: '  ', recipients: [{ studentId: 's' }] }, true, 'admin'), /message is required/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_FEES', { message: 'x'.repeat(1001), recipients: [{ studentId: 's' }] }, true, 'admin'), /message is required/);
});
