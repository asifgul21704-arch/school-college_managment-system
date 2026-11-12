export interface NotificationAccessRecord {
  user_id?: string;
  role?: string;
}

export function buildNotificationVisibilityFilter(userRole: string, allowedUserIds: string[]) {
  const uniqueIds = Array.from(new Set(allowedUserIds.map(id => String(id || '').trim()).filter(Boolean)));
  return {
    $or: [
      { user_id: { $in: uniqueIds } },
      { role: userRole },
      { role: 'all' },
    ],
  };
}

export function canMarkNotificationRead(userRole: string, allowedUserIds: string[], notification: NotificationAccessRecord): boolean {
  if (userRole === 'admin' || userRole === 'super_admin') return true;
  const ownIds = new Set(allowedUserIds.map(id => String(id || '').trim()).filter(Boolean));
  return (
    (Boolean(notification.user_id) && ownIds.has(String(notification.user_id))) ||
    notification.role === userRole ||
    notification.role === 'all'
  );
}
