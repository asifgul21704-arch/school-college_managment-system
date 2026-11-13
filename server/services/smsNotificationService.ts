import { SchoolSettingsModel } from '../models/SchoolSettings.ts';

export interface SmsDispatchResult {
  sent: boolean;
  message: string;
  status: 'Delivered' | 'Failed' | 'Skipped';
  destination_phone?: string;
  timestamp: string;
}

/** The current provider is a simulator; never report a simulated message as delivered. */
export function buildSimulatedSmsResult(
  message: string,
  destinationPhone?: string,
  timestamp = new Date().toISOString()
): SmsDispatchResult {
  return {
    sent: false,
    message,
    status: 'Skipped',
    ...(destinationPhone ? { destination_phone: destinationPhone } : {}),
    timestamp,
  };
}

export const DEFAULT_PAYMENT_SETTINGS = {
  gateways: {
    jazzcash_enabled: true,
    easypaisa_enabled: true,
    raast_enabled: true,
    mode: 'Sandbox' as const,
  },
  bank_accounts: [
    {
      bank_name: 'Askari Bank Limited',
      account_title: 'Shawan School & College Paharpur',
      account_number: '0142100897654',
      iban: 'PK45ASCM0142100897654001',
      branch: 'Paharpur Branch, D.I. Khan (Branch Code: 0142)',
      active: true,
    },
    {
      bank_name: 'The Bank of Khyber',
      account_title: 'Shawan Educational Complex',
      account_number: '0015002008741',
      iban: 'PK12BOKH0015002008741001',
      branch: 'Main Circular Road, Dera Ismail Khan',
      active: true,
    },
  ],
  wallets: [
    {
      provider: 'JazzCash' as const,
      account_title: 'Shawan College Accounts',
      mobile_number: '+92 300 8765432',
      active: true,
    },
    {
      provider: 'Easypaisa' as const,
      account_title: 'Shawan College Paharpur',
      mobile_number: '+92 345 9876543',
      active: true,
    },
    {
      provider: 'Raast' as const,
      account_title: 'Shawan School Raast ID',
      mobile_number: '03008765432',
      active: true,
    },
  ],
  policies: {
    allow_partial: true,
    min_partial_amount: 1000,
    late_fee_amount: 300,
    late_fee_days_grace: 10,
    payment_instructions:
      'Please deposit the fee into our official Askari Bank or Bank of Khyber account. After deposit, upload or submit the deposit slip / transaction ID via this portal. Your receipt will be verified and stamped within 24 business hours.',
  },
  sms: {
    enabled: true,
    provider: 'simulated' as const,
    template_submission:
      'Dear {parent_name}, fee payment of PKR {amount} for {student_name} ({class_name}) with Ref: {ref} has been submitted and is pending verification. - Shawan School & College',
    template_approved:
      'Dear {parent_name}, fee payment of PKR {amount} for {student_name} ({class_name}) has been verified & approved. Receipt No: {receipt_no}, Ref: {ref}. Thank you! - Shawan School & College',
    template_rejected:
      'Dear {parent_name}, your fee payment Ref: {ref} for {student_name} could not be verified. Reason: {reason}. Please contact the school accounts office. - Shawan School & College',
  },
};

export async function getPaymentSettings(): Promise<typeof DEFAULT_PAYMENT_SETTINGS> {
  try {
    const doc = await SchoolSettingsModel.findOne({ singleton_key: 'default' }).lean();
    if (doc && (doc as any).payment_settings) {
      const stored = (doc as any).payment_settings;
      return {
        gateways: {
          ...DEFAULT_PAYMENT_SETTINGS.gateways,
          ...(stored.gateways || {}),
        },
        bank_accounts: Array.isArray(stored.bank_accounts) && stored.bank_accounts.length > 0
          ? stored.bank_accounts
          : DEFAULT_PAYMENT_SETTINGS.bank_accounts,
        wallets: Array.isArray(stored.wallets) && stored.wallets.length > 0
          ? stored.wallets
          : DEFAULT_PAYMENT_SETTINGS.wallets,
        policies: {
          ...DEFAULT_PAYMENT_SETTINGS.policies,
          ...(stored.policies || {}),
        },
        sms: {
          ...DEFAULT_PAYMENT_SETTINGS.sms,
          ...(stored.sms || {}),
        },
      };
    }
  } catch (err) {
    console.warn('[smsNotificationService] Failed to read custom payment settings, using defaults:', err);
  }
  return DEFAULT_PAYMENT_SETTINGS;
}

