export interface NotificationAccessRecord {
  user_id?: string;
  role?: string;
}

export function buildNotificationVisibilityFilter(userRole: string, allowedUserIds: string[]) {
  const uniqueIds = Array.from(new Set(allowedUserIds.map(id => String(id || '').trim()).filter(Boolean)));
  const broadcastUserIds = ['', null];
  return {
    $or: [
      { user_id: { $in: uniqueIds } },
      { role: userRole, user_id: { $in: broadcastUserIds } },
      { role: 'all', user_id: { $in: broadcastUserIds } },
    ],
  };
}

export function canMarkNotificationRead(userRole: string, allowedUserIds: string[], notification: NotificationAccessRecord): boolean {
  if (userRole === 'admin' || userRole === 'super_admin') return true;
  const ownIds = new Set(allowedUserIds.map(id => String(id || '').trim()).filter(Boolean));
  const notificationUserId = String(notification.user_id || '').trim();
  if (notificationUserId) return ownIds.has(notificationUserId);
  return notification.role === userRole || notification.role === 'all';
}
