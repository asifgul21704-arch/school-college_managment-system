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

/** Exact subject-label matching; partial words must never grant academic write access. */
export function isExactTeacherSubject(assignedSubjects: unknown[], requestedSubject: unknown): boolean {
  if (typeof requestedSubject !== 'string') return false;
  const normalize = (value: unknown) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en') : '';
  const requested = normalize(requestedSubject);
  return Boolean(requested && Array.isArray(assignedSubjects) &&
    assignedSubjects.some(subject => normalize(subject) === requested));
}

/** A teacher may change a result only when every recorded subject is assigned to them. */
export function areAllResultSubjectsAssignedToTeacher(assignedSubjects: unknown[], resultSubjects: unknown[]): boolean {
  return Array.isArray(resultSubjects) && resultSubjects.length > 0 &&
    resultSubjects.every(subject => isExactTeacherSubject(assignedSubjects, subject));
}
