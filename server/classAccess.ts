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

/** Builds a database-level class scope for teacher queries; empty assignments fail closed. */
export function buildTeacherClassFilter(assignedClasses: string[]): Record<string, unknown> {
  if (!Array.isArray(assignedClasses)) return { $or: [] };
  const normalized = Array.from(new Set(assignedClasses.map(normalizeClassName).filter(Boolean)));
  if (normalized.length === 0) return { $or: [] };
  return {
    $or: normalized.map(className => {
      const escaped = className.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&').replace(/\s+/g, '\\s+');
      return { class_name: { $regex: '^' + escaped + '$', $options: 'i' } };
    }),
  };
}
