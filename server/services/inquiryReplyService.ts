import mongoose from 'mongoose';
import {
  ContactMessageModel,
  ParentModel,
  StudentModel,
  FeeModel,
  NotificationModel,
  AuditLogModel,
  SchoolSettingsModel,
  type IContactMessage,
} from '../models/index.ts';
import { getGeminiClient } from './aiAssistantService.ts';
import {
  openAuthenticatedSmtpTransport,
  isSmtpConfigured,
  SmtpDeliveryError,
} from './passwordResetEmailService.ts';
import { sanitizeErrorMessage } from '../config/db.ts';

export interface ParentVerificationResult {
  verified: boolean;
  parentDoc?: any;
  parentName?: string;
  parentId?: string;
  parentUserId?: string;
  students: any[];
  notes: string;
}

export interface StudentFeeSummary {
  student_id: string;
  admission_no: string;
  roll_no: string;
  student_name: string;
  class_name: string;
  father_name: string;
  fee_month: string;
  year: number;
  tuition_fee: number;
  admission_fee: number;
  other_charges: number;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  due_date: string;
  status: string;
  concession_amount?: number;
}

export interface FamilyFeeAggregate {
  students: StudentFeeSummary[];
  totalTuition: number;
  totalCharges: number;
  totalPayable: number;
  totalPaid: number;
  totalRemainingBalance: number;
  allPaid: boolean;
  dueDate: string;
}

/**
 * 1. Identify the inquiry intent
 */
export function detectInquiryIntent(subject: string, message: string): {
  intent: 'fee_inquiry' | 'admission_inquiry' | 'record_verification' | 'general_inquiry';
  isFeeInquiry: boolean;
} {
  const combined = `${subject || ''} ${message || ''}`.toLowerCase();
  
  const feeRegex = /\b(fee|fees|dues|tuition|challan|voucher|balance|concession|discount|scholarship|payable|pending fee|monthly fee|charges|unpaid)\b/i;
  const admissionRegex = /\b(admission|admissions|apply|eligibility|enrollment|prospectus|form submission|entry test|criteria)\b/i;
  const recordRegex = /\b(verification|verify|certificate|character|leaving|transcript|dmc|result card|marksheet)\b/i;

  if (feeRegex.test(combined)) {
    return { intent: 'fee_inquiry', isFeeInquiry: true };
  }
  if (admissionRegex.test(combined)) {
    return { intent: 'admission_inquiry', isFeeInquiry: false };
  }
  if (recordRegex.test(combined)) {
    return { intent: 'record_verification', isFeeInquiry: false };
  }
  return { intent: 'general_inquiry', isFeeInquiry: false };
}

/**
 * 2. Verify parent using authenticated account identity or existing verified parent-child relationship
 */
export async function verifyInquiryParent(inquiry: any): Promise<ParentVerificationResult> {
  let parentDoc: any = null;

  // Check 1: Direct parent user ID if authenticated
  if (inquiry.parent_user_id) {
    parentDoc = await ParentModel.findOne({
      $or: [
        { user_id: String(inquiry.parent_user_id) },
        { record_id: String(inquiry.parent_user_id) },
      ],
    }).lean();
  }

  // Check 2: Match by exact lowercase registered email
  if (!parentDoc && inquiry.email) {
    const cleanEmail = String(inquiry.email).trim().toLowerCase();
    if (cleanEmail) {
      parentDoc = await ParentModel.findOne({ email: cleanEmail }).lean();
    }
  }

  // Check 3: Match by standardized phone number (if 10+ digits)
  if (!parentDoc && inquiry.phone) {
    const digitsOnly = String(inquiry.phone).replace(/\D/g, '');
    if (digitsOnly.length >= 10) {
      const last10 = digitsOnly.slice(-10);
      parentDoc = await ParentModel.findOne({
        phone: { $regex: last10 },
      }).lean();
    }
  }

  if (!parentDoc) {
    return {
      verified: false,
      students: [],
      notes: 'Sender identity could not be verified against any registered parent/guardian profile in the institutional database.',
    };
  }

  // Retrieve ONLY children linked to that verified parent
  const linkedStudentIds: string[] = Array.isArray(parentDoc.linked_students)
    ? parentDoc.linked_students.map((id: any) => String(id)).filter(Boolean)
    : [];

  if (linkedStudentIds.length === 0) {
    return {
      verified: true,
      parentDoc,
      parentName: parentDoc.name,
      parentId: String(parentDoc.record_id || parentDoc._id),
      parentUserId: parentDoc.user_id,
      students: [],
      notes: 'Parent account verified, but no student records are currently linked to this guardian profile.',
    };
  }

  const students = await StudentModel.find({
    $or: [
      { record_id: { $in: linkedStudentIds } },
      { admission_no: { $in: linkedStudentIds } },
      ...(linkedStudentIds.some(id => mongoose.Types.ObjectId.isValid(id))
        ? [{ _id: { $in: linkedStudentIds.filter(id => mongoose.Types.ObjectId.isValid(id)) } }]
        : []),
    ],
  }).lean();

  return {
    verified: true,
    parentDoc,
    parentName: parentDoc.name,
    parentId: String(parentDoc.record_id || parentDoc._id),
    parentUserId: parentDoc.user_id,
    students,
    notes: `Parent identity verified: ${parentDoc.name} (${students.length} linked student${students.length === 1 ? '' : 's'}).`,
  };
}

