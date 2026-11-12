export type ParentNotificationActionType = 'SEND_SMS_ABSENT' | 'SEND_SMS_FEES';

export interface ValidatedParentNotificationAction {
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

  return { studentIds: Array.from(studentIds), message };
}
