/**
 * Build a conditional ownership filter for parent-to-student claims.
 * Claims succeed only for unclaimed records or records already owned by this parent.
 */
export function buildStudentParentClaimFilter(
  studentId: unknown,
  canonicalUserId: unknown,
  mongoUserId: unknown
): Record<string, unknown> {
  const cleanStudentId = String(studentId ?? '').trim();
  if (!cleanStudentId) return { _id: null };

  const allowedOwners = Array.from(new Set(
    [null, '', canonicalUserId, mongoUserId]
      .map(value => value === null ? null : String(value ?? '').trim())
      .filter((value): value is string | null => value === null || value !== '')
  ));

  return {
    _id: studentId,
    parent_user_id: { $in: allowedOwners },
  };
}
