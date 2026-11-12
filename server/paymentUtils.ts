export type ParentPaymentMethodMode = 'gateway_unavailable' | 'manual_verification' | 'unsupported';

export function getParentPaymentMethodMode(method: unknown): ParentPaymentMethodMode {
  const normalized = typeof method === 'string' ? method.trim().toLowerCase() : '';
  if (['online gateway', 'easypaisa / jazzcash', 'jazzcash', 'easypaisa', 'raast'].includes(normalized)) {
    return 'gateway_unavailable';
  }
  if (['bank deposit', 'bank transfer'].includes(normalized)) {
    return 'manual_verification';
  }
  return 'unsupported';
}

export function collectStudentPaymentIdentifiers(student: {
  record_id?: unknown;
  _id?: { toString(): string } | string | null;
  admission_no?: unknown;
} | null | undefined): string[] {
  if (!student) return [];
  const rawObjectId = student._id;
  const objectId = rawObjectId && typeof rawObjectId.toString === 'function'
    ? rawObjectId.toString()
    : '';
  return Array.from(new Set(
    [student.record_id, objectId, student.admission_no]
      .map(value => value === null || value === undefined ? '' : String(value).trim())
      .filter(Boolean)
  ));
}
