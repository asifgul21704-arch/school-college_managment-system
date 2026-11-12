/**
 * Match legacy timetable ownership labels without substring-based overmatching.
 * Long-term, timetable records should use immutable teacher IDs.
 */
export function isExactTeacherName(recordName: unknown, authenticatedName: unknown): boolean {
  if (typeof recordName !== 'string' || typeof authenticatedName !== 'string') return false;
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const record = normalize(recordName);
  const authenticated = normalize(authenticatedName);
  return Boolean(record && authenticated && record === authenticated);
}
