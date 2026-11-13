/**
 * Compare class labels without substring matching.
 * "Class 1" and "Grade 1" are equivalent, but "1" never grants access to "10".
 */
export function normalizeClassAccessLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^(?:class|grade)\s*[-:]?\s*/i, '')
    .trim();
}

export function isClassAssignedToTeacher(assignedClasses: string[], targetClassName: string): boolean {
  const target = normalizeClassAccessLabel(targetClassName);
  if (!target) return false;
  return assignedClasses.some(raw => {
    const assigned = normalizeClassAccessLabel(raw);
    return assigned.length > 0 && assigned === target;
  });
}
