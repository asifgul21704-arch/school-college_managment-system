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

/** Checks a requested student's known aliases against current parent account links. */
export function isParentLinkedToStudent(linkedStudentIds: ReadonlySet<string>, studentIdentifiers: unknown[]): boolean {
  return studentIdentifiers.some(identifier => {
    if (identifier === null || identifier === undefined) return false;
    const normalized = String(identifier).trim();
    return normalized.length > 0 && linkedStudentIds.has(normalized);
  });
}

/** Payment history must be scoped only to the parent's currently linked student IDs. */
export function buildParentPaymentHistoryFilter(linkedStudentIds: ReadonlySet<string>): { student_id: { $in: string[] } } {
  return { student_id: { $in: Array.from(linkedStudentIds) } };
}

/** Linking a child requires an exact guardian/father-name match; fuzzy discovery is not proof of ownership. */
export function isExactGuardianNameMatch(studentFatherName: unknown, verifiedGuardianName: unknown): boolean {
  const normalize = (value: unknown) =>
    typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
      : '';
  const father = normalize(studentFatherName);
  const guardian = normalize(verifiedGuardianName);
  return Boolean(father && guardian && father === guardian);
}

/** Checks whether two identifier sets share a known alias for the same student record. */
export function areSameStudentIdentity(leftIdentifiers: unknown[], rightIdentifiers: unknown[]): boolean {
  const normalize = (value: unknown) =>
    value === null || value === undefined ? '' : String(value).trim();
  const left = new Set(leftIdentifiers.map(normalize).filter(Boolean));
  return rightIdentifiers.map(normalize).some(value => Boolean(value) && left.has(value));
}
