/**
 * Exact class-name matching for teacher object-level authorization.
 * Whitespace and letter case are normalized; substring matches are forbidden.
 */
function normalizeClassName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
    : '';
}

export function isClassAssignedToTeacher(assignedClasses: string[], targetClassName: string): boolean {
  const target = normalizeClassName(targetClassName);
  if (!target || !Array.isArray(assignedClasses)) return false;
  return assignedClasses.some(raw => normalizeClassName(raw) === target);
}