/**
 * 3. Fetch the actual current month's fee records from MongoDB for linked students
 */
export async function fetchLinkedStudentsFeeRecords(students: any[]): Promise<FamilyFeeAggregate> {
  const summaries: StudentFeeSummary[] = [];

  let totalTuition = 0;
  let totalCharges = 0;
  let totalPayable = 0;
  let totalPaid = 0;
  let totalRemainingBalance = 0;
  let commonDueDate = '';

  for (const std of students) {
    const stdIdKeys = [
      String(std.record_id || ''),
      String(std.admission_no || ''),
      String(std._id || ''),
    ].filter(Boolean);

    // Retrieve latest fee records for this student from FeeModel
    const feeDoc = await FeeModel.findOne({
      student_id: { $in: stdIdKeys },
    })
      .sort({ year: -1, created_at: -1, _id: -1 })
      .lean();

    if (feeDoc) {
      const tuition = Number(feeDoc.tuition_fee || 0);
      const admission = Number(feeDoc.admission_fee || 0);
      const other = Number(feeDoc.other_charges || 0);
      const total = Number(feeDoc.total_amount || 0);
      const paid = Number(feeDoc.paid_amount || 0);
      const pending = Number(feeDoc.pending_amount || (total - paid));
      const dueDate = String(feeDoc.due_date || '10th of the month');

      totalTuition += tuition;
      totalCharges += other + admission;
      totalPayable += total;
      totalPaid += paid;
      totalRemainingBalance += pending;
      if (!commonDueDate) commonDueDate = dueDate;

      summaries.push({
        student_id: String(std.record_id || std.admission_no || std._id),
        admission_no: std.admission_no || '',
        roll_no: std.roll_no || '',
        student_name: std.full_name || feeDoc.student_name,
        class_name: std.class_name || feeDoc.class_name,
        father_name: std.father_name || '',
        fee_month: feeDoc.fee_month || 'Current Month',
        year: feeDoc.year || new Date().getFullYear(),
        tuition_fee: tuition,
        admission_fee: admission,
        other_charges: other,
        total_amount: total,
        paid_amount: paid,
        pending_amount: pending,
        due_date: dueDate,
        status: feeDoc.status || (pending <= 0 ? 'Paid' : 'Unpaid'),
      });
    } else {
      // No fee record generated yet for this student
      summaries.push({
        student_id: String(std.record_id || std.admission_no || std._id),
        admission_no: std.admission_no || '',
        roll_no: std.roll_no || '',
        student_name: std.full_name,
        class_name: std.class_name,
        father_name: std.father_name || '',
        fee_month: 'Current Session',
        year: new Date().getFullYear(),
        tuition_fee: 0,
        admission_fee: 0,
        other_charges: 0,
        total_amount: 0,
        paid_amount: 0,
        pending_amount: 0,
        due_date: '10th of the month',
        status: 'Paid',
      });
    }
  }

  return {
    students: summaries,
    totalTuition,
    totalCharges,
    totalPayable,
    totalPaid,
    totalRemainingBalance,
    allPaid: totalRemainingBalance <= 0,
    dueDate: commonDueDate || '10th of the month',
  };
}

