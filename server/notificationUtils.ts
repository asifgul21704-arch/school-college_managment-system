export type ParentNotificationActionType = 'SEND_SMS_ABSENT' | 'SEND_SMS_FEES';

import { createHash } from 'node:crypto';

export function createNotificationBatchId(actionType: string, date: string, studentIds: string[], message: string): string {
  return createHash('sha256').update(JSON.stringify({ actionType, date, studentIds: [...new Set(studentIds)].sort(), message: message.trim() })).digest('hex');
}

export interface ValidatedParentNotificationAction {
  actionId: string;
  studentIds: string[];
  message: string;
}

/**
 * Validate the admin-confirmed notification request before resolving linked
 * parent accounts from the database. Client-supplied parent IDs are ignored.
 */
export function validateParentNotificationAction(
  actionType: string,
  payload: unknown,
  confirmed: boolean,
  userRole: string
): ValidatedParentNotificationAction {
  if (userRole !== 'admin' && userRole !== 'super_admin') {
    throw new Error('Forbidden: Admin confirmation is required.');
  }
  if (confirmed !== true) {
    throw new Error('Action aborted: Explicit admin confirmation is mandatory.');
  }
  if (actionType !== 'SEND_SMS_ABSENT' && actionType !== 'SEND_SMS_FEES') {
    throw new Error('Unsupported notification action type.');
  }

  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const actionId = typeof data.actionId === 'string' ? data.actionId.trim() : '';
  if (!/^[0-9a-f]{64}$/i.test(actionId)) {
    throw new Error('A valid notification batch idempotency key is required.');
  }

  const message = typeof data.message === 'string' ? data.message.trim() : '';
  if (!message || message.length > 1000) {
    throw new Error('Notification message is required and must be 1000 characters or fewer.');
  }

  const recipients = data.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 5000) {
    throw new Error('A valid list of 1 to 5000 linked parent recipients is required.');
  }

  const studentIds = new Set<string>();
  for (const recipient of recipients) {
    const studentId = recipient && typeof recipient === 'object' &&
      typeof (recipient as Record<string, unknown>).studentId === 'string'
      ? ((recipient as Record<string, unknown>).studentId as string).trim()
      : '';
    if (!studentId || studentId.length > 128) {
      throw new Error('Invalid student reference. No notifications were created.');
    }
    studentIds.add(studentId);
  }

  const normalizedStudentIds = Array.from(studentIds);
  const date = typeof data.date === 'string' ? data.date.trim() : '';
  const expectedActionId = createNotificationBatchId(actionType, date, normalizedStudentIds, message);
  if (!date || actionId !== expectedActionId) {
    throw new Error('Notification batch idempotency key does not match the confirmed action details.');
  }

  return { actionId, studentIds: normalizedStudentIds, message };
}

/**
 * Run one idempotent write per recipient. The persistence adapter must enforce
 * a unique (actionId, recipientId) key so concurrent/replayed requests are safe.
 */
export async function createNotificationBatchOnce(
  actionId: string,
  recipientIds: string[],
  createOnce: (actionId: string, recipientId: string) => Promise<boolean>
): Promise<{ createdCount: number; existingCount: number }> {
  const uniqueRecipientIds = Array.from(new Set(recipientIds.map(id => id.trim()).filter(Boolean)));
  const results = await Promise.all(uniqueRecipientIds.map(id => createOnce(actionId, id)));
  const createdCount = results.filter(Boolean).length;
  return { createdCount, existingCount: results.length - createdCount };
}
