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

  const ownerCandidates: Array<string | null> = [null, ''];
  for (const rawOwner of [canonicalUserId, mongoUserId]) {
    const owner = String(rawOwner ?? '').trim();
    if (owner && !ownerCandidates.includes(owner)) ownerCandidates.push(owner);
  }

  return {
    // Keep the original BSON ObjectId type when callers pass a Mongo document _id.
    _id: studentId,
    parent_user_id: { $in: ownerCandidates },
  };
}