/**
 * 4. Generate AI Fee & Contact Inquiry Reply
 */
export async function generateAiInquiryReply(
  inquiry: IContactMessage,
  adminUser?: any
): Promise<{
  draftReply: string;
  intent: string;
  isFeeInquiry: boolean;
  parentVerified: boolean;
  verificationNotes: string;
  feeData?: FamilyFeeAggregate;
}> {
  const { intent, isFeeInquiry } = detectInquiryIntent(inquiry.subject, inquiry.message);
  const settings = (await SchoolSettingsModel.findOne().lean()) || {
    school_name: 'Shawan School & College',
    phone: '+92 300 0000000',
    email: 'info@shawanschool.edu.pk',
  };

  let parentVerification: ParentVerificationResult = {
    verified: false,
    students: [],
    notes: 'Inquiry sender verification not yet executed.',
  };

  let feeData: FamilyFeeAggregate | undefined;

  if (isFeeInquiry) {
    parentVerification = await verifyInquiryParent(inquiry);
    if (parentVerification.verified && parentVerification.students.length > 0) {
      feeData = await fetchLinkedStudentsFeeRecords(parentVerification.students);
    }
  }

  // Update inquiry model with intent and verification state
  inquiry.intent = intent;
  inquiry.ai_intent_analysis = {
    is_fee_inquiry: isFeeInquiry,
    parent_verified: parentVerification.verified,
    verification_notes: parentVerification.notes,
    student_count: parentVerification.students.length,
  };
  if (parentVerification.verified) {
    inquiry.verified_parent_id = parentVerification.parentId;
    inquiry.verified_parent_name = parentVerification.parentName;
    inquiry.verified_student_ids = parentVerification.students.map(s => String(s.record_id || s.admission_no || s._id));
  }

  // Try Gemini generation first, fallback to institutional template if not available
  const ai = getGeminiClient();
  let draftReply = '';

  if (ai) {
    try {
      const promptParts: string[] = [
        `You are the Senior Administrative and Accounts Officer at ${settings.school_name}, Paharpur, Dera Ismail Khan, Pakistan.`,
        `A parent/inquirer named "${inquiry.name}" (Email: "${inquiry.email}", Phone: "${inquiry.phone}") submitted an official inquiry:`,
        `Subject: "${inquiry.subject}"`,
        `Message: "${inquiry.message}"`,
        '',
        `Inquiry Type Identified: ${intent}`,
      ];

      if (isFeeInquiry) {
        if (!parentVerification.verified) {
          promptParts.push(
            'PARENT VERIFICATION STATUS: UNVERIFIED.',
            'CRITICAL SECURITY RULE: You must NOT reveal any student or fee financial figures to an unverified sender.',
            'Instruct the sender politely that due to student privacy regulations, official fee statements and challan balances are only accessible to verified parents via the Shawan Parent Portal or in-person at the School Accounts Office with student admission documents.'
          );
        } else if (parentVerification.students.length === 0) {
          promptParts.push(
            `PARENT VERIFICATION STATUS: VERIFIED (${parentVerification.parentName}), but no active student records are linked to this profile.`,
            'Politely explain that their parent account is verified but has zero linked students. Ask them to link their child using Admission Number & DOB in the portal or contact the registrar.'
          );
        } else if (feeData) {
          promptParts.push(
            `PARENT VERIFICATION STATUS: VERIFIED GUARDIAN (${parentVerification.parentName}).`,
            'ACTUAL MONGODB DATABASE FEE RECORDS (Use ONLY these exact numbers, NEVER guess or modify):',
            JSON.stringify(feeData, null, 2),
            '',
            'INSTRUCTIONS FOR RESPONSE:',
            '1. Greet the verified parent respectfully (e.g. "Assalam-o-Alaikum [Parent Name]").',
            '2. Provide a clear, clean itemized breakdown for each child: Student Name, Class, Tuition Fee (PKR), Other Charges (PKR), Total (PKR), Paid (PKR), and Remaining Balance (PKR).',
            '3. State the total family remaining balance due.',
            '4. State the payment due date and note that fee vouchers can be paid via authorized bank deposit, Easypaisa/JazzCash, or on-campus accounts desk.',
            '5. Close with a warm, formal sign-off: "Office of Accounts & Administration, Shawan School and College".'
          );
        }
      } else {
        promptParts.push(
          'Provide a polite, accurate, institutional response to their general inquiry.',
          `School Information: ${settings.school_name}, Paharpur, D.I. Khan. Contact: ${settings.phone}, Email: ${settings.email}.`,
          'Tone: Warm, formal, helpful, professional.'
        );
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: promptParts.join('\n'),
      });

      if (response && response.text) {
        draftReply = response.text.trim();
      }
    } catch (geminiErr: any) {
      console.warn('[AI Inquiry Engine] Gemini generation fallback:', sanitizeErrorMessage(geminiErr?.message || 'Gemini error'));
    }
  }

  // Deterministic institutional fallback if Gemini is unconfigured or failed
  if (!draftReply) {
    if (isFeeInquiry) {
      if (!parentVerification.verified) {
        draftReply = [
          `Assalam-o-Alaikum ${inquiry.name || 'Respected Parent'},`,
          '',
          `Thank you for contacting ${settings.school_name}.`,
          '',
          'In accordance with institutional student privacy policies, specific fee statements, voucher dues, and financial records can only be disclosed to verified parents or guardians.',
          '',
          'To view the exact fee breakdown for your child:',
          '1. Please sign in to the official Shawan Parent Portal using your registered email.',
          '2. If you have not registered yet, you can create a Parent Account and link your child using their Admission Number.',
          '3. Alternatively, you may visit our campus Accounts Counter on Rangpur Road, Paharpur during office hours (Monday – Saturday) with your child\'s admission card.',
          '',
          'We look forward to assisting you.',
          '',
          'Warm regards,',
          'Office of Accounts & Administration',
          settings.school_name,
        ].join('\n');
      } else if (feeData && feeData.students.length > 0) {
        const studentLines = feeData.students
          .map(
            s =>
              `• ${s.student_name} (${s.class_name}, Roll No: ${s.roll_no || 'N/A'}):\n` +
              `  - Tuition Fee: PKR ${s.tuition_fee.toLocaleString()}\n` +
              `  - Other Applicable Charges: PKR ${s.other_charges.toLocaleString()}\n` +
              `  - Total Voucher: PKR ${s.total_amount.toLocaleString()}\n` +
              `  - Amount Paid: PKR ${s.paid_amount.toLocaleString()}\n` +
              `  - Remaining Balance: PKR ${s.pending_amount.toLocaleString()}\n` +
              `  - Due Date: ${s.due_date} [Status: ${s.status}]`
          )
          .join('\n\n');

        draftReply = [
          `Assalam-o-Alaikum ${parentVerification.parentName || inquiry.name},`,
          '',
          `Thank you for contacting the Accounts Office at ${settings.school_name}. Here is the current fee status for your verified linked children:`,
          '',
          studentLines,
          '',
          '--------------------------------------------------',
          `TOTAL OUTSTANDING BALANCE: PKR ${feeData.totalRemainingBalance.toLocaleString()}`,
          `PAYMENT DUE DATE: ${feeData.dueDate}`,
          '--------------------------------------------------',
          '',
          feeData.allPaid
            ? 'All current fee dues for your children are fully settled. Thank you for your timely payment.'
            : 'Please ensure payment is deposited by the due date. Fee vouchers can be deposited at our designated bank counter, via online transfer, or in person at the school accounts counter.',
          '',
          'If you have any questions or require a concession review, please feel free to contact the accounts office.',
          '',
          'Sincerely,',
          'Office of Accounts & Student Records',
          settings.school_name,
        ].join('\n');
      }
    } else {
      draftReply = [
        `Assalam-o-Alaikum ${inquiry.name || 'Respected Visitor'},`,
        '',
        `Thank you for reaching out to ${settings.school_name}, Paharpur.`,
        '',
        `Regarding your inquiry regarding "${inquiry.subject}":`,
        '',
        'Our administrative office has received your message and will be glad to assist you. Admissions for Nursery through Class 12 (Matric, F.Sc Pre-Medical, Pre-Engineering, and ICS) are processed through our admissions office during working hours.',
        '',
        `For immediate inquiries, you may also reach our campus office at ${settings.phone} or visit us at Main Rangpur Road, Paharpur, Dera Ismail Khan.`,
        '',
        'Best regards,',
        'Office of Administration & Admissions',
        settings.school_name,
      ].join('\n');
    }
  }

  // Save the draft on the inquiry
  inquiry.ai_draft_reply = draftReply;
  inquiry.ai_generated_at = new Date();
  inquiry.status = 'Awaiting Admin Approval';
  await inquiry.save();

  if (adminUser) {
    await AuditLogModel.create({
      user_id: adminUser.id,
      user_name: adminUser.name,
      user_role: adminUser.role,
      action: 'Generated AI Reply for Inquiry',
      target_type: 'ContactMessage',
      target_id: inquiry.record_id || String(inquiry._id),
      details: `Generated AI reply draft for inquiry "${inquiry.subject}" (Intent: ${intent}, Verified: ${parentVerification.verified})`,
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  return {
    draftReply,
    intent,
    isFeeInquiry,
    parentVerified: parentVerification.verified,
    verificationNotes: parentVerification.notes,
    feeData,
  };
}

/**
 * 5. Approve & Send Response
 */
export async function dispatchApprovedReply(
  inquiryId: string,
  replyMessage: string,
  adminUser: any,
  sendEmail: boolean = true
): Promise<{ success: boolean; inquiry: any; emailSent: boolean; notificationSent: boolean }> {
  const query = mongoose.Types.ObjectId.isValid(inquiryId)
    ? { $or: [{ _id: inquiryId }, { record_id: inquiryId }] }
    : { record_id: inquiryId };

  const inquiry = await ContactMessageModel.findOne(query);
  if (!inquiry) {
    throw new Error('Inquiry message not found');
  }

  const cleanReply = String(replyMessage || '').trim();
  if (!cleanReply) {
    throw new Error('Reply message cannot be empty');
  }

  const replyId = `rep_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
  let emailSent = false;
  let notificationSent = false;

  // 1. Send in-app notification if parent account is linked
  const targetParentUserId = inquiry.parent_user_id;
  if (targetParentUserId) {
    try {
      await NotificationModel.create({
        user_id: targetParentUserId,
        role: 'parent',
        title: `Reply: ${inquiry.subject || 'School Inquiry'}`,
        message: cleanReply.length > 180 ? `${cleanReply.slice(0, 180)}...` : cleanReply,
        read: false,
        link: '/portal',
      });
      notificationSent = true;
    } catch (notifErr) {
      console.warn('[Inquiry Notification Error]', sanitizeErrorMessage(String(notifErr)));
    }
  }

  // 2. Send email via SMTP if configured and requested
  if (sendEmail && inquiry.email && isSmtpConfigured()) {
    try {
      const transport = await openAuthenticatedSmtpTransport();
      await transport.sendInquiryReplyMail({
        toEmail: inquiry.email,
        recipientName: inquiry.name,
        referenceNo: inquiry.reference_no || 'INQ',
        subject: inquiry.subject,
        replyMessage: cleanReply,
      });
      await transport.close();
      emailSent = true;
    } catch (smtpErr: any) {
      console.warn('[Inquiry Email Error]', sanitizeErrorMessage(smtpErr?.message || 'SMTP delivery failed'));
    }
  }

  // 3. Append to conversation history
  inquiry.replies.push({
    id: replyId,
    sender_type: 'admin',
    sender_id: adminUser.id,
    sender_name: adminUser.name || 'Administration',
    message: cleanReply,
    created_at: new Date(),
    sent_via_email: emailSent,
    sent_via_notification: notificationSent,
    approved_by_id: adminUser.id,
    approved_by_name: adminUser.name,
  });

  inquiry.replied = true;
  inquiry.status = 'Replied';
  inquiry.read = true;
  await inquiry.save();

  // 4. Audit Log
  await AuditLogModel.create({
    user_id: adminUser.id,
    user_name: adminUser.name,
    user_role: adminUser.role,
    action: 'Approved & Sent Inquiry Reply',
    target_type: 'ContactMessage',
    target_id: inquiry.record_id || String(inquiry._id),
    details: `Admin approved reply to inquiry "${inquiry.subject}" (${inquiry.reference_no}). Email sent: ${emailSent}, In-app notification sent: ${notificationSent}`,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  return {
    success: true,
    inquiry,
    emailSent,
    notificationSent,
  };
}