export async function savePaymentSettings(newSettings: Partial<typeof DEFAULT_PAYMENT_SETTINGS>): Promise<typeof DEFAULT_PAYMENT_SETTINGS> {
  const current = await getPaymentSettings();
  const merged = {
    gateways: { ...current.gateways, ...(newSettings.gateways || {}) },
    bank_accounts: newSettings.bank_accounts || current.bank_accounts,
    wallets: newSettings.wallets || current.wallets,
    policies: { ...current.policies, ...(newSettings.policies || {}) },
    sms: { ...current.sms, ...(newSettings.sms || {}) },
  };

  await SchoolSettingsModel.findOneAndUpdate(
    { singleton_key: 'default' },
    { $set: { payment_settings: merged } },
    { upsert: true, new: true }
  );

  return merged;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, String(val ?? ''));
  }
  return result;
}

export async function sendPaymentSubmissionSms(payment: {
  payment_reference: string;
  amount: number;
  parent_name?: string;
  parent_phone?: string;
  student_name?: string;
  class_name?: string;
}): Promise<SmsDispatchResult> {
  const settings = await getPaymentSettings();
  const timestamp = new Date().toISOString();

  if (!settings.sms.enabled) {
    return {
      sent: false,
      message: 'SMS notifications disabled in school settings',
      status: 'Skipped',
      destination_phone: payment.parent_phone,
      timestamp,
    };
  }

  const parentPhone = payment.parent_phone?.trim() || '';
  if (!parentPhone) {
    return {
      sent: false,
      message: 'Parent phone number not provided',
      status: 'Skipped',
      timestamp,
    };
  }

  const messageText = interpolate(settings.sms.template_submission, {
    parent_name: payment.parent_name || 'Parent/Guardian',
    student_name: payment.student_name || 'Student',
    class_name: payment.class_name || 'Class',
    amount: payment.amount.toLocaleString(),
    ref: payment.payment_reference,
    school_name: 'Shawan School & College',
  });

  // No telecom provider is configured: retain a preview for the audit trail without claiming delivery.
  return buildSimulatedSmsResult(messageText, parentPhone, timestamp);
}

export async function sendPaymentApprovalSms(payment: {
  payment_reference: string;
  receipt_no: string;
  amount: number;
  parent_name?: string;
  parent_phone?: string;
  student_name?: string;
  class_name?: string;
}): Promise<SmsDispatchResult> {
  const settings = await getPaymentSettings();
  const timestamp = new Date().toISOString();

  if (!settings.sms.enabled) {
    return {
      sent: false,
      message: 'SMS notifications disabled in school settings',
      status: 'Skipped',
      destination_phone: payment.parent_phone,
      timestamp,
    };
  }

  const parentPhone = payment.parent_phone?.trim() || '';
  if (!parentPhone) {
    return {
      sent: false,
      message: 'Parent phone number not provided',
      status: 'Skipped',
      timestamp,
    };
  }

  const messageText = interpolate(settings.sms.template_approved, {
    parent_name: payment.parent_name || 'Parent/Guardian',
    student_name: payment.student_name || 'Student',
    class_name: payment.class_name || 'Class',
    amount: payment.amount.toLocaleString(),
    ref: payment.payment_reference,
    receipt_no: payment.receipt_no,
    school_name: 'Shawan School & College',
  });

  // No telecom provider is configured: retain a preview for the audit trail without claiming delivery.
  return buildSimulatedSmsResult(messageText, parentPhone, timestamp);
}

export async function sendPaymentRejectionSms(payment: {
  payment_reference: string;
  amount: number;
  parent_name?: string;
  parent_phone?: string;
  student_name?: string;
  class_name?: string;
}, reason: string): Promise<SmsDispatchResult> {
  const settings = await getPaymentSettings();
  const timestamp = new Date().toISOString();

  if (!settings.sms.enabled) {
    return {
      sent: false,
      message: 'SMS notifications disabled in school settings',
      status: 'Skipped',
      destination_phone: payment.parent_phone,
      timestamp,
    };
  }

  const parentPhone = payment.parent_phone?.trim() || '';
  if (!parentPhone) {
    return {
      sent: false,
      message: 'Parent phone number not provided',
      status: 'Skipped',
      timestamp,
    };
  }

  const messageText = interpolate(settings.sms.template_rejected, {
    parent_name: payment.parent_name || 'Parent/Guardian',
    student_name: payment.student_name || 'Student',
    class_name: payment.class_name || 'Class',
    amount: payment.amount.toLocaleString(),
    ref: payment.payment_reference,
    reason: reason || 'Slip details not matching account statement',
    school_name: 'Shawan School & College',
  });

  // No telecom provider is configured: retain a preview for the audit trail without claiming delivery.
  return buildSimulatedSmsResult(messageText, parentPhone, timestamp);
}
