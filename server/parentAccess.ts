export interface ParentAccountLinks {
  linked_id?: unknown;
  linked_student_ids?: unknown;
}

function addReference(target: Set<string>, value: unknown): void {
  if (value === null || value === undefined) return;
  const normalized = String(value).trim();
  if (normalized && normalized !== '[object Object]') target.add(normalized);
}

/**
 * Builds a parent's student access set from the current authenticated User record.
 * JWT claims and denormalized Parent/Student records must never be passed here.
 */
export function collectParentStudentReferences(userRecord: ParentAccountLinks | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!userRecord) return ids;

  addReference(ids, userRecord.linked_id);
  if (Array.isArray(userRecord.linked_student_ids)) {
    for (const id of userRecord.linked_student_ids) addReference(ids, id);
  }
  return ids;
}
