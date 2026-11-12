export type ParentPaymentMethodMode = 'gateway_unavailable' | 'manual_verification' | 'unsupported';

export function getParentPaymentMethodMode(method: unknown): ParentPaymentMethodMode {
  const normalized = typeof method === 'string' ? method.trim().toLowerCase() : '';
  if (['online gateway', 'easypaisa / jazzcash', 'jazzcash', 'easypaisa', 'raast'].includes(normalized)) {
    return 'gateway_unavailable';
  }
  if (['bank deposit', 'bank transfer', 'online slip'].includes(normalized)) {
    return 'manual_verification';
  }
  return 'unsupported';
}
