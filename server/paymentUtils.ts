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

/** A bank transfer must include a stable reference so retries cannot create duplicate payment records. */
export function normalizeDepositReference(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 ? normalized : '';
}

export interface ParentPaymentRetryCandidate {
  fee_id?: unknown;
  student_id?: unknown;
  amount?: unknown;
  method?: unknown;
  parent_user_id?: unknown;
  verification_status?: unknown;
}

/** Only an identical pending submission by the same parent is an idempotent retry. */
export function isExactParentPaymentRetry(
  existing: ParentPaymentRetryCandidate | null | undefined,
  expected: { feeId: string; studentId: string; amount: number; method: string; parentUserId: string }
): boolean {
  return Boolean(
    existing &&
    existing.fee_id === expected.feeId &&
    existing.student_id === expected.studentId &&
    Number(existing.amount) === expected.amount &&
    existing.method === expected.method &&
    existing.parent_user_id === expected.parentUserId &&
    existing.verification_status === 'Pending'
  );
}
