import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationBatchId, createNotificationBatchOnce, executeParentNotificationWorkflow, validateParentNotificationAction } from './notificationUtils.ts';

const message = 'Fee reminder';
const date = '2026-11-12';
const actionId = createNotificationBatchId('SEND_SMS_FEES', date, ['student-1', 'student-2'], message);
const validPayload = {
  actionId,
  date,
  message: '  Fee reminder  ',
  recipients: [{ studentId: 'student-1' }, { studentId: 'student-1' }, { studentId: 'student-2' }],
};

test('allows only confirmed admin and super-admin notification actions', () => {
  assert.deepEqual(
    validateParentNotificationAction('SEND_SMS_ABSENT', { ...validPayload, actionId: createNotificationBatchId('SEND_SMS_ABSENT', date, ['student-1', 'student-2'], message) }, true, 'admin'),
    { actionId: createNotificationBatchId('SEND_SMS_ABSENT', date, ['student-1', 'student-2'], message), studentIds: ['student-1', 'student-2'], message: 'Fee reminder' },
  );
  assert.deepEqual(
    validateParentNotificationAction('SEND_SMS_FEES', validPayload, true, 'super_admin'),
    { actionId, studentIds: ['student-1', 'student-2'], message: 'Fee reminder' },
  );
});

test('rejects non-admin roles, missing confirmation, unsupported actions, and client-invented tokens', () => {
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', validPayload, true, 'teacher'), /Forbidden/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', validPayload, false, 'admin'), /confirmation/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_CUSTOM', validPayload, true, 'admin'), /Unsupported/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_FEES', { ...validPayload, actionId: 'b'.repeat(64) }, true, 'admin'), /does not match/);
});

test('rejects empty, oversized, or malformed recipient lists and invalid student IDs', () => {
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', { ...validPayload, recipients: [] }, true, 'admin'), /1 to 5000/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', { ...validPayload, recipients: Array(5001).fill({ studentId: 's' }) }, true, 'admin'), /1 to 5000/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', { ...validPayload, recipients: [{ studentId: '' }] }, true, 'admin'), /Invalid student/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_ABSENT', { ...validPayload, recipients: [{ studentId: 'x'.repeat(129) }] }, true, 'admin'), /Invalid student/);
});

test('rejects blank or oversized notification messages', () => {
  assert.throws(() => validateParentNotificationAction('SEND_SMS_FEES', { ...validPayload, message: '  ' }, true, 'admin'), /message is required/);
  assert.throws(() => validateParentNotificationAction('SEND_SMS_FEES', { ...validPayload, message: 'x'.repeat(1001) }, true, 'admin'), /message is required/);
});

test('replaying the same action creates each recipient notification only once', async () => {
  const persisted = new Set<string>();
  const createOnce = async (id: string, recipient: string) => {
    const key = id + ':' + recipient;
    if (persisted.has(key)) return false;
    persisted.add(key);
    return true;
  };

  const first = await createNotificationBatchOnce(actionId, ['parent-a', 'parent-b', 'parent-a'], createOnce);
  const replay = await createNotificationBatchOnce(actionId, ['parent-a', 'parent-b'], createOnce);

  assert.deepEqual(first, { createdCount: 2, existingCount: 0 });
  assert.deepEqual(replay, { createdCount: 0, existingCount: 2 });
  assert.equal(persisted.size, 2);
});

test('concurrent retries remain idempotent with an atomic persistence adapter', async () => {
  const persisted = new Set<string>();
  const createOnce = async (id: string, recipient: string) => {
    const key = id + ':' + recipient;
    if (persisted.has(key)) return false;
    // The production MongoDB unique index provides this atomic guarantee.
    persisted.add(key);
    return true;
  };

  const results = await Promise.all([
    createNotificationBatchOnce(actionId, ['parent-a', 'parent-b'], createOnce),
    createNotificationBatchOnce(actionId, ['parent-a', 'parent-b'], createOnce),
  ]);

  assert.equal(persisted.size, 2);
  assert.equal(results.reduce((sum, result) => sum + result.createdCount, 0), 2);
});

test('end-to-end confirmation workflow resolves linked parents and skips a replay', async () => {
  const linkedParents = new Map([
    ['student-1', ['parent-a', 'parent-a']],
    ['student-2', ['parent-b']],
  ]);
  const persisted = new Set<string>();
  const resolveParentIds = async (studentIds: string[]) =>
    studentIds.flatMap(studentId => linkedParents.get(studentId) || []);
  const createOnce = async (id: string, recipient: string) => {
    const key = id + ':' + recipient;
    if (persisted.has(key)) return false;
    persisted.add(key);
    return true;
  };
  const payload = {
    actionId,
    date,
    message,
    recipients: [{ studentId: 'student-1' }, { studentId: 'student-2' }],
  };

  const first = await executeParentNotificationWorkflow(
    'SEND_SMS_FEES', payload, true, 'admin', resolveParentIds, createOnce
  );
  const replay = await executeParentNotificationWorkflow(
    'SEND_SMS_FEES', payload, true, 'admin', resolveParentIds, createOnce
  );

  assert.deepEqual(first, { actionId, createdCount: 2, existingCount: 0, recipientCount: 2 });
  assert.deepEqual(replay, { actionId, createdCount: 0, existingCount: 2, recipientCount: 2 });
  assert.equal(persisted.size, 2);
});

test('end-to-end confirmation workflow refuses unlinked recipients', async () => {
  await assert.rejects(
    executeParentNotificationWorkflow(
      'SEND_SMS_FEES',
      validPayload,
      true,
      'admin',
      async () => [],
      async () => true
    ),
    /No verified linked parent accounts/
  );
});

test('MongoDB notification schema has the unique action-and-recipient index used for replay protection', async () => {
  const { NotificationModel } = await import('./models/Notification.ts');
  const index = NotificationModel.schema.indexes().find(([keys]) =>
    keys.action_id === 1 && keys.user_id === 1
  );
  assert.ok(index, 'notification action/recipient index must exist');
  assert.equal(index?.[1]?.unique, true);
  assert.deepEqual(index?.[1]?.partialFilterExpression, { action_id: { $type: 'string' } });
});
