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

/** Builds a fail-closed MongoDB filter for only the current parent's linked student aliases. */
export function buildParentLinkedStudentFilter(linkedStudentIds: ReadonlySet<string>): Record<string, unknown> {
  const ids = Array.from(new Set(Array.from(linkedStudentIds, value => String(value || '').trim()).filter(Boolean)));
  if (ids.length === 0) return { _id: { $in: [] } };
  const objectIdAliases = ids.filter(value => /^[a-fA-F0-9]{24}$/.test(value));
  return {
    $or: [
      { record_id: { $in: ids } },
      { admission_no: { $in: ids } },
      ...(objectIdAliases.length > 0 ? [{ _id: { $in: objectIdAliases } }] : []),
    ],
  };
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

/** Atomic ownership-claim filter: only an unclaimed student or the same parent may be updated. */
export function buildStudentParentClaimFilter(
  studentMongoId: unknown,
  canonicalUserId: string,
  mongoUserId: string
): Record<string, unknown> {
  const ownerIds = Array.from(new Set([canonicalUserId, mongoUserId].map(value => String(value || '').trim()).filter(Boolean)));
  if (!studentMongoId || ownerIds.length === 0) return { _id: null };
  return {
    _id: studentMongoId,
    parent_user_id: { $in: [null, '', ...ownerIds] },
  };
}

/** Atomic unlink filter: clear ownership only if the student is still owned by this parent. */
export function buildStudentParentReleaseFilter(
  studentMongoId: unknown,
  canonicalUserId: string,
  mongoUserId = ''
): Record<string, unknown> {
  const ownerIds = Array.from(new Set([canonicalUserId, mongoUserId].map(value => String(value || '').trim()).filter(Boolean)));
  if (!studentMongoId || ownerIds.length === 0) return { _id: null };
  return { _id: studentMongoId, parent_user_id: { $in: ownerIds } };
}

/** Prevent a parent from taking over a student record already assigned to another parent account. */
export function isStudentClaimedByAnotherParent(
  existingParentUserId: unknown,
  currentParentIdentifiers: readonly string[]
): boolean {
  if (existingParentUserId === null || existingParentUserId === undefined) return false;
  const existing = String(existingParentUserId).trim();
  if (!existing) return false;
  return !currentParentIdentifiers.some(identifier => String(identifier).trim() === existing);
}
