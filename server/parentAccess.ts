export interface ParentAccessRecords {
  userRecord?: {
    linked_id?: unknown;
    linked_student_ids?: unknown;
  } | null;
  parentRecord?: {
    linked_students?: unknown;
  } | null;
  childRecords?: Array<{
    record_id?: unknown;
    _id?: unknown;
    admission_no?: unknown;
  }> | null;
}

function addReference(target: Set<string>, value: unknown): void {
  if (value === null || value === undefined) return;
  const normalized = String(value).trim();
  if (normalized && normalized !== '[object Object]') target.add(normalized);
}

/**
 * Builds the current parent-to-student relationship set from database records.
 * Do not pass JWT claims here: stale tokens must not restore revoked relationships.
 */
export function collectParentStudentReferences(records: ParentAccessRecords): Set<string> {
  const ids = new Set<string>();
  const user = records.userRecord;
  const parent = records.parentRecord;

  if (user) {
    addReference(ids, user.linked_id);
    if (Array.isArray(user.linked_student_ids)) {
      for (const id of user.linked_student_ids) addReference(ids, id);
    }
  }

  if (parent && Array.isArray(parent.linked_students)) {
    for (const id of parent.linked_students) addReference(ids, id);
  }

  if (Array.isArray(records.childRecords)) {
    for (const child of records.childRecords) {
      addReference(ids, child.record_id);
      addReference(ids, child._id);
      addReference(ids, child.admission_no);
    }
  }

  return ids;
}
