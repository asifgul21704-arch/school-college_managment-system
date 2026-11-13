import {
  StudentModel,
  TeacherModel,
  ParentModel,
  ClassModel,
  SubjectModel,
  AttendanceModel,
  FeeModel,
  AdmissionModel,
  AuditLogModel,
  NotificationModel,
  ResultModel,
  ExamModel,
  SchoolSettingsModel,
} from '../models/index.ts';

import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import { sanitizeErrorMessage } from '../config/db.ts';

export interface AdminAiQueryContext {
  userId: string;
  userName: string;
  userRole: string;
  ipAddress?: string;
  selectedId?: string;
  activeEntity?: {
    type: 'student' | 'teacher';
    id: string;
    name: string;
    className?: string;
    admissionNo?: string;
    rollNo?: string;
  };
  conversationHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export interface AiResponseResult {
  text: string;
  toolUsed?: string;
  data?: any;
  disambiguationRequired?: boolean;
  candidates?: any[];
  requiresConfirmation?: boolean;
  pendingAction?: {
    actionType: string;
    title: string;
    description: string;
    payload: any;
    recipientCount?: number;
    previewText?: string;
  };
  auditLogId?: string;
  activeEntity?: {
    type: 'student' | 'teacher';
    id: string;
    name: string;
    className?: string;
    admissionNo?: string;
    rollNo?: string;
  };
  aiProviderStatus?: {
    configured: boolean;
    verified: boolean;
    available?: boolean;
    errorCode?: string;
    provider: string;
    model?: string;
    message?: string;
  };
  error?: string;
}

/**
 * Returns "Not available in database." for any empty, null, undefined, or missing database field.
 * Strict Rule 7: Never guess or use arbitrary defaults for missing database values.
 */
export function valOrNa(value: any): string {
  if (value === null || value === undefined) return 'Not available in database.';
  const str = String(value).trim();
  if (
    !str ||
    str.toLowerCase() === 'n/a' ||
    str.toLowerCase() === 'undefined' ||
    str.toLowerCase() === 'null' ||
    str.toLowerCase() === 'none'
  ) {
    return 'Not available in database.';
  }
  return str;
}

/**
 * Tracks verified Gemini API connectivity status.
 * Never claim that an AI model is connected unless verified.
 */
let geminiVerified = false;
let geminiVerificationAttempted = false;
let geminiVerificationError = '';
let geminiErrorCode = '';

export interface ClassifiedGeminiError {
  retryable: boolean;
  code:
    | 'NOT_CONFIGURED'
    | 'PROVIDER_UNAVAILABLE'
    | 'RATE_LIMITED'
    | 'PROVIDER_TIMEOUT'
    | 'AUTH_ERROR'
    | 'REQUEST_REJECTED';
  userMessage: string;
}

export function classifyGeminiProviderError(err: any): ClassifiedGeminiError {
  const status = Number(err?.status || err?.code || 0);
  const rawMsg = sanitizeErrorMessage(String(err?.message || 'Upstream AI provider error'));
  const upper = rawMsg.toUpperCase();

  if (
    status === 401 ||
    status === 403 ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('UNAUTHENTICATED')
  ) {
    return {
      retryable: false,
      code: 'AUTH_ERROR',
      userMessage:
        'Google Gemini API key was rejected by the upstream provider. Verify GEMINI_API_KEY configuration on the server.',
    };
  }

  if (status === 429 || upper.includes('429') || upper.includes('RESOURCE_EXHAUSTED') || upper.includes('QUOTA')) {
    return {
      retryable: true,
      code: 'RATE_LIMITED',
      userMessage:
        'Google Gemini AI provider rate limit or quota was reached (HTTP 429). Deterministic MongoDB school tools remain fully operational.',
    };
  }

  if (
    upper.includes('TIMED OUT') ||
    upper.includes('TIMEOUT') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('ECONNRESET') ||
    upper.includes('FETCH FAILED')
  ) {
    return {
      retryable: true,
      code: 'PROVIDER_TIMEOUT',
      userMessage:
        'Google Gemini AI provider timed out while responding. Deterministic MongoDB school tools remain fully operational.',
    };
  }

  if (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED')
  ) {
    return {
      retryable: true,
      code: 'PROVIDER_UNAVAILABLE',
      userMessage:
        'Google Gemini AI provider is temporarily unavailable due to high upstream demand (HTTP 503). Deterministic MongoDB school tools remain fully operational.',
    };
  }

  return {
    retryable: false,
    code: 'REQUEST_REJECTED',
    userMessage:
      'Google Gemini AI provider could not complete the generative request. Deterministic MongoDB school tools remain fully operational.',
  };
}

/**
 * Returns Google GenAI SDK instance when GEMINI_API_KEY is configured on the server.
 */
export function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (key && key.trim().length > 0 && !key.includes('your_') && !key.includes('placeholder')) {
    try {
      return new GoogleGenAI({
        apiKey: key.trim(),
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    } catch (e: any) {
      console.warn('[Gemini Init Error]', sanitizeErrorMessage(e?.message || 'SDK initialization error'));
    }
  }
  return null;
}

/**
 * Executes a bounded Gemini generateContent request with strict per-attempt timeout
 * and bounded retries ONLY on transient upstream errors (429 / 503 / timeout).
 */
export async function callGeminiBounded(
  contents: string,
  options?: { maxAttempts?: number; timeoutMs?: number }
): Promise<{ ok: true; text: string } | { ok: false; code: string; message: string }> {
  const client = getGeminiClient();
  if (!client) {
    geminiVerified = false;
    geminiVerificationAttempted = true;
    geminiErrorCode = 'NOT_CONFIGURED';
    geminiVerificationError = 'GEMINI_API_KEY is not configured in server environment.';
    return { ok: false, code: geminiErrorCode, message: geminiVerificationError };
  }

  const maxAttempts = Math.min(3, Math.max(1, options?.maxAttempts ?? 2));
  const timeoutMs = Math.min(15000, Math.max(1000, options?.timeoutMs ?? 8000));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Gemini provider request timed out')), timeoutMs);
        timer.unref?.();
      });
      const res = await Promise.race([
        client.models.generateContent({
          model: 'gemini-3.8-flash',
          contents,
        }),
        timeoutPromise,
      ]);
      if (timer) clearTimeout(timer);

      if (res && typeof res.text === 'string' && res.text.trim().length > 0) {
        geminiVerified = true;
        geminiVerificationAttempted = true;
        geminiVerificationError = '';
        geminiErrorCode = '';
        return { ok: true, text: res.text.trim() };
      }

      geminiVerified = false;
      geminiVerificationAttempted = true;
      geminiErrorCode = 'REQUEST_REJECTED';
      geminiVerificationError =
        'Google Gemini AI provider returned an empty response. Deterministic MongoDB school tools remain operational.';
      return { ok: false, code: geminiErrorCode, message: geminiVerificationError };
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      const classified = classifyGeminiProviderError(err);
      if (classified.retryable && attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 700 * attempt));
        continue;
      }
      geminiVerified = false;
      geminiVerificationAttempted = true;
      geminiErrorCode = classified.code;
      geminiVerificationError = classified.userMessage;
      console.warn(`[Gemini Provider Notice] (${classified.code}) ${classified.userMessage}`);
      return { ok: false, code: classified.code, message: classified.userMessage };
    }
  }

  return {
    ok: false,
    code: geminiErrorCode || 'PROVIDER_UNAVAILABLE',
    message: geminiVerificationError || 'Google Gemini AI provider is currently unavailable.',
  };
}

/**
 * Verifies live Google Gemini connectivity asynchronously with bounded retry.
 */
export async function testGeminiConnection(): Promise<{ verified: boolean; code?: string; message: string }> {
  const result = await callGeminiBounded('ping', { maxAttempts: 2, timeoutMs: 8000 });
  if (result.ok) {
    return { verified: true, message: 'Gemini 3.8 Flash model verified and active.' };
  }
  return { verified: false, code: result.code, message: result.message };
}

export function getAiProviderStatus() {
  const key = process.env.GEMINI_API_KEY;
  const isConfigured = Boolean(
    key && key.trim().length > 0 && !key.includes('your_') && !key.includes('placeholder')
  );

  if (!isConfigured) {
    return {
      configured: false,
      verified: false,
      available: false,
      errorCode: 'NOT_CONFIGURED',
      provider: 'Google Gemini',
      model: 'gemini-3.8-flash',
      message: 'GEMINI_API_KEY is not configured. Server operates through deterministic MongoDB school tools.',
    };
  }

  if (geminiVerificationError) {
    return {
      configured: true,
      verified: false,
      available: false,
      errorCode: geminiErrorCode || 'PROVIDER_UNAVAILABLE',
      provider: 'Google Gemini',
      model: 'gemini-3.8-flash',
      message: geminiVerificationError,
    };
  }

  return {
    configured: true,
    verified: geminiVerified,
    available: geminiVerified,
    ...(geminiVerificationAttempted && !geminiVerified ? { errorCode: 'PROVIDER_UNAVAILABLE' } : {}),
    provider: 'Google Gemini',
    model: 'gemini-3.8-flash',
    message: geminiVerified
      ? 'Live Google Gemini model integration active and verified.'
      : 'GEMINI_API_KEY configured. Operating via deterministic MongoDB school tools engine.',
  };
}

/**
 * Escapes user/database text so it is safe to use inside a RegExp.
 */
function escapeRegex(value: string): string {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeRegex(value: string, flags = 'i'): RegExp {
  return new RegExp(escapeRegex(value), flags);
}

/**
 * Audit Logger Helper: Persists all AI queries and actions to MongoDB Atlas AuditLog collection
 */
async function recordAuditLog(
  context: AdminAiQueryContext,
  action: string,
  targetType: string,
  details: string,
  targetId?: string
) {
  try {
    const log = await AuditLogModel.create({
      user_id: context.userId || 'admin',
      user_name: context.userName || 'Administrator',
      user_role: context.userRole || 'admin',
      action,
      target_type: targetType,
      target_id: targetId || '',
      details,
      timestamp: new Date().toISOString(),
    });
    return log._id.toString();
  } catch (err: any) {
    console.error('[AuditLog Error]', err.message);
    return undefined;
  }
}

/**
 * Natural Date Range Parser (Pakistan Standard Time UTC+5)
 * Strict Rule 5: Distinguishes explicit requested periods from unconstrained queries.
 * If the requested period has no records, says no records were found for that period.
 */
export function parseNaturalDateRange(text: string): {
  label: string;
  dateStr?: string;
  startDate?: Date;
  endDate?: Date;
  hasExplicitRange: boolean;
} {
  const p = (text || '').toLowerCase();
  const now = new Date();
  const toDateStr = (d: Date) => d.toISOString().split('T')[0];

  if (p.includes('yesterday')) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
    const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
    return {
      label: 'Yesterday',
      dateStr: toDateStr(yesterday),
      startDate: startOfYesterday,
      endDate: endOfYesterday,
      hasExplicitRange: true,
    };
  }

  if (p.includes('today')) {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    return {
      label: 'Today',
      dateStr: toDateStr(now),
      startDate: startOfToday,
      endDate: now,
      hasExplicitRange: true,
    };
  }

  if (p.includes('this week')) {
    const dayOfWeek = now.getDay() || 7; // 1 = Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek + 1);
    monday.setHours(0, 0, 0, 0);
    return {
      label: 'This Week',
      startDate: monday,
      endDate: now,
      hasExplicitRange: true,
    };
  }

  if (p.includes('last month')) {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const prevMonthName = monthNames[startOfLastMonth.getMonth()];
    return {
      label: `Last Month (${prevMonthName} ${startOfLastMonth.getFullYear()})`,
      startDate: startOfLastMonth,
      endDate: endOfLastMonth,
      hasExplicitRange: true,
    };
  }

  if (p.includes('this month') || p.includes('current month')) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const curMonthName = monthNames[now.getMonth()];
    return {
      label: `This Month (${curMonthName} ${now.getFullYear()})`,
      startDate: startOfMonth,
      endDate: now,
      hasExplicitRange: true,
    };
  }

  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  for (let m = 0; m < months.length; m++) {
    if (p.includes(months[m])) {
      const yearMatch = p.match(/\b(20\d\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : now.getFullYear();
      const startOfMonth = new Date(year, m, 1, 0, 0, 0);
      const endOfMonth = new Date(year, m + 1, 0, 23, 59, 59, 999);
      const monthCapitalized = months[m].charAt(0).toUpperCase() + months[m].slice(1);
      return {
        label: `${monthCapitalized} ${year}`,
        startDate: startOfMonth,
        endDate: endOfMonth,
        hasExplicitRange: true,
      };
    }
  }

  if (p.includes('academic year') || p.includes('this year')) {
    const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    return {
      label: `Academic Year ${now.getFullYear()}`,
      startDate: startOfYear,
      endDate: now,
      hasExplicitRange: true,
    };
  }

  // Unconstrained / general recent query
  return {
    label: 'All Recent',
    startDate: undefined,
    endDate: undefined,
    hasExplicitRange: false,
  };
}

/**
 * Robust Natural Language Student Name Extractor
 * Cleans command verbs, possessives, and noise words.
 * Returns empty string if the prompt refers to "this student", "the student", etc.
 */
export function extractStudentTargetName(prompt: string): string {
  let cleaned = (prompt || '')
    .replace(
      /^(?:can you\s+)?(?:please\s+)?(?:give\s+me|show\s+me|show|display|view|check|get|find|tell\s+me|fetch|lookup|search\s+for|what\s+is|what\s+are)\s+/i,
      ''
    )
    .replace(
      /(?:'s|s)?\s+(?:parents?|parent\s+details|father|mother|guardian)(?:\s+(?:and|with)\s+(?:their|his|her)?\s*(?:contact\s+information|contact\s+info|contact\s+details|phone|mobile|details|information|info))?/gi,
      ''
    )
    .replace(
      /(?:'s|s)?\s+(?:complete\s+student\s+profile|complete\s+profile|complete\s+record|student\s+profile|profile|record|dossier|file)/gi,
      ''
    )
    .replace(
      /(?:'s|s)?\s+(?:attendance\s+and\s+fee\s+status|attendance\s+and\s+fees|attendance,\s*fees,\s*results\s+and\s+parents|attendance\s+status|fee\s+status|attendance|fees|fee|results|contact\s+information|contact\s+info|contact\s+details)/gi,
      ''
    )
    .replace(
      /(?:complete\s+record\s+of|complete\s+profile\s+of|profile\s+of|record\s+of|details\s+of|information\s+about|info\s+about|parents\s+of|parent\s+details\s+for|attendance\s+and\s+fee\s+status\s+for|attendance\s+for|fees\s+for|fee\s+status\s+for)\s+/gi,
      ''
    )
    .replace(
      /\b(?:together|all\s+together|both|and\s+their|and\s+his|and\s+her|contact\s+information|contact\s+info|contact|details|information|info)\b/gi,
      ''
    )
    .replace(/\b(?:this\s+student|this\s+child|this\s+learner|the\s+student|student|pupil|learner)\b/gi, '')
    .replace(/\b(?:for|about|of)\b/gi, '')
    .replace(/[.?!\s]+$/, '')
    .trim();

  cleaned = cleaned.replace(/["'’\s]+$/g, '').replace(/^["'’\s]+/g, '').trim();
  cleaned = cleaned.replace(/['’]s$/i, '').trim();

  // If the query was just referring to an entity relatively or had no specific name:
  if (
    !cleaned ||
    /^(?:this|the|him|her|his|their|student|child|profile|record|dossier|parent|parents|details|attendance|fee|fees|status)$/i.test(
      cleaned
    )
  ) {
    return '';
  }
  return cleaned;
}

/**
 * Robust Natural Language Teacher Name Extractor
 * Returns empty string if the prompt is general or refers to "this teacher".
 */
export function extractTeacherTargetName(prompt: string): string {
  let cleaned = (prompt || '')
    .replace(
      /^(?:can you\s+)?(?:please\s+)?(?:give\s+me|show\s+me|show|display|view|check|get|find|tell\s+me|fetch|lookup|search\s+for)\s+/i,
      ''
    )
    .replace(
      /(?:complete\s+information\s+about|complete\s+record\s+of|complete\s+profile\s+of|record\s+of|profile\s+of|details\s+of|information\s+about|assigned\s+subjects\s+for|subjects\s+of|assigned\s+classes\s+for|assigned\s+classes\s+of)\s+/gi,
      ''
    )
    .replace(
      /(?:'s|s)?\s+(?:complete\s+record|complete\s+profile|record|profile|dossier|assigned\s+subjects|assigned\s+classes|details\s+and\s+assigned\s+classes|teacher\s+details\s+and\s+assigned\s+classes|details|subjects|classes)/gi,
      ''
    )
    .replace(/\b(?:teacher|faculty|professor|prof|instructor|sir|mr|mrs|miss|ma['’]am)\b\.?/gi, '')
    .replace(/\b(?:for|about|of)\b/gi, '')
    .replace(/[.?!\s]+$/, '')
    .trim();

  cleaned = cleaned.replace(/["'’\s]+$/g, '').replace(/^["'’\s]+/g, '').trim();
  cleaned = cleaned.replace(/['’]s$/i, '').trim();

  if (
    !cleaned ||
    /^(?:this|the|him|her|his|their|teacher|faculty|details|assigned|classes|subjects|all)$/i.test(cleaned)
  ) {
    return '';
  }
  return cleaned;
}

// ==========================================
// CONTROLLED MONGOOSE BACKEND TOOLS
// ==========================================

export const ControlledSchoolTools = {
  /**
   * 1. Teacher Complete Record with Workload & Subject Specialization
   * Supports lookup by database ID (_id, id, user_id) or name.
   */
  async getTeacherRecord(nameOrQueryOrId: string, context?: AdminAiQueryContext) {
    const rawClean = (nameOrQueryOrId || '').replace(/[.?!\s]+$/, '').trim();
    const effectiveTarget =
      rawClean ||
      (context?.activeEntity?.type === 'teacher' ? context.activeEntity.id || context.activeEntity.name : '') ||
      context?.selectedId ||
      '';

    if (!effectiveTarget) {
      return { found: false, message: 'Please specify the name or database ID of the teacher.' };
    }

    // 1. Direct search by database ID if looks like ID
    let teachers: any[] = [];
    if (/^(tch_|usr_|[0-9a-fA-F]{24})/i.test(effectiveTarget)) {
      teachers = await TeacherModel.find({
        $or: [
          mongoose.isValidObjectId(effectiveTarget) ? { _id: effectiveTarget } : null,
          { record_id: effectiveTarget },
          { id: effectiveTarget },
          { user_id: effectiveTarget },
          { email: safeRegex(effectiveTarget, 'i') },
        ].filter(Boolean) as any,
      }).lean();
    }

    // 2. Search by name/subject
    if (teachers.length === 0) {
      const unprefix =
        extractTeacherTargetName(effectiveTarget) ||
        effectiveTarget.replace(/^(sir|prof|professor|mr|mrs|miss|ma['’]am)\.?\s+/i, '').trim();
      const regex = safeRegex(unprefix, 'i');
      teachers = await TeacherModel.find({
        $or: [{ name: regex }, { subject: regex }],
      }).lean();

      if (teachers.length === 0) {
        const parts = unprefix
          .split(/\s+/)
          .filter(p => p.length > 2 && !/^(?:sir|mr|mrs|miss|dr|prof)$/i.test(p));
        if (parts.length > 0) {
          teachers = await TeacherModel.find({
            $or: parts.map(p => ({ name: safeRegex(p, 'i') })),
          }).lean();
        }
      }
    }

    if (teachers.length === 0) {
      const allTeachers = await TeacherModel.find({ status: 'Active' }).select('name subject').lean();
      const list = allTeachers.map(t => `${t.name} (${t.subject})`).join(', ');
      return {
        found: false,
        message: `No matching record was found in the school database for teacher "${effectiveTarget}". Active faculty on record: ${list}`,
      };
    }

    if (teachers.length > 1) {
      return {
        found: true,
        disambiguationRequired: true,
        candidates: teachers.map(t => ({
          id: sId(t),
          databaseId: sId(t),
          name: t.name,
          subject: t.subject,
          qualification: valOrNa(t.qualification),
          classes: t.classes || [],
          email: t.email,
        })),
        message: `Found ${teachers.length} faculty members matching "${effectiveTarget}". Please select which teacher's record you want to inspect:`,
      };
    }

    const teacher = teachers[0];
    const subjects = await SubjectModel.find({ teacher_name: safeRegex(teacher.name, 'i') }).lean();
    const totalWeeklyPeriods = subjects.reduce((sum, s) => sum + (s.weekly_periods || 0), 0);
    const teacherIdStr = sId(teacher);

    return {
      found: true,
      teacher: {
        id: teacherIdStr,
        database_id: teacherIdStr,
        name: teacher.name,
        employee_id: valOrNa(teacher.user_id),
        email: valOrNa(teacher.email),
        phone: valOrNa(teacher.contact_no),
        subject: teacher.subject,
        qualification: valOrNa(teacher.qualification),
        experience: valOrNa(teacher.experience),
        classes: teacher.classes?.length ? teacher.classes : ['Not available in database.'],
        assigned_subjects: subjects.map(s => ({
          name: s.name,
          class: s.class_name,
          code: valOrNa(s.code),
          weekly_periods: s.weekly_periods || 0,
        })),
        workload_periods_per_week: totalWeeklyPeriods || 'Not available in database.',
        joining_date: valOrNa(teacher.joining_date),
        status: teacher.status || 'Active',
        bio: valOrNa(teacher.bio),
      },
    };
  },

  /**
   * 1b. Faculty Directory Listing with Assigned Classes
   * Used when admin asks generally: "Show teacher details and assigned classes."
   */
  async getFacultyDirectoryWithClasses() {
    const teachers = await TeacherModel.find({ status: 'Active' }).sort({ name: 1 }).lean();
    const allSubjects = await SubjectModel.find().lean();

    const facultyList = teachers.map(t => {
      const assignedSubs = allSubjects.filter(
        s => s.teacher_name && s.teacher_name.toLowerCase() === t.name.toLowerCase()
      );
      const totalWeekly = assignedSubs.reduce((sum, s) => sum + (s.weekly_periods || 0), 0);
      return {
        id: sId(t),
        name: t.name,
        subject: t.subject,
        qualification: valOrNa(t.qualification),
        contact_no: valOrNa(t.contact_no),
        email: valOrNa(t.email),
        classes: t.classes?.length ? t.classes : ['Not available in database.'],
        assignedSubjectsCount: assignedSubs.length,
        workloadPeriods: totalWeekly || 'Not available in database.',
      };
    });

    return {
      count: facultyList.length,
      teachers: facultyList,
    };
  },

  /**
   * 2. Student Complete Profile (Identity, Academic, Attendance, Financials, Results, Parent)
   * Resolves by database ID, admission_no, roll_no, or natural name.
   */
  async getStudentProfile(query: string, context?: AdminAiQueryContext) {
    let clean = (query || '').replace(/[.?!\s]+$/, '').trim();

    // 1. If prompt refers to "this student", prioritize context.activeEntity or context.selectedId
    if (
      (!clean || /^(?:this|the|him|her|his|their|this student|the student|student|record|profile)$/i.test(clean)) &&
      (context?.activeEntity?.type === 'student' || context?.selectedId)
    ) {
      clean = context?.selectedId || context?.activeEntity?.id || context?.activeEntity?.name || '';
    }

    const extracted = extractStudentTargetName(clean);
    if (extracted && extracted.length >= 2) {
      clean = extracted;
    }

    if (!clean) {
      if (context?.activeEntity?.type === 'student') {
        clean = context.activeEntity.id || context.activeEntity.name;
      } else {
        return {
          found: false,
          message: 'Please specify the student name, admission number, or roll number.',
        };
      }
    }

    let students: any[] = [];

    // Check direct database ID / admission / roll number first
    if (/^(std_|[0-9a-fA-F]{24}$|SSC-|ADM-|\d+$)/i.test(clean)) {
      students = await StudentModel.find({
        $or: [
          mongoose.isValidObjectId(clean) ? { _id: clean } : null,
          { record_id: clean },
          { id: clean },
          { user_id: clean },
          { admission_no: clean },
          { roll_no: clean },
        ].filter(Boolean) as any,
      }).lean();
    }

    // Search by name
    if (students.length === 0) {
      const regex = safeRegex(clean, 'i');
      students = await StudentModel.find({
        $or: [{ full_name: regex }, { roll_no: clean }, { admission_no: regex }],
      }).lean();

      if (students.length === 0) {
        const parts = clean
          .split(/\s+/)
          .filter(p => p.length > 2 && !/^(?:show|tell|check|profile|record|student|this)$/i.test(p));
        if (parts.length > 0) {
          students = await StudentModel.find({
            $or: parts.map(p => ({ full_name: safeRegex(p, 'i') })),
          }).lean();
        }
      }
    }

    if (students.length === 0) {
      return {
        found: false,
        message: `No matching record was found in the school database for query "${clean}".`,
      };
    }

    if (students.length > 1) {
      return {
        found: true,
        disambiguationRequired: true,
        candidates: students.map(s => {
          const sid = sId(s);
          return {
            id: sid,
            databaseId: sid,
            name: s.full_name,
            father_name: valOrNa(s.father_name),
            class_name: s.class_name,
            roll_no: s.roll_no,
            admission_no: s.admission_no,
          };
        }),
        message: `Found ${students.length} students matching "${clean}". Please select the exact student:`,
      };
    }

    const student = students[0];
    const studentIdStr = sId(student);

    // 1. Attendance stats (matched by student_id or name)
    const attendances = await AttendanceModel.find({
      $or: [
        { student_id: studentIdStr },
        { student_id: (student as any).id },
        { student_id: student._id.toString() },
        { student_name: safeRegex(student.full_name, 'i') },
      ].filter(Boolean) as any,
    })
      .sort({ date: -1 })
      .lean();

    const totalMarked = attendances.length;
    const presentCount = attendances.filter(a => a.status === 'Present').length;
    const absentCount = attendances.filter(a => a.status === 'Absent').length;
    const leaveCount = attendances.filter(a => a.status === 'Leave' || a.status === 'Late').length;
    const attendancePercentage = totalMarked > 0 ? Math.round((presentCount / totalMarked) * 100) : 100;
    const recentAbsents = attendances
      .filter(a => a.status === 'Absent')
      .slice(0, 5)
      .map(a => a.date);

    // 2. Fee stats (matched by student_id or name)
    const fees = await FeeModel.find({
      $or: [
        { student_id: studentIdStr },
        { student_id: (student as any).id },
        { student_id: student._id.toString() },
        { student_name: safeRegex(student.full_name, 'i') },
      ].filter(Boolean) as any,
    }).lean();

    const totalFeeAmount = fees.reduce((acc, f) => acc + (f.total_amount || 0), 0);
    const totalPaidAmount = fees.reduce((acc, f) => acc + (f.paid_amount || 0), 0);
    const pendingFeeAmount = fees.reduce((acc, f) => acc + (f.pending_amount || 0), 0);
    const unpaidRecords = fees.filter(f => f.status !== 'Paid');

    // 3. Parent details (linked by student ID, admission number, name, or phone)
    const parent = await ParentModel.findOne({
      $or: [
        { linked_students: studentIdStr },
        { linked_students: (student as any).id },
        { linked_students: student.admission_no },
        { name: safeRegex(student.father_name || '', 'i') },
        { phone: student.contact_no },
      ].filter(Boolean) as any,
    }).lean();

    // 4. Subjects & Exam Results
    const subjects = await SubjectModel.find({ class_name: safeRegex(student.class_name, 'i') }).lean();
    const results = await ResultModel.find({
      $or: [
        { student_id: studentIdStr },
        { student_id: (student as any).id },
        { student_id: student._id.toString() },
        { student_name: safeRegex(student.full_name, 'i') },
      ].filter(Boolean) as any,
    }).lean();

    return {
      found: true,
      profile: {
        id: studentIdStr,
        database_id: studentIdStr,
        admission_no: student.admission_no,
        roll_no: student.roll_no,
        full_name: student.full_name,
        father_name: valOrNa(student.father_name),
        dob: valOrNa(student.dob),
        gender: valOrNa(student.gender),
        class_name: student.class_name,
        section: student.section || 'A',
        contact_no: valOrNa(student.contact_no),
        emergency_contact: valOrNa(student.emergency_contact),
        address: valOrNa(student.address),
        admission_date: valOrNa(student.admission_date),
        academic_status: student.academic_status || 'Active',
        assigned_subjects: subjects.map(s => s.name),
        results: results.map(r => ({
          examTitle: r.exam_title,
          totalMarks: r.total_marks,
          obtainedMarks: r.obtained_marks,
          percentage: r.percentage,
          grade: r.overall_grade,
          remarks: valOrNa(r.remarks),
          subjects: r.subjects || [],
        })),
        attendance: {
          totalDays: totalMarked,
          presents: presentCount,
          absents: absentCount,
          leaves: leaveCount,
          percentage: attendancePercentage,
          statusLabel: attendancePercentage >= 75 ? 'Satisfactory' : 'Critical (Below 75%)',
          recentAbsentDates: recentAbsents,
        },
        fees: {
          totalBilled: totalFeeAmount,
          totalPaid: totalPaidAmount,
          pendingDue: pendingFeeAmount,
          status: pendingFeeAmount > 0 ? 'Dues Outstanding' : 'Fully Paid',
          unpaidCount: unpaidRecords.length,
          recentVouchers: unpaidRecords.map(u => ({
            month: u.fee_month,
            year: u.year,
            amount: u.pending_amount || u.total_amount,
            dueDate: valOrNa(u.due_date),
          })),
        },
        parent: parent
          ? {
              name: parent.name,
              father_name: valOrNa(parent.father_name || student.father_name),
              phone: valOrNa(parent.phone),
              email: valOrNa(parent.email),
              address: valOrNa(parent.address || student.address),
              occupation: valOrNa(parent.occupation),
            }
          : {
              name: valOrNa(student.father_name),
              father_name: valOrNa(student.father_name),
              phone: valOrNa(student.contact_no || student.emergency_contact),
              email: 'Not available in database.',
              address: valOrNa(student.address),
              occupation: 'Not available in database.',
            },
      },
    };
  },

  /**
   * 3. Specific Student Attendance
   */
  async getStudentAttendance(query: string, context?: AdminAiQueryContext) {
    const profileRes: any = await ControlledSchoolTools.getStudentProfile(query, context);
    if (!profileRes.found || profileRes.disambiguationRequired || !profileRes.profile) {
      return profileRes;
    }
    const p = profileRes.profile;
    return {
      found: true,
      studentId: p.id,
      studentName: p.full_name,
      className: p.class_name,
      rollNo: p.roll_no,
      attendance: p.attendance,
    };
  },

  /**
   * 4. Specific Student Fee Status
   */
  async getStudentFeeStatus(query: string, context?: AdminAiQueryContext) {
    const profileRes: any = await ControlledSchoolTools.getStudentProfile(query, context);
    if (!profileRes.found || profileRes.disambiguationRequired || !profileRes.profile) {
      return profileRes;
    }
    const p = profileRes.profile;
    return {
      found: true,
      studentId: p.id,
      studentName: p.full_name,
      className: p.class_name,
      rollNo: p.roll_no,
      fatherName: p.father_name,
      fees: p.fees,
      parentContact: p.parent?.phone || p.contact_no,
    };
  },

  /**
   * 4b. Combined Student Attendance and Fee Status (Objective 3)
   */
  async getStudentAttendanceAndFees(query: string, context?: AdminAiQueryContext) {
    const profileRes: any = await ControlledSchoolTools.getStudentProfile(query, context);
    if (!profileRes.found || profileRes.disambiguationRequired || !profileRes.profile) {
      return profileRes;
    }
    const p = profileRes.profile;
    return {
      found: true,
      studentId: p.id,
      studentName: p.full_name,
      className: p.class_name,
      rollNo: p.roll_no,
      fatherName: p.father_name,
      parentContact: p.parent?.phone || p.contact_no,
      attendance: p.attendance,
      fees: p.fees,
    };
  },

  /**
   * 5. Low Attendance Students (< threshold, default 75%, optional targetClass)
   */
  async getLowAttendanceStudents(threshold = 75, targetClass?: string) {
    const filter: any = { academic_status: 'Active' };
    if (targetClass) {
      const numMatch = targetClass.match(/\b(\d+)\b/);
      if (numMatch) {
        filter.class_name = safeRegex(numMatch[1], 'i');
      } else {
        filter.class_name = safeRegex(targetClass.replace(/class/i, '').trim(), 'i');
      }
    }
    const allStudents = await StudentModel.find(filter).lean();
    const resultList: any[] = [];

    for (const student of allStudents) {
      const studentIdStr = sId(student);
      const records = await AttendanceModel.find({
        $or: [
          { student_id: studentIdStr },
          { student_id: (student as any).id },
          { student_id: student._id.toString() },
          { student_name: safeRegex(student.full_name, 'i') },
        ].filter(Boolean) as any,
      }).lean();

      const total = records.length;
      if (total === 0) continue;

      const presents = records.filter(r => r.status === 'Present').length;
      const absents = records.filter(r => r.status === 'Absent').length;
      const pct = Math.round((presents / total) * 100);

      if (pct < threshold) {
        resultList.push({
          id: studentIdStr,
          name: student.full_name,
          father_name: valOrNa(student.father_name),
          class_name: student.class_name,
          roll_no: student.roll_no,
          phone: valOrNa(student.contact_no),
          percentage: pct,
          total_days: total,
          presents,
          absents,
        });
      }
    }

    resultList.sort((a, b) => a.percentage - b.percentage);

    return {
      threshold,
      targetClass: targetClass || undefined,
      count: resultList.length,
      students: resultList,
    };
  },

  /**
   * 6. Teachers Assigned to Class
   */
  async getTeachersByClass(className: string) {
    const cleanClass = (className || '').replace(/[.?!\s]+$/, '').trim();
    const numMatch = cleanClass.match(/\b(\d+)\b/);
    const regex = numMatch
      ? new RegExp(`(class|grade)?\\s*${numMatch[1]}`, 'i')
      : safeRegex(cleanClass, 'i');

    const teachers = await TeacherModel.find({
      $or: [
        { classes: regex },
        { classes: { $elemMatch: { $regex: regex } } },
        { classes: safeRegex(cleanClass, 'i') },
      ],
      status: 'Active',
    }).lean();

    const subjects = await SubjectModel.find({
      class_name: regex,
    }).lean();

    return {
      className: cleanClass,
      teacherCount: teachers.length,
      teachers: teachers.map(t => ({
        id: sId(t),
        name: t.name,
        subject: t.subject,
        qualification: valOrNa(t.qualification),
        phone: valOrNa(t.contact_no),
        email: valOrNa(t.email),
        assigned_classes: t.classes || [],
      })),
      subjectsTaught: subjects.map(s => ({
        subjectName: s.name,
        teacher: s.teacher_name,
        periodsPerWeek: s.weekly_periods || 0,
      })),
    };
  },

  /**
   * 7. Class Enrollment Count and Breakdown
   */
  async getClassEnrollment(className: string) {
    const cleanClass = (className || '').replace(/[.?!\s]+$/, '').trim();
    const numMatch = cleanClass.match(/\b(\d+)\b/);
    const regex = numMatch
      ? new RegExp(`(class|grade)?\\s*${numMatch[1]}`, 'i')
      : safeRegex(cleanClass, 'i');

    const students = await StudentModel.find({
      class_name: regex,
      academic_status: 'Active',
    }).lean();

    const maleCount = students.filter(s => s.gender === 'Male').length;
    const femaleCount = students.filter(s => s.gender === 'Female').length;

    const sectionBreakdown: Record<string, number> = {};
    students.forEach(s => {
      const sec = s.section || 'A';
      sectionBreakdown[sec] = (sectionBreakdown[sec] || 0) + 1;
    });

    return {
      className: cleanClass,
      totalEnrolled: students.length,
      genderBreakdown: { male: maleCount, female: femaleCount },
      sectionBreakdown,
      students: students.map(s => ({
        id: sId(s),
        roll_no: s.roll_no,
        name: s.full_name,
        father_name: valOrNa(s.father_name),
        section: s.section || 'A',
      })),
    };
  },

  /**
   * 8. Today's / Date-Specific Absent Students
   * Strict Rule 5: If an explicit date is requested, never silently substitute another date.
   */
  async getTodayAbsentStudents(targetDate?: string) {
    const todayStr = new Date().toISOString().split('T')[0];
    const date = targetDate || todayStr;

    const records = await AttendanceModel.find({
      date,
      status: { $in: ['Absent', 'Leave'] },
    }).lean();

    // If records were found for the requested date, return them directly
    if (records.length > 0) {
      const absentStudents: any[] = [];
      for (const r of records) {
        const student = await StudentModel.findOne({
          $or: [
            mongoose.isValidObjectId(r.student_id) ? { _id: r.student_id } : null,
            { record_id: r.student_id },
            { id: r.student_id },
            { full_name: safeRegex(r.student_name, 'i') },
          ].filter(Boolean) as any,
        }).lean();

        absentStudents.push({
          id: r.student_id,
          name: r.student_name,
          class_name: r.class_name,
          section: r.section || 'A',
          father_name: valOrNa(student?.father_name),
          phone: valOrNa(student?.contact_no),
          status: r.status,
          remarks: valOrNa(r.remarks),
        });
      }

      return {
        date,
        count: absentStudents.length,
        absents: absentStudents,
        isFallbackDate: false,
      };
    }

    // If an explicit targetDate was asked (e.g. "yesterday" or specific YYYY-MM-DD),
    // report exactly 0 absents for that date. Never silently switch dates!
    if (targetDate && targetDate !== todayStr) {
      return {
        date: targetDate,
        count: 0,
        absents: [],
        isFallbackDate: false,
      };
    }

    // If "today" has no records marked in the database (e.g. before morning roll call),
    // check if any historical attendance exists and report clearly
    const latestAtt = await AttendanceModel.findOne().sort({ date: -1 }).lean();
    if (latestAtt && latestAtt.date !== todayStr) {
      const historicalRecords = await AttendanceModel.find({
        date: latestAtt.date,
        status: { $in: ['Absent', 'Leave'] },
      }).lean();

      const absentStudents: any[] = [];
      for (const r of historicalRecords) {
        const student = await StudentModel.findOne({
          $or: [
            mongoose.isValidObjectId(r.student_id) ? { _id: r.student_id } : null,
            { record_id: r.student_id },
            { id: r.student_id },
            { full_name: safeRegex(r.student_name, 'i') },
          ].filter(Boolean) as any,
        }).lean();

        absentStudents.push({
          id: r.student_id,
          name: r.student_name,
          class_name: r.class_name,
          section: r.section || 'A',
          father_name: valOrNa(student?.father_name),
          phone: valOrNa(student?.contact_no),
          status: r.status,
          remarks: valOrNa(r.remarks),
        });
      }

      return {
        date: todayStr,
        lastMarkedDate: latestAtt.date,
        count: absentStudents.length,
        absents: absentStudents,
        isFallbackDate: true,
      };
    }

    return {
      date: todayStr,
      count: 0,
      absents: [],
      isFallbackDate: false,
    };
  },

  /**
   * 9. Students with Unpaid Fees
   */
  async getStudentsWithUnpaidFees() {
    const unpaidFees = await FeeModel.find({
      status: { $in: ['Unpaid', 'Partial', 'Overdue'] },
    }).lean();

    const grouped: Record<string, any> = {};
    for (const f of unpaidFees) {
      if (!grouped[f.student_id]) {
        grouped[f.student_id] = {
          studentId: f.student_id,
          studentName: f.student_name,
          className: f.class_name,
          totalDue: 0,
          vouchers: [],
        };
      }
      const due = f.pending_amount > 0 ? f.pending_amount : f.total_amount - (f.paid_amount || 0);
      grouped[f.student_id].totalDue += due;
      grouped[f.student_id].vouchers.push({
        month: f.fee_month,
        year: f.year,
        amount: due,
        dueDate: valOrNa(f.due_date),
      });
    }

    const studentList: any[] = [];
    for (const sid of Object.keys(grouped)) {
      const item = grouped[sid];
      const student = await StudentModel.findOne({
        $or: [
          mongoose.isValidObjectId(sid) ? { _id: sid } : null,
          { record_id: sid },
          { id: sid },
          { full_name: safeRegex(item.studentName, 'i') },
        ].filter(Boolean) as any,
      }).lean();

      const canonicalSid = student ? sId(student) : sid;
      studentList.push({
        ...item,
        id: canonicalSid,
        studentId: canonicalSid,
        rawStudentId: sid,
        fatherName: valOrNa(student?.father_name),
        phone: valOrNa(student?.contact_no),
        rollNo: student?.roll_no || 'Not available in database.',
      });
    }

    studentList.sort((a, b) => b.totalDue - a.totalDue);
    const grandTotalDue = studentList.reduce((acc, s) => acc + s.totalDue, 0);

    return {
      count: studentList.length,
      grandTotalDue,
      students: studentList,
    };
  },

  /**
   * 10. Student Parents Info
   */
  async getStudentParents(query: string, context?: AdminAiQueryContext) {
    const profileRes: any = await ControlledSchoolTools.getStudentProfile(query, context);
    if (!profileRes.found || profileRes.disambiguationRequired || !profileRes.profile) {
      return profileRes;
    }
    const p = profileRes.profile;
    return {
      found: true,
      studentId: p.id,
      studentName: p.full_name,
      className: p.class_name,
      rollNo: p.roll_no,
      fatherName: p.father_name,
      parentDetails: p.parent,
    };
  },

  /**
   * 11. Teacher Assigned Subjects
   */
  async getTeacherAssignedSubjects(query: string, context?: AdminAiQueryContext) {
    const teacherRes: any = await ControlledSchoolTools.getTeacherRecord(query, context);
    if (!teacherRes.found || teacherRes.disambiguationRequired || !teacherRes.teacher) {
      return teacherRes;
    }
    const t = teacherRes.teacher;
    return {
      found: true,
      teacherId: t.id,
      teacherName: t.name,
      primarySubject: t.subject,
      classes: t.classes,
      assignedSubjects: t.assigned_subjects,
    };
  },

  /**
   * 12. Recent / Date-Aware Admissions
   * Strict Rule 5: Correct date-range handling. If the requested period has no records,
   * says no records were found for that period. Never silently returns unrelated recent records as if they matched.
   */
  async getRecentAdmissions(promptOrDateExpr?: string) {
    const dateRange = parseNaturalDateRange(promptOrDateExpr || '');
    const allAdmissions = await AdmissionModel.find().sort({ created_at: -1 }).lean();

    if (dateRange.hasExplicitRange && dateRange.startDate && dateRange.endDate) {
      const startMs = dateRange.startDate.getTime();
      const endMs = dateRange.endDate.getTime();

      const filtered = allAdmissions.filter(a => {
        if (!a.created_at) return false;
        const recordMs = new Date(a.created_at).getTime();
        return !isNaN(recordMs) && recordMs >= startMs && recordMs <= endMs;
      });

      return {
        period: dateRange.label,
        hasExplicitRange: true,
        totalCount: filtered.length,
        pendingCount: filtered.filter(a => a.status === 'Pending').length,
        approvedCount: filtered.filter(a => a.status === 'Approved').length,
        admissions: filtered.map(a => ({
          applicationNo: a.application_no,
          studentName: a.student_name,
          fatherName: valOrNa(a.father_name),
          classApplying: a.class_applying,
          status: a.status,
          parentPhone: valOrNa(a.parent_phone),
          appliedDate: a.created_at ? new Date(a.created_at).toISOString().split('T')[0] : 'Not available in database.',
        })),
      };
    }

    // Unconstrained / general recent admissions inquiry
    return {
      period: 'Recent Admissions on Record',
      hasExplicitRange: false,
      totalCount: allAdmissions.length,
      pendingCount: allAdmissions.filter(a => a.status === 'Pending').length,
      approvedCount: allAdmissions.filter(a => a.status === 'Approved').length,
      admissions: allAdmissions.slice(0, 10).map(a => ({
        applicationNo: a.application_no,
        studentName: a.student_name,
        fatherName: valOrNa(a.father_name),
        classApplying: a.class_applying,
        status: a.status,
        parentPhone: valOrNa(a.parent_phone),
        appliedDate: a.created_at ? new Date(a.created_at).toISOString().split('T')[0] : 'Not available in database.',
      })),
    };
  },

  // ==========================================
  // MULTI-TOOL COMBINATIONS & AGGREGATIONS
  // ==========================================

  /**
   * MULTI-TOOL: Students with Low Attendance (< 75%) AND Unpaid Fees
   */
  async getStudentsWithLowAttendanceAndUnpaidFees(threshold = 75) {
    const lowAtt = await ControlledSchoolTools.getLowAttendanceStudents(threshold);
    const unpaid = await ControlledSchoolTools.getStudentsWithUnpaidFees();

    const unpaidMap = new Map<string, any>();
    for (const u of unpaid.students) {
      unpaidMap.set(String(u.studentId), u);
      unpaidMap.set(String(u.id), u);
    }

    const combinedList: any[] = [];
    for (const st of lowAtt.students) {
      if (unpaidMap.has(String(st.id))) {
        const u = unpaidMap.get(String(st.id));
        const parent = await ParentModel.findOne({
          $or: [
            { linked_students: st.id },
            { name: safeRegex(st.father_name, 'i') },
          ].filter(Boolean) as any,
        }).lean();

        combinedList.push({
          id: st.id,
          name: st.name,
          father_name: st.father_name,
          class_name: st.class_name,
          roll_no: st.roll_no,
          attendance_percentage: st.percentage,
          total_absents: st.absents,
          total_days: st.total_days,
          pending_fee: u.totalDue,
          vouchers_count: u.vouchers?.length || 1,
          parent_phone: valOrNa(parent?.phone || st.phone),
        });
      }
    }

    return {
      threshold,
      count: combinedList.length,
      students: combinedList,
    };
  },

  /**
   * MULTI-TOOL: Parent Warning List for Low Attendance Students
   */
  async getParentWarningList(threshold = 75) {
    const lowAtt = await ControlledSchoolTools.getLowAttendanceStudents(threshold);
    const warningList: any[] = [];

    for (const st of lowAtt.students) {
      const parent = await ParentModel.findOne({
        $or: [
          { linked_students: st.id },
          { name: safeRegex(st.father_name, 'i') },
        ].filter(Boolean) as any,
      }).lean();

      warningList.push({
        id: st.id,
        student_name: st.name,
        father_name: st.father_name,
        class_name: st.class_name,
        roll_no: st.roll_no,
        attendance_percentage: st.percentage,
        absent_days: st.absents,
        parent_name: parent?.name || st.father_name,
        parent_phone: valOrNa(parent?.phone || st.phone),
        parent_address: valOrNa(parent?.address),
      });
    }

    return {
      threshold,
      count: warningList.length,
      warningList,
    };
  },

  /**
   * MULTI-TOOL: Parents of all Students with Unpaid Fees
   */
  async getUnpaidFeeParentsList() {
    const feeData = await ControlledSchoolTools.getStudentsWithUnpaidFees();
    const parentList: any[] = [];

    for (const st of feeData.students) {
      const parent = await ParentModel.findOne({
        $or: [
          { linked_students: st.id },
          { name: safeRegex(st.fatherName, 'i') },
        ].filter(Boolean) as any,
      }).lean();

      parentList.push({
        id: st.id,
        student_name: st.studentName,
        father_name: st.fatherName,
        class_name: st.className,
        roll_no: st.rollNo,
        pending_fee: st.totalDue,
        parent_name: parent?.name || st.fatherName,
        parent_phone: valOrNa(parent?.phone || st.phone),
      });
    }

    return {
      count: parentList.length,
      grandTotalDue: feeData.grandTotalDue,
      parentList,
    };
  },

  /**
   * MULTI-TOOL: Class Absence Rankings
   */
  async getClassAbsenceRankings() {
    const classSummary = await AttendanceModel.aggregate([
      {
        $group: {
          _id: '$class_name',
          totalRecords: { $sum: 1 },
          presents: {
            $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] },
          },
          absents: {
            $sum: { $cond: [{ $in: ['$status', ['Absent', 'Leave']] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          className: '$_id',
          totalRecords: 1,
          presents: 1,
          absents: 1,
          attendanceRate: {
            $cond: [
              { $gt: ['$totalRecords', 0] },
              { $round: [{ $multiply: [{ $divide: ['$presents', '$totalRecords'] }, 100] }, 1] },
              100,
            ],
          },
        },
      },
      { $sort: { absents: -1, attendanceRate: 1 } },
    ]);

    return {
      classesCount: classSummary.length,
      rankings: classSummary,
    };
  },

  // ==========================================
  // SCHOOL-WIDE REPORT AGGREGATIONS
  // ==========================================

  /**
   * Report 1: Comprehensive School Overview
   */
  async getSchoolOverview() {
    const totalStudents = await StudentModel.countDocuments({ academic_status: 'Active' });
    const totalTeachers = await TeacherModel.countDocuments({ status: 'Active' });
    const totalClasses = await ClassModel.countDocuments();

    // Today's attendance
    const todayStr = new Date().toISOString().split('T')[0];
    let attRecords = await AttendanceModel.find({ date: todayStr }).lean();
    let displayDate = todayStr;

    if (attRecords.length === 0) {
      const latest = await AttendanceModel.findOne().sort({ date: -1 }).lean();
      if (latest) {
        attRecords = await AttendanceModel.find({ date: latest.date }).lean();
        displayDate = latest.date;
      }
    }
    const todayTotal = attRecords.length;
    const todayPresent = attRecords.filter(a => a.status === 'Present').length;
    const todayRate = todayTotal > 0 ? Math.round((todayPresent / todayTotal) * 100) : 100;

    // Fee collections
    const feeRecords = await FeeModel.find().lean();
    const totalCollected = feeRecords.reduce((sum, f) => sum + (f.paid_amount || 0), 0);
    const totalPending = feeRecords.reduce((sum, f) => sum + (f.pending_amount || 0), 0);

    // Admissions
    const pendingAdmissions = await AdmissionModel.countDocuments({ status: 'Pending' });
    const approvedAdmissions = await AdmissionModel.countDocuments({ status: 'Approved' });

    return {
      totalStudents,
      totalTeachers,
      totalClasses,
      attendanceRate: todayRate,
      todayMarked: todayTotal,
      todayPresent,
      displayDate,
      totalCollectedFee: totalCollected,
      totalPendingFee: totalPending,
      pendingAdmissions,
      approvedAdmissions,
    };
  },

  /**
   * Report 2: Today Attendance Summary with class-by-class metrics
   */
  async getTodayAttendanceSummary(targetDate?: string) {
    const todayStr = targetDate || new Date().toISOString().split('T')[0];
    const totalStudents = await StudentModel.countDocuments({ academic_status: 'Active' });
    let todayRecords = await AttendanceModel.find({ date: todayStr }).lean();
    let displayDate = todayStr;

    if (todayRecords.length === 0 && !targetDate) {
      const latest = await AttendanceModel.findOne().sort({ date: -1 }).lean();
      if (latest) {
        todayRecords = await AttendanceModel.find({ date: latest.date }).lean();
        displayDate = latest.date;
      }
    }

    const totalMarked = todayRecords.length;
    const presents = todayRecords.filter(r => r.status === 'Present').length;
    const absents = todayRecords.filter(r => r.status === 'Absent').length;
    const leaves = todayRecords.filter(r => r.status === 'Leave' || r.status === 'Late').length;
    const overallRate = totalMarked > 0 ? Math.round((presents / totalMarked) * 100) : 0;

    const classes = await ClassModel.find().lean();
    const classBreakdown: any[] = [];

    for (const c of classes) {
      const classStudents = await StudentModel.find({
        class_name: safeRegex(c.name, 'i'),
        academic_status: 'Active',
      }).lean();
      const studentIds = new Set<string>();
      for (const s of classStudents) {
        if (s._id) studentIds.add(s._id.toString());
        if ((s as any).record_id) studentIds.add(String((s as any).record_id));
      }
      const classAtt = todayRecords.filter(r => studentIds.has(r.student_id));
      const cPresents = classAtt.filter(r => r.status === 'Present').length;
      const cAbsents = classAtt.filter(r => r.status === 'Absent').length;
      const cLeaves = classAtt.filter(r => r.status === 'Leave' || r.status === 'Late').length;
      const cRate = classAtt.length > 0 ? Math.round((cPresents / classAtt.length) * 100) : 0;

      if (classStudents.length > 0 || classAtt.length > 0) {
        classBreakdown.push({
          className: c.name,
          enrolled: classStudents.length,
          marked: classAtt.length,
          presents: cPresents,
          absents: cAbsents,
          leaves: cLeaves,
          rate: cRate,
        });
      }
    }

    return {
      date: displayDate,
      requestedDate: todayStr,
      totalStudents,
      totalMarked,
      presents,
      absents,
      leaves,
      overallRate,
      classBreakdown,
    };
  },

  /**
   * Report 3: Attendance Trend (Last 7 days)
   */
  async getAttendanceTrend(days = 7) {
    const trend = await AttendanceModel.aggregate([
      {
        $group: {
          _id: '$date',
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $in: ['$status', ['Absent', 'Leave']] }, 1, 0] } },
        },
      },
      {
        $project: {
          date: '$_id',
          total: 1,
          present: 1,
          absent: 1,
          rate: {
            $round: [{ $multiply: [{ $divide: ['$present', '$total'] }, 100] }, 1],
          },
        },
      },
      { $sort: { date: -1 } },
      { $limit: days },
    ]);

    return {
      days,
      trend: trend.reverse(),
    };
  },

  /**
   * Report 4: Fee Financial Summary
   */
  async getFeeSummary() {
    const feeData = await FeeModel.aggregate([
      {
        $group: {
          _id: null,
          totalBilled: { $sum: '$total_amount' },
          totalPaid: { $sum: '$paid_amount' },
          totalPending: { $sum: '$pending_amount' },
          voucherCount: { $sum: 1 },
          unpaidCount: { $sum: { $cond: [{ $eq: ['$status', 'Unpaid'] }, 1, 0] } },
          partialCount: { $sum: { $cond: [{ $eq: ['$status', 'Partial'] }, 1, 0] } },
          paidCount: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, 1, 0] } },
        },
      },
    ]);

    const result = feeData[0] || {
      totalBilled: 0,
      totalPaid: 0,
      totalPending: 0,
      voucherCount: 0,
      unpaidCount: 0,
      partialCount: 0,
      paidCount: 0,
    };

    const collectionRate =
      result.totalBilled > 0 ? Math.round((result.totalPaid / result.totalBilled) * 100) : 100;

    return {
      ...result,
      collectionRate,
    };
  },

  /**
   * Report 5: Fee Defaulters by Class
   */
  async getFeeDefaultersByClass() {
    const classDefaulters = await FeeModel.aggregate([
      { $match: { status: { $in: ['Unpaid', 'Partial', 'Overdue'] } } },
      {
        $group: {
          _id: '$class_name',
          totalDue: { $sum: '$pending_amount' },
          defaulterCount: { $sum: 1 },
        },
      },
      {
        $project: {
          className: '$_id',
          totalDue: 1,
          defaulterCount: 1,
        },
      },
      { $sort: { totalDue: -1 } },
    ]);

    return {
      classesCount: classDefaulters.length,
      defaultersByClass: classDefaulters,
    };
  },

  /**
   * Report 6: Student Count by Class
   */
  async getStudentCountByClass() {
    const counts = await StudentModel.aggregate([
      { $match: { academic_status: 'Active' } },
      {
        $group: {
          _id: '$class_name',
          total: { $sum: 1 },
          male: { $sum: { $cond: [{ $eq: ['$gender', 'Male'] }, 1, 0] } },
          female: { $sum: { $cond: [{ $eq: ['$gender', 'Female'] }, 1, 0] } },
        },
      },
      {
        $project: {
          className: '$_id',
          total: 1,
          male: 1,
          female: 1,
        },
      },
      { $sort: { total: -1 } },
    ]);

    const totalStudents = counts.reduce((acc, c) => acc + c.total, 0);

    return {
      totalStudents,
      classes: counts,
    };
  },

  /**
   * Report 7: Teacher Count by Subject
   */
  async getTeacherCountBySubject() {
    const subjectDistribution = await TeacherModel.aggregate([
      { $match: { status: 'Active' } },
      {
        $group: {
          _id: '$subject',
          count: { $sum: 1 },
          teachers: { $push: '$name' },
        },
      },
      {
        $project: {
          subject: '$_id',
          count: 1,
          teachers: 1,
        },
      },
      { $sort: { count: -1 } },
    ]);

    return {
      totalSubjects: subjectDistribution.length,
      subjects: subjectDistribution,
    };
  },

  /**
   * Report 8: Exam Performance Summary
   */
  async getExamPerformanceSummary() {
    const results = await ResultModel.find({ published: { $ne: false } }).lean();
    if (results.length === 0) {
      return {
        totalExamined: 0,
        averagePercentage: 0,
        topScorers: [],
        message: 'No published examination results found in MongoDB Atlas.',
      };
    }

    const totalPercentage = results.reduce((acc, r) => acc + (r.percentage || 0), 0);
    const avg = Math.round((totalPercentage / results.length) * 10) / 10;

    const topScorers = [...results]
      .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))
      .slice(0, 5)
      .map(r => ({
        studentName: r.student_name,
        className: r.class_name,
        percentage: r.percentage,
        grade: r.overall_grade,
        examTitle: r.exam_title,
      }));

    return {
      totalExamined: results.length,
      averagePercentage: avg,
      topScorers,
    };
  },

  /**
   * Draft Fee Reminder Action
   */
  async draftFeeReminders() {
    const unpaidData = await ControlledSchoolTools.getStudentsWithUnpaidFees();
    const draftUrdu = `محترم والدین!\nشوان سکول اینڈ کالج، پہاڑ پور، ڈیرہ اسماعیل خان کی جانب سے مطلع کیا جاتا ہے کہ آپ کے بچے کی واجب الادا فیس زیر التواء ہے۔ برائے مہربانی سکول آفس یا آن لائن اکاؤنٹ پر فیس جلد از جلد جمع کرائیں۔\nشکریہ - ایڈمنسٹریشن شوان سکول اینڈ کالج\nرابطہ: 0966-772211 | 0300-1234567`;

    return {
      unpaidStudentCount: unpaidData.count,
      totalOutstanding: unpaidData.grandTotalDue,
      students: unpaidData.students.slice(0, 5),
      draftUrdu,
      draftEnglish: `Dear Respected Parent,\nThis is a gentle reminder from Shawan School and College, Paharpur, D.I. Khan that tuition fee dues are currently outstanding. Please deposit the pending voucher at the school accounts office.\nThank you,\nAdministration Shawan School & College`,
      actionReady: true,
      actionType: 'SEND_FEE_REMINDER_SMS',
    };
  },

  /**
   * Prepare Sensitive SMS Action (Mandatory Admin Confirmation)
   */
  async prepareSmsAction(type: 'ABSENT_ALERT' | 'FEE_REMINDER' | 'CUSTOM', customMessage?: string) {
    if (type === 'ABSENT_ALERT') {
      const absentData = await ControlledSchoolTools.getTodayAbsentStudents();
      const recipients = absentData.absents
        .filter(a => a.phone && a.phone !== 'Not available in database.' && a.phone !== 'N/A')
        .map(a => ({
          studentName: a.name,
          className: a.class_name,
          phone: a.phone,
        }));

      const messageText = `محترم والدین! آپ کا بچہ آج شوان سکول سے غیر حاضر ہے۔ براہ کرم وجہ کی اطلاع دیں۔ شوان سکول پہاڑ پور۔`;

      return {
        requiresConfirmation: true,
        pendingAction: {
          actionType: 'SEND_SMS_ABSENT',
          title: `Send Absent Alert SMS (${recipients.length} Parents)`,
          description: `This will prepare dispatch of automated notifications to parents of ${recipients.length} absent students for ${absentData.date}.`,
          payload: {
            recipients,
            date: absentData.date,
            message: messageText,
          },
          recipientCount: recipients.length,
          previewText: messageText,
        },
      };
    } else if (type === 'FEE_REMINDER') {
      const feeData = await ControlledSchoolTools.getStudentsWithUnpaidFees();
      const recipients = feeData.students
        .filter(s => s.phone && s.phone !== 'Not available in database.' && s.phone !== 'N/A')
        .map(s => ({
          studentName: s.studentName,
          className: s.className,
          phone: s.phone,
          dueAmount: s.totalDue,
        }));

      const messageText = `محترم والدین! شوان سکول کی واجب الادا فیس جلد جمع کرائیں۔ شکریہ - شوان سکول اینڈ کالج پہاڑ پور۔`;

      return {
        requiresConfirmation: true,
        pendingAction: {
          actionType: 'SEND_SMS_FEES',
          title: `Send Fee Reminder SMS (${recipients.length} Parents)`,
          description: `This will dispatch notifications to parents of ${recipients.length} students with outstanding fees totaling PKR ${feeData.grandTotalDue.toLocaleString()}.`,
          payload: {
            recipients,
            grandTotalDue: feeData.grandTotalDue,
            message: messageText,
          },
          recipientCount: recipients.length,
          previewText: messageText,
        },
      };
    } else {
      return {
        requiresConfirmation: true,
        pendingAction: {
          actionType: 'SEND_SMS_CUSTOM',
          title: 'Send Custom Broadcast Notification',
          description: 'Dispatch custom administrative notification to recipients.',
          payload: { message: customMessage || '' },
          recipientCount: 1,
          previewText: customMessage || '',
        },
      };
    }
  },

  /**
   * Execute Confirmed Action
   */
  async executeConfirmedAction(
    actionType: string,
    payload: any,
    confirmed: boolean,
    context: AdminAiQueryContext
  ) {
    if (!confirmed) {
      throw new Error(
        'Action aborted: Explicit admin confirmation is mandatory to execute sensitive actions.'
      );
    }

    const allowedActions = new Set(['SEND_SMS_ABSENT', 'SEND_SMS_FEES']);
    if (!allowedActions.has(actionType)) {
      throw new Error('Unsupported AI action. Only reviewed absent and fee reminder actions are allowed.');
    }

    const recipients = payload?.recipients;
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 500) {
      throw new Error('A valid recipient list containing 1 to 500 recipients is required.');
    }
    if (!message || message.length > 1000) {
      throw new Error('A non-empty notification message of at most 1000 characters is required.');
    }
    for (const recipient of recipients) {
      const phone = typeof recipient?.phone === 'string' ? recipient.phone.trim() : '';
      if (!/^\\+?[0-9][0-9\\s()-]{6,19}$/.test(phone)) {
        throw new Error('Every notification recipient must have a valid phone number.');
      }
      if (typeof recipient?.studentName !== 'string' || !recipient.studentName.trim()) {
        throw new Error('Every notification recipient must have a valid student name.');
      }
    }

    // This records an in-app audit/notification entry only; it does NOT send an SMS.
    for (const recipient of recipients) {
      await NotificationModel.create({
        user_id: recipient.phone.trim(),
        title: `Administrative Alert: ${actionType}`,
        message: `${message} [To: ${recipient.studentName.trim()}, Phone: ${recipient.phone.trim()}]`,
        type: 'sms',
        read: false,
        created_at: new Date(),
      });
    }

    const auditId = await recordAuditLog(
      context,
      `AI_ACTION_RECORDED_${actionType}`,
      'AI_NOTIFICATION',
      `Admin confirmed and recorded an in-app notification entry for ${recipients.length} recipients. No SMS was dispatched.`
    );

    return {
      success: true,
      message: `Recorded ${recipients.length} in-app notification entr(y/ies). No SMS was sent; a verified SMS gateway is not connected.`,
      recordedCount: recipients.length,
      smsDispatched: false,
      auditLogId: auditId,
    };
  },
};

/**
 * Helper to obtain standard string ID from document
 */
function sId(doc: any): string {
  if (!doc) return '';
  return doc.record_id || (doc as any).id || (doc._id ? doc._id.toString() : '');
}

// ==========================================
// SEMANTIC INTENT DISPATCHER & MULTI-TOOL RESOLVER
// ==========================================

export async function processAdminAiQuery(
  rawPrompt: string,
  context: AdminAiQueryContext
): Promise<AiResponseResult> {
  // ----------------------------------------------------
  // 1. Role-Based Permission Check (Objective 10)
  // ----------------------------------------------------
  if (context.userRole !== 'super_admin' && context.userRole !== 'admin') {
    return {
      text: 'Access Denied: Admin AI Assistant requires super_admin or admin role privileges.',
      error: 'FORBIDDEN',
    };
  }

  const prompt = (rawPrompt || '').trim();
  if (!prompt) {
    return {
      text: 'Hello! I am the Shawan School and College Admin AI Assistant. How can I assist you with school records today?',
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  const pLower = prompt.toLowerCase();

  // ----------------------------------------------------
  // DIRECT SELECTION BY DATABASE ID (Objective 6)
  // When admin selects a candidate from disambiguation list or passes selectedId
  // ----------------------------------------------------
  if (context.selectedId) {
    const sIdTarget = context.selectedId.trim();
    if (/^(std_|[0-9a-fA-F]{24})/i.test(sIdTarget)) {
      const studentRes: any = await ControlledSchoolTools.getStudentProfile(sIdTarget, context);
      if (studentRes.found && studentRes.profile) {
        const s = studentRes.profile;
        const resultRows = s.results?.length
          ? s.results
              .map(
                (r: any) =>
                  `* **${r.examTitle}:** ${r.obtainedMarks}/${r.totalMarks} (${r.percentage}%) - Grade \`${r.grade}\``
              )
              .join('\n')
          : '* No examination records available in database.';

        const auditId = await recordAuditLog(
          context,
          'AI_QUERY_STUDENT_PROFILE_BY_ID',
          'STUDENT',
          `Directly resolved student profile by selected database ID: ${sIdTarget}`
        );

        return {
          text: `### 🎓 Official Student Dossier: ${s.full_name}\n\n#### 👤 Identity & Enrollment\n* **Admission No:** \`${s.admission_no}\` | **Roll No:** **${s.roll_no}**\n* **Full Name:** **${s.full_name}**\n* **Father / Guardian Name:** ${s.father_name}\n* **Date of Birth:** ${s.dob}\n* **Gender:** ${s.gender}\n* **Current Class:** **${s.class_name}** (Section ${s.section})\n* **Academic Status:** \`${s.academic_status}\`\n* **Admission Date:** ${s.admission_date}\n* **Contact Phone:** ${s.contact_no}\n* **Residential Address:** ${s.address}\n\n#### 📊 Attendance Summary\n* **Attendance Rate:** **${s.attendance.percentage}%** (${s.attendance.statusLabel})\n* **Session Record:** ${s.attendance.presents} Present / ${s.attendance.absents} Absent / ${s.attendance.totalDays} Total Days\n\n#### 💳 Financial Account\n* **Outstanding Balance:** **PKR ${s.fees.pendingDue.toLocaleString()}** (\`${s.fees.status}\`)\n* **Billed Amount:** PKR ${s.fees.totalBilled.toLocaleString()} | **Paid Amount:** PKR ${s.fees.totalPaid.toLocaleString()}\n\n#### 🏆 Examination Records\n${resultRows}\n\n#### 👨‍👩‍👦 Guardian Contact Details\n* **Parent Name:** ${s.parent?.name || s.father_name}\n* **Mobile Phone:** **${s.parent?.phone || 'Not available in database.'}**\n* **Email Address:** ${s.parent?.email || 'Not available in database.'}\n* **Residential Address:** ${s.parent?.address || 'Not available in database.'}`,
          toolUsed: 'getStudentProfile',
          data: studentRes,
          activeEntity: {
            type: 'student',
            id: s.id,
            name: s.full_name,
            className: s.class_name,
            admissionNo: s.admission_no,
            rollNo: s.roll_no,
          },
          auditLogId: auditId,
          aiProviderStatus: getAiProviderStatus(),
        };
      }
    }
    if (/^(tch_|[0-9a-fA-F]{24})/i.test(sIdTarget)) {
      const teacherRes: any = await ControlledSchoolTools.getTeacherRecord(sIdTarget, context);
      if (teacherRes.found && teacherRes.teacher) {
        const t = teacherRes.teacher;
        const auditId = await recordAuditLog(
          context,
          'AI_QUERY_TEACHER_RECORD_BY_ID',
          'TEACHER',
          `Directly resolved teacher record by selected database ID: ${sIdTarget}`
        );
        return {
          text: `### 👨‍🏫 Official Faculty Profile: ${t.name}\n\n* **Teacher Name:** **${t.name}**\n* **Employee ID:** \`${t.employee_id}\`\n* **Subject Specialization:** ${t.subject}\n* **Academic Qualification:** ${t.qualification}\n* **Assigned Classes:** **${t.classes.join(', ')}**\n* **Official Email:** ${t.email}\n* **Contact Phone:** ${t.phone}\n* **Teaching Workload:** **${t.workload_periods_per_week} periods/week**`,
          toolUsed: 'getTeacherRecord',
          data: teacherRes,
          activeEntity: {
            type: 'teacher',
            id: t.id,
            name: t.name,
            className: t.classes.join(', '),
          },
          auditLogId: auditId,
          aiProviderStatus: getAiProviderStatus(),
        };
      }
    }
  }

  // ----------------------------------------------------
  // SENSITIVE ACTION: SMS Alerts / Broadcasts
  // ----------------------------------------------------
  if (
    pLower.includes('send sms') ||
    pLower.includes('send alert') ||
    pLower.includes('sms alert') ||
    pLower.includes('message absent')
  ) {
    const isFee = pLower.includes('fee') || pLower.includes('due') || pLower.includes('unpaid');
    const smsPrep = await ControlledSchoolTools.prepareSmsAction(isFee ? 'FEE_REMINDER' : 'ABSENT_ALERT');
    const auditId = await recordAuditLog(
      context,
      'AI_PREPARE_SMS_ACTION',
      'SMS_ALERT',
      `Admin initiated sensitive notification for ${isFee ? 'fee reminder' : 'absent alert'}. Confirmation required.`
    );
    return {
      text: `⚠️ **Admin Confirmation Required**\n\nYou have requested to dispatch notifications. In accordance with school safety protocols, this sensitive action requires explicit admin confirmation before processing.\n\nPlease review the details below and confirm to proceed.`,
      toolUsed: 'prepareSmsAction',
      requiresConfirmation: true,
      pendingAction: smsPrep.pendingAction,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // SENSITIVE ACTION: Draft Fee Reminder
  // ----------------------------------------------------
  if (
    (pLower.includes('draft') || pLower.includes('prepare') || pLower.includes('write')) &&
    pLower.includes('fee') &&
    (pLower.includes('reminder') || pLower.includes('notice') || pLower.includes('sms'))
  ) {
    const draftRes = await ControlledSchoolTools.draftFeeReminders();
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_DRAFT_FEE_REMINDER',
      'FEE',
      `Admin generated fee reminder draft for ${draftRes.unpaidStudentCount} unpaid students.`
    );
    return {
      text: `### 📋 Prepared Fee Reminder Notification Draft\n\n**Recipients on Record:** ${draftRes.unpaidStudentCount} students with unpaid fees\n**Total Outstanding Dues:** PKR ${draftRes.totalOutstanding.toLocaleString()}\n\n---\n#### 📱 Urdu Template (SMS / WhatsApp):\n\`\`\`\n${draftRes.draftUrdu}\n\`\`\`\n\n#### 🌐 English Template:\n\`\`\`\n${draftRes.draftEnglish}\n\`\`\`\n\n*Action Ready: Say "Send fee reminder SMS alert" to trigger the verified broadcast confirmation dialog.*`,
      toolUsed: 'draftFeeReminders',
      data: draftRes,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // MULTI-TOOL 1: Students with attendance < 75% AND unpaid fees
  // ----------------------------------------------------
  if (
    (pLower.includes('below 75') || pLower.includes('low attendance') || pLower.includes('< 75')) &&
    (pLower.includes('unpaid') || pLower.includes('fee') || pLower.includes('dues')) &&
    (pLower.includes('and') || pLower.includes('both') || pLower.includes('together'))
  ) {
    const combinedData = await ControlledSchoolTools.getStudentsWithLowAttendanceAndUnpaidFees(75);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_MULTI_TOOL_LOW_ATTENDANCE_AND_FEES',
      'STUDENT',
      `Found ${combinedData.count} students with both attendance below 75% and unpaid fees.`
    );

    if (combinedData.count === 0) {
      return {
        text: `✅ **No Critical Overlaps:** There are currently no students who have **both** attendance below 75% and unpaid fees in MongoDB Atlas.`,
        toolUsed: 'getStudentsWithLowAttendanceAndUnpaidFees',
        data: combinedData,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const rows = combinedData.students
      .map(
        s =>
          `| **${s.roll_no}** | **${s.name}** | ${s.class_name} | **${s.attendance_percentage}%** (${s.total_absents} absents) | **PKR ${s.pending_fee.toLocaleString()}** | ${s.parent_phone} |`
      )
      .join('\n');

    return {
      text: `### ⚠️ Critical Students: Low Attendance (< 75%) AND Unpaid Fees\n\nIdentified **${combinedData.count}** student(s) matching both criteria via stable database ID matching:\n\n| Roll | Student Name | Class | Attendance % | Pending Dues | Parent Mobile |\n|---|---|---|---|---|---|\n${rows}\n\n*Combined multi-tool analysis verified live from MongoDB Atlas.*`,
      toolUsed: 'getStudentsWithLowAttendanceAndUnpaidFees',
      data: combinedData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // MULTI-TOOL 2: Parent warning list for low attendance students
  // ----------------------------------------------------
  if (
    (pLower.includes('parent') || pLower.includes('warning list')) &&
    (pLower.includes('below 75') || pLower.includes('low attendance'))
  ) {
    const warningData = await ControlledSchoolTools.getParentWarningList(75);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_PARENT_WARNING_LIST',
      'PARENT',
      `Generated warning list for ${warningData.count} parents of low-attendance students.`
    );

    if (warningData.count === 0) {
      return {
        text: `✅ **All Satisfactory:** No students have attendance below 75%. No parent warning notices needed.`,
        toolUsed: 'getParentWarningList',
        data: warningData,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const rows = warningData.warningList
      .map(
        w =>
          `| **${w.student_name}** | ${w.class_name} (#${w.roll_no}) | **${w.attendance_percentage}%** | ${w.parent_name} | **${w.parent_phone}** | ${w.parent_address} |`
      )
      .join('\n');

    return {
      text: `### 📋 Parent Warning Roster: Students Below 75% Attendance\n\nFound **${warningData.count}** student(s) requiring immediate parental notification:\n\n| Student Name | Class & Roll | Attendance % | Father / Guardian | Mobile Phone | Residence |\n|---|---|---|---|---|---|\n${rows}\n\n*Action Ready: You can request "Send SMS alert to absent students" to trigger the verified notification dialog.*`,
      toolUsed: 'getParentWarningList',
      data: warningData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // MULTI-TOOL 3: Parents of all students with unpaid fees
  // ----------------------------------------------------
  if (
    (pLower.includes('parents of') ||
      pLower.includes('find the parents') ||
      pLower.includes('parent contact for unpaid')) &&
    (pLower.includes('unpaid') || pLower.includes('fee'))
  ) {
    const parentFeeData = await ControlledSchoolTools.getUnpaidFeeParentsList();
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_UNPAID_FEE_PARENTS',
      'PARENT',
      `Found ${parentFeeData.count} parents of fee defaulters.`
    );

    if (parentFeeData.count === 0) {
      return {
        text: `✅ **All Fees Cleared:** There are no unpaid fee vouchers in MongoDB Atlas.`,
        toolUsed: 'getUnpaidFeeParentsList',
        data: parentFeeData,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const rows = parentFeeData.parentList
      .map(
        p =>
          `| **${p.student_name}** | ${p.class_name} (#${p.roll_no}) | **PKR ${p.pending_fee.toLocaleString()}** | ${p.parent_name} | **${p.parent_phone}** |`
      )
      .join('\n');

    return {
      text: `### 💳 Parent Contact Directory: Students with Outstanding Fees\n\nTotal **${parentFeeData.count}** student(s) with pending dues totaling **PKR ${parentFeeData.grandTotalDue.toLocaleString()}**:\n\n| Student Name | Class & Roll | Total Due | Parent / Guardian | Mobile Phone |\n|---|---|---|---|---|\n${rows}`,
      toolUsed: 'getUnpaidFeeParentsList',
      data: parentFeeData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // ADMISSIONS INTELLIGENCE (Objectives 1, 3, 5)
  // “Show new admitted students.”
  // “Show recent admissions this month.”
  // “Show admissions in September 2026.”
  // ----------------------------------------------------
  if (
    /\b(admissions?|admitted|newly admitted|admission applicants?)\b/i.test(pLower) &&
    !pLower.includes('admission no') &&
    !pLower.includes('admission number') &&
    !pLower.includes('admission fee')
  ) {
    const admData = await ControlledSchoolTools.getRecentAdmissions(prompt);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_RECENT_ADMISSIONS',
      'ADMISSION',
      `Retrieved ${admData.totalCount} admissions for period "${admData.period}".`
    );

    if (admData.totalCount === 0) {
      return {
        text: `No student admissions were registered for **${admData.period}** in MongoDB Atlas.`,
        toolUsed: 'getRecentAdmissions',
        data: admData,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const rows = admData.admissions
      .map(
        a =>
          `| **${a.applicationNo}** | ${a.studentName} | ${a.fatherName} | ${a.classApplying} | \`${a.status}\` | ${a.parentPhone} | ${a.appliedDate} |`
      )
      .join('\n');

    return {
      text: `### 📑 Admissions Registered (${admData.period})\n\nFound **${admData.totalCount}** applications on record (${admData.approvedCount} Approved, ${admData.pendingCount} Pending):\n\n| App # | Student Name | Father Name | Class Applying | Status | Parent Phone | Date |\n|---|---|---|---|---|---|---|\n${rows}`,
      toolUsed: 'getRecentAdmissions',
      data: admData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // MULTI-TOOL 4: Student Attendance AND Fee Status (Objective 3)
  // “Show student attendance and fee status.”
  // ----------------------------------------------------
  if (
    (pLower.includes('attendance') && (pLower.includes('fee') || pLower.includes('dues') || pLower.includes('owe'))) ||
    (pLower.includes('results') && (pLower.includes('parent') || pLower.includes('attendance'))) ||
    (pLower.includes('attendance') && pLower.includes('status') && pLower.includes('fee'))
  ) {
    const targetName =
      extractStudentTargetName(prompt) ||
      (context.activeEntity?.type === 'student' ? context.activeEntity.name || context.activeEntity.id : '') ||
      context.selectedId ||
      '';

    if (!targetName) {
      return {
        text: 'Please specify which student you would like to view attendance and fee status for (by name, roll number, or admission number), or select a student from previous search results.',
        toolUsed: 'getStudentAttendanceAndFees',
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const studentRes: any = await ControlledSchoolTools.getStudentAttendanceAndFees(targetName, context);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_MULTI_TOOL_STUDENT_ATTENDANCE_AND_FEES',
      'STUDENT',
      `Queried attendance and fee status for ${targetName}.`
    );

    if (!studentRes.found) {
      return {
        text: studentRes.message || `No matching record was found in the school database for "${targetName}".`,
        toolUsed: 'getStudentAttendanceAndFees',
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    if (studentRes.disambiguationRequired) {
      return {
        text: studentRes.message,
        toolUsed: 'getStudentAttendanceAndFees',
        disambiguationRequired: true,
        candidates: studentRes.candidates,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const s = studentRes;
    const a = s.attendance;
    const f = s.fees;

    const voucherList = f.recentVouchers?.length
      ? f.recentVouchers
          .map((v: any) => `* **${v.month} ${v.year}:** PKR ${v.amount.toLocaleString()} (Due: ${v.dueDate})`)
          .join('\n')
      : '* None (all vouchers cleared)';

    return {
      text: `### 📊 Combined Status: ${s.studentName}\n\n* **Student:** **${s.studentName}** (${s.className} - Roll #${s.rollNo})\n* **Father / Guardian:** ${s.fatherName}\n* **Parent Contact:** **${s.parentContact || 'Not available in database.'}**\n\n#### 📈 Attendance Summary:\n* **Attendance Rate:** **${a.percentage}%** (${a.statusLabel})\n* **Days Recorded:** ${a.totalDays} Total (${a.presents} Present, ${a.absents} Absent, ${a.leaves} Leave)\n${a.recentAbsentDates?.length ? `* **Recent Absent Dates:** ${a.recentAbsentDates.join(', ')}` : ''}\n\n#### 💳 Fee & Financial Balance:\n* **Outstanding Balance:** **PKR ${f.pendingDue.toLocaleString()}** (\`${f.status}\`)\n* **Billed Session Total:** PKR ${f.totalBilled.toLocaleString()} | **Paid Amount:** PKR ${f.totalPaid.toLocaleString()}\n* **Unpaid Vouchers Count:** ${f.unpaidCount}\n\n##### 📄 Unpaid Vouchers Detail:\n${voucherList}\n\n*Verified live from MongoDB Atlas database records.*`,
      toolUsed: 'getStudentAttendanceAndFees',
      data: studentRes,
      activeEntity: {
        type: 'student',
        id: s.studentId,
        name: s.studentName,
        className: s.className,
        rollNo: s.rollNo,
      },
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // PARENT DETAILS FOR STUDENT (Objective 3)
  // “Show parent details for this student.”
  // “Show parent details for Muhammad Hamza.”
  // ----------------------------------------------------
  if (
    pLower.includes('parent details') ||
    pLower.includes('parent info') ||
    pLower.includes('parents of') ||
    pLower.includes('father details') ||
    pLower.includes('guardian details') ||
    (pLower.includes('parents') && (pLower.includes('student') || pLower.includes('for')))
  ) {
    const studentQuery =
      extractStudentTargetName(prompt) ||
      (context.activeEntity?.type === 'student' ? context.activeEntity.name || context.activeEntity.id : '') ||
      context.selectedId ||
      '';

    if (!studentQuery) {
      return {
        text: 'Please specify which student you would like to view parent details for (by name, roll number, or admission number), or select a student from previous search results.',
        toolUsed: 'getStudentParents',
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const parentRes: any = await ControlledSchoolTools.getStudentParents(studentQuery, context);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_STUDENT_PARENTS',
      'PARENT',
      `Query for parents of ${studentQuery}.`
    );

    if (!parentRes.found) {
      return {
        text: parentRes.message || `No matching record was found in the school database for "${studentQuery}".`,
        toolUsed: 'getStudentParents',
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    if (parentRes.disambiguationRequired) {
      return {
        text: parentRes.message,
        toolUsed: 'getStudentParents',
        disambiguationRequired: true,
        candidates: parentRes.candidates,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const p = parentRes.parentDetails;
    return {
      text: `### 👨‍👩‍👦 Parent & Guardian Record: ${parentRes.studentName}\n\n* **Student:** **${parentRes.studentName}** (${parentRes.className} - Roll #${parentRes.rollNo})\n* **Father / Guardian Name:** **${valOrNa(p?.name || parentRes.fatherName)}**\n* **Mobile Phone:** **${valOrNa(p?.phone)}**\n* **Email Address:** ${valOrNa(p?.email)}\n* **Home Address:** ${valOrNa(p?.address)}\n* **Occupation:** ${valOrNa(p?.occupation)}\n\n*Verified parent records from live MongoDB Atlas.*`,
      toolUsed: 'getStudentParents',
      data: parentRes,
      activeEntity: {
        type: 'student',
        id: parentRes.studentId,
        name: parentRes.studentName,
        className: parentRes.className,
        rollNo: parentRes.rollNo,
      },
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // FACULTY: Teachers Assigned to Class X
  // Check if a specific class is explicitly named (e.g. "teachers for Class 9", "who teaches Grade 10")
  // ----------------------------------------------------
  const explicitClassMatch = pLower.match(
    /(?:teachers?\s+(?:assigned|teaching|for|in)\s+|who\s+teaches\s+)(class\s+\w+|grade\s+\w+|1st\s+year|2nd\s+year|\d+(?:th|st|nd|rd)?)/i
  );
  if (explicitClassMatch) {
    const rawClass = explicitClassMatch[1];
    const classInfo = await ControlledSchoolTools.getTeachersByClass(rawClass);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_TEACHERS_BY_CLASS',
      'CLASS',
      `Retrieved ${classInfo.teacherCount} teachers for ${rawClass}.`
    );

    if (classInfo.teacherCount === 0) {
      return {
        text: `No teachers are explicitly assigned to **${classInfo.className}** in the MongoDB teacher directory.`,
        toolUsed: 'getTeachersByClass',
        data: classInfo,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const tRows = classInfo.teachers
      .map(
        t =>
          `| **${t.name}** | **${t.subject}** | ${t.qualification} | ${t.phone} | ${t.email} |`
      )
      .join('\n');

    return {
      text: `### 👨‍🏫 Faculty Assigned to ${classInfo.className}\n\nFound **${classInfo.teacherCount}** teacher(s) conducting classes in **${classInfo.className}**:\n\n| Teacher Name | Subject Specialization | Qualification | Contact Phone | Email |\n|---|---|---|---|---|\n${tRows}`,
      toolUsed: 'getTeachersByClass',
      data: classInfo,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // TEACHER DETAILS AND ASSIGNED CLASSES (Objective 3)
  // “Show teacher details and assigned classes.”
  // “Show complete record of teacher Muhammad Ali.”
  // “Show teacher details.”
  // ----------------------------------------------------
  if (
    pLower.includes('teacher details and assigned classes') ||
    pLower.includes('teacher details') ||
    pLower.includes('teacher record') ||
    pLower.includes('teacher profile') ||
    pLower.includes('assigned classes for') ||
    pLower.includes('faculty directory')
  ) {
    const cleanTeacher =
      extractTeacherTargetName(prompt) ||
      (context.activeEntity?.type === 'teacher' ? context.activeEntity.name || context.activeEntity.id : '') ||
      context.selectedId ||
      '';

    // If no specific teacher is named or active, return the institutional faculty directory with assigned classes!
    if (!cleanTeacher) {
      const dirData = await ControlledSchoolTools.getFacultyDirectoryWithClasses();
      const auditId = await recordAuditLog(
        context,
        'AI_QUERY_FACULTY_DIRECTORY',
        'TEACHER',
        `Retrieved faculty directory with assigned classes (${dirData.count} teachers).`
      );

      const rows = dirData.teachers
        .map(
          t =>
            `| **${t.name}** | **${t.subject}** | ${t.classes.join(', ')} | ${t.qualification} | ${t.contact_no} |`
        )
        .join('\n');

      return {
        text: `### 👨‍🏫 Shawan School & College Faculty Directory & Assigned Classes\n\nFound **${dirData.count}** active faculty members on institutional record:\n\n| Teacher Name | Primary Subject | Assigned Classes | Qualification | Contact Phone |\n|---|---|---|---|---|\n${rows}\n\n*Tip: You can ask for a specific teacher's complete dossier, e.g. "Give me the complete record of teacher ${dirData.teachers[0]?.name || 'Muhammad Ali'}"*.`,
        toolUsed: 'getFacultyDirectoryWithClasses',
        data: dirData,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    // Specific teacher requested
    const teacherRes: any = await ControlledSchoolTools.getTeacherRecord(cleanTeacher, context);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_TEACHER_RECORD',
      'TEACHER',
      `Looked up record for teacher ${cleanTeacher}.`
    );

    if (!teacherRes.found || !teacherRes.teacher) {
      return {
        text: teacherRes.message || `No matching record was found in the school database for "${cleanTeacher}".`,
        toolUsed: 'getTeacherRecord',
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    if (teacherRes.disambiguationRequired) {
      return {
        text: teacherRes.message,
        toolUsed: 'getTeacherRecord',
        disambiguationRequired: true,
        candidates: teacherRes.candidates,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const t = teacherRes.teacher;
    const subjectList = t.assigned_subjects?.length
      ? t.assigned_subjects
          .map((s: any) => `* **${s.name}** (${s.class}) - Code: \`${s.code}\` - ${s.weekly_periods} periods/wk`)
          .join('\n')
      : '* No separate curriculum entries assigned.';

    return {
      text: `### 👨‍🏫 Official Faculty Profile: ${t.name}\n\n* **Teacher Name:** **${t.name}**\n* **Employee ID:** \`${t.employee_id}\`\n* **Subject Specialization:** ${t.subject}\n* **Academic Qualification:** ${t.qualification}\n* **Assigned Classes:** **${t.classes.join(', ')}**\n* **Official Email:** ${t.email}\n* **Contact Phone:** ${t.phone}\n* **Experience:** ${t.experience}\n* **Teaching Workload:** **${t.workload_periods_per_week} periods/week**\n* **Joining Date:** ${t.joining_date}\n* **Employment Status:** \`${t.status}\`\n\n#### 📖 Assigned Curriculum Load:\n${subjectList}`,
      toolUsed: 'getTeacherRecord',
      data: teacherRes,
      activeEntity: {
        type: 'teacher',
        id: t.id,
        name: t.name,
        className: t.classes.join(', '),
      },
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // STUDENT COMPLETE RECORD / PROFILE (Objective 3)
  // “Give me the complete record of this student.”
  // “Give me the complete record of Muhammad Hamza.”
  // “Show Ahmad Khan's complete student profile.”
  // ----------------------------------------------------
  if (
    pLower.includes('complete record') ||
    pLower.includes('complete profile') ||
    pLower.includes('student profile') ||
    pLower.includes('student dossier') ||
    pLower.includes('record of this student') ||
    pLower.includes('record of student') ||
    pLower.includes('student record')
  ) {
    const cleanStudent =
      extractStudentTargetName(prompt) ||
      (context.activeEntity?.type === 'student' ? context.activeEntity.name || context.activeEntity.id : '') ||
      context.selectedId ||
      '';

    if (!cleanStudent) {
      return {
        text: 'Please specify which student you would like to view the complete record for (by name, roll number, or admission number), or select a student from previous search results.',
        toolUsed: 'getStudentProfile',
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const studentRes: any = await ControlledSchoolTools.getStudentProfile(cleanStudent, context);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_STUDENT_PROFILE',
      'STUDENT',
      `Looked up complete record for ${cleanStudent}.`
    );

    if (studentRes.disambiguationRequired) {
      return {
        text: studentRes.message,
        toolUsed: 'getStudentProfile',
        disambiguationRequired: true,
        candidates: studentRes.candidates,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    if (!studentRes.found || !studentRes.profile) {
      return {
        text: studentRes.message || `No matching record was found in the school database for "${cleanStudent}".`,
        toolUsed: 'getStudentProfile',
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const s = studentRes.profile;
    const resultRows = s.results?.length
      ? s.results
          .map((r: any) => `* **${r.examTitle}:** ${r.obtainedMarks}/${r.totalMarks} (${r.percentage}%) - Grade \`${r.grade}\``)
          .join('\n')
      : '* No examination records available in database.';

    return {
      text: `### 🎓 Official Student Dossier: ${s.full_name}\n\n#### 👤 Identity & Enrollment\n* **Admission No:** \`${s.admission_no}\` | **Roll No:** **${s.roll_no}**\n* **Full Name:** **${s.full_name}**\n* **Father / Guardian Name:** ${s.father_name}\n* **Date of Birth:** ${s.dob}\n* **Gender:** ${s.gender}\n* **Current Class:** **${s.class_name}** (Section ${s.section})\n* **Academic Status:** \`${s.academic_status}\`\n* **Admission Date:** ${s.admission_date}\n* **Contact Phone:** ${s.contact_no}\n* **Residential Address:** ${s.address}\n\n#### 📊 Attendance Summary\n* **Attendance Rate:** **${s.attendance.percentage}%** (${s.attendance.statusLabel})\n* **Session Record:** ${s.attendance.presents} Present / ${s.attendance.absents} Absent / ${s.attendance.totalDays} Total Days\n\n#### 💳 Financial Account\n* **Outstanding Balance:** **PKR ${s.fees.pendingDue.toLocaleString()}** (\`${s.fees.status}\`)\n* **Billed Amount:** PKR ${s.fees.totalBilled.toLocaleString()} | **Paid Amount:** PKR ${s.fees.totalPaid.toLocaleString()}\n\n#### 🏆 Examination Records\n${resultRows}\n\n#### 👨‍👩‍👦 Guardian Contact Details\n* **Parent Name:** ${s.parent?.name || s.father_name}\n* **Mobile Phone:** **${s.parent?.phone || 'Not available in database.'}**\n* **Email Address:** ${s.parent?.email || 'Not available in database.'}\n* **Residential Address:** ${s.parent?.address || 'Not available in database.'}`,
      toolUsed: 'getStudentProfile',
      data: studentRes,
      activeEntity: {
        type: 'student',
        id: s.id,
        name: s.full_name,
        className: s.class_name,
        admissionNo: s.admission_no,
        rollNo: s.roll_no,
      },
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // REPORT 1: School Overview
  // ----------------------------------------------------
  if (
    pLower.includes('school overview') ||
    pLower.includes('school statistics') ||
    pLower.includes('school summary') ||
    pLower.includes('kpis') ||
    pLower.includes('school dashboard')
  ) {
    const overview = await ControlledSchoolTools.getSchoolOverview();
    const auditId = await recordAuditLog(
      context,
      'AI_REPORT_SCHOOL_OVERVIEW',
      'SCHOOL',
      'Generated comprehensive school overview report.'
    );

    return {
      text: `### 🏫 Shawan School and College: Administrative Overview\n\n* **Total Active Students:** **${overview.totalStudents}**\n* **Active Faculty Members:** **${overview.totalTeachers}**\n* **Configured Classes:** **${overview.totalClasses}**\n* **Today's Attendance Rate:** **${overview.attendanceRate}%** (${overview.todayPresent}/${overview.todayMarked} marked)\n* **Tuition Fees Collected:** **PKR ${overview.totalCollectedFee.toLocaleString()}**\n* **Total Pending Dues:** **PKR ${overview.totalPendingFee.toLocaleString()}**\n* **New Admissions:** **${overview.approvedAdmissions}** Approved, **${overview.pendingAdmissions}** Pending\n\n*All statistics retrieved via live MongoDB Atlas database aggregation.*`,
      toolUsed: 'getSchoolOverview',
      data: overview,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // REPORT 1b: Summary of today's school attendance
  // ----------------------------------------------------
  if (
    pLower.includes("today's school attendance") ||
    pLower.includes('todays school attendance') ||
    pLower.includes("summary of today's attendance") ||
    pLower.includes('summary of todays attendance') ||
    pLower.includes("today's attendance summary") ||
    pLower.includes('todays attendance summary') ||
    (pLower.includes('summary') &&
      pLower.includes('attendance') &&
      (pLower.includes('today') || pLower.includes('school')))
  ) {
    const todaySummary = await ControlledSchoolTools.getTodayAttendanceSummary();
    const auditId = await recordAuditLog(
      context,
      'AI_REPORT_TODAY_ATTENDANCE_SUMMARY',
      'ATTENDANCE',
      `Generated executive attendance summary for ${todaySummary.date}: ${todaySummary.overallRate}% overall rate.`
    );

    const classRows = todaySummary.classBreakdown
      .map(
        (c: any) =>
          `| **${c.className}** | **${c.rate}%** | ${c.presents} | ${c.absents} | ${c.leaves} | ${c.enrolled} |`
      )
      .join('\n');

    return {
      text: `### 📊 Today's School Attendance Summary (${todaySummary.date})\n\n* **Overall Attendance Rate:** **${todaySummary.overallRate}%**\n* **Total Enrolled Students:** **${todaySummary.totalStudents}**\n* **Marked Records:** ${todaySummary.totalMarked} (${todaySummary.presents} Present, ${todaySummary.absents} Absent, ${todaySummary.leaves} Leave)\n\n#### 🏫 Attendance by Class Breakdown:\n| Class Name | Attendance Rate | Presents | Absents | Leaves | Total Enrolled |\n|---|---|---|---|---|---|\n${classRows}\n\n*Real-time attendance metrics verified live from MongoDB Atlas.*`,
      toolUsed: 'getTodayAttendanceSummary',
      data: todaySummary,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // REPORT 2: Classes with highest number of absences
  // ----------------------------------------------------
  if (
    pLower.includes('highest number of absences') ||
    pLower.includes('highest absences') ||
    pLower.includes('most absences') ||
    pLower.includes('attendance summary by class') ||
    pLower.includes('absence rankings')
  ) {
    const classAbsences = await ControlledSchoolTools.getClassAbsenceRankings();
    const auditId = await recordAuditLog(
      context,
      'AI_REPORT_CLASS_ABSENCE_RANKINGS',
      'ATTENDANCE',
      'Generated class attendance and absence ranking report.'
    );

    const rows = classAbsences.rankings
      .map(
        (c: any, idx: number) =>
          `| ${idx + 1} | **${c.className || 'General'}** | **${c.absents}** | ${c.presents} | ${c.totalRecords} | **${c.attendanceRate}%** |`
      )
      .join('\n');

    return {
      text: `### 📉 Class Attendance & Absence Distribution (Ranked by Absences)\n\nEvaluated **${classAbsences.classesCount}** classes from database records:\n\n| Rank | Class | Absents Logged | Presents | Total Marked | Attendance Rate |\n|---|---|---|---|---|---|\n${rows}`,
      toolUsed: 'getClassAbsenceRankings',
      data: classAbsences,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // REPORT 3: Summary of pending fees / Fee financial summary
  // ----------------------------------------------------
  if (
    pLower.includes('summary of pending fees') ||
    pLower.includes('pending fees summary') ||
    pLower.includes('fee summary') ||
    pLower.includes('financial summary')
  ) {
    const feeSummary = await ControlledSchoolTools.getFeeSummary();
    const auditId = await recordAuditLog(
      context,
      'AI_REPORT_FEE_SUMMARY',
      'FEE',
      'Generated school financial fee summary report.'
    );

    return {
      text: `### 💰 School Fee Collections & Outstanding Balances Summary\n\n* **Total Amount Billed:** **PKR ${feeSummary.totalBilled.toLocaleString()}**\n* **Total Amount Collected:** **PKR ${feeSummary.totalPaid.toLocaleString()}**\n* **Total Outstanding Dues:** **PKR ${feeSummary.totalPending.toLocaleString()}**\n* **Overall Collection Rate:** **${feeSummary.collectionRate}%**\n\n#### 📄 Voucher Breakdown:\n* **Paid Vouchers:** ${feeSummary.paidCount}\n* **Partially Paid Vouchers:** ${feeSummary.partialCount}\n* **Unpaid / Overdue Vouchers:** ${feeSummary.unpaidCount}\n* **Total Issued:** ${feeSummary.voucherCount}`,
      toolUsed: 'getFeeSummary',
      data: feeSummary,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // REPORT 4: Fee defaulters by class
  // ----------------------------------------------------
  if (pLower.includes('defaulters by class') || (pLower.includes('unpaid') && pLower.includes('by class'))) {
    const defaulters = await ControlledSchoolTools.getFeeDefaultersByClass();
    const auditId = await recordAuditLog(
      context,
      'AI_REPORT_FEE_DEFAULTERS_BY_CLASS',
      'FEE',
      'Generated fee defaulters by class report.'
    );

    const rows = defaulters.defaultersByClass
      .map(
        (c: any) =>
          `| **${c.className || 'General'}** | **PKR ${c.totalDue.toLocaleString()}** | ${c.defaulterCount} voucher(s) |`
      )
      .join('\n');

    return {
      text: `### 📊 Outstanding Fee Distribution Across Classes\n\nFound **${defaulters.classesCount}** classes with pending fee balances:\n\n| Class Name | Total Pending Dues | Unpaid Vouchers |\n|---|---|---|\n${rows}`,
      toolUsed: 'getFeeDefaultersByClass',
      data: defaulters,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // REPORT 5: Student count by class / How many in each class
  // ----------------------------------------------------
  if (
    pLower.includes('in each class') ||
    pLower.includes('students by class') ||
    pLower.includes('enrollment by class') ||
    pLower.includes('student count by class')
  ) {
    const countData = await ControlledSchoolTools.getStudentCountByClass();
    const auditId = await recordAuditLog(
      context,
      'AI_REPORT_STUDENTS_BY_CLASS',
      'STUDENT',
      'Generated enrollment by class report.'
    );

    const rows = countData.classes
      .map(
        (c: any) =>
          `| **${c.className}** | **${c.total}** | ${c.male} | ${c.female} |`
      )
      .join('\n');

    return {
      text: `### 🎒 Student Enrollment Breakdown by Class\n\nTotal **${countData.totalStudents}** active students enrolled across the institution:\n\n| Class | Total Enrolled | Male Students | Female Students |\n|---|---|---|---|\n${rows}`,
      toolUsed: 'getStudentCountByClass',
      data: countData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // REPORT 6: Faculty count by subject
  // ----------------------------------------------------
  if (pLower.includes('teacher count by subject') || pLower.includes('faculty by subject')) {
    const teacherData = await ControlledSchoolTools.getTeacherCountBySubject();
    const auditId = await recordAuditLog(
      context,
      'AI_REPORT_TEACHER_COUNT_BY_SUBJECT',
      'TEACHER',
      'Generated teacher count by subject report.'
    );

    const rows = teacherData.subjects
      .map((s: any) => `| **${s.subject}** | **${s.count}** | ${s.teachers.join(', ')} |`)
      .join('\n');

    return {
      text: `### 👨‍🏫 Faculty Distribution by Subject\n\n| Subject Department | Faculty Count | Assigned Teachers |\n|---|---|---|\n${rows}`,
      toolUsed: 'getTeacherCountBySubject',
      data: teacherData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // REPORT 7: Exam Performance Summary
  // ----------------------------------------------------
  if (pLower.includes('exam performance') || pLower.includes('results summary')) {
    const examData = await ControlledSchoolTools.getExamPerformanceSummary();
    const auditId = await recordAuditLog(
      context,
      'AI_REPORT_EXAM_PERFORMANCE',
      'RESULT',
      'Generated exam performance summary.'
    );

    const rows = examData.topScorers
      .map(
        (t: any, idx: number) =>
          `| ${idx + 1} | **${t.studentName}** | ${t.className} | **${t.percentage}%** | Grade \`${t.grade}\` | ${t.examTitle} |`
      )
      .join('\n');

    return {
      text: `### 🏆 Academic Examination Performance Overview\n\n* **Total Evaluated Students:** **${examData.totalExamined}**\n* **Overall Institutional Average:** **${examData.averagePercentage}%**\n\n#### 🌟 Top Performing Students:\n| Rank | Student Name | Class | Score | Grade | Exam |\n|---|---|---|---|---|---|\n${rows}`,
      toolUsed: 'getExamPerformanceSummary',
      data: examData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // ATTENDANCE: Students with attendance below X%
  // ----------------------------------------------------
  if (
    pLower.includes('attendance below') ||
    pLower.includes('below 75') ||
    pLower.includes('low attendance') ||
    pLower.includes('poor attendance')
  ) {
    const match = pLower.match(/below\s+(\d+)/);
    const threshold = match ? parseInt(match[1], 10) : 75;
    const classMatch = prompt.match(/(?:class|grade)\s+(\d+|\w+)/i) || prompt.match(/\b(\d+)(?:th|st|nd|rd)\b/i);
    const targetClass = classMatch ? classMatch[0] : undefined;
    const lowAtt = await ControlledSchoolTools.getLowAttendanceStudents(threshold, targetClass);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_LOW_ATTENDANCE',
      'ATTENDANCE',
      `Found ${lowAtt.count} students with attendance below ${threshold}%${targetClass ? ` in ${targetClass}` : ''}.`
    );

    if (lowAtt.count === 0) {
      return {
        text: `✅ **Satisfactory Records:** No students${targetClass ? ` in **${targetClass}**` : ''} currently have attendance below **${threshold}%** in MongoDB Atlas.`,
        toolUsed: 'getLowAttendanceStudents',
        data: lowAtt,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const rows = lowAtt.students
      .map(
        s =>
          `| **${s.roll_no}** | **${s.name}** | ${s.father_name} | ${s.class_name} | **${s.percentage}%** | ${s.presents} / ${s.total_days} | ${s.phone} |`
      )
      .join('\n');

    return {
      text: `### ⚠️ Students With Attendance Below ${threshold}%${targetClass ? ` (${targetClass})` : ''}\n\nFound **${lowAtt.count}** students requiring administrative attention:\n\n| Roll | Student Name | Father Name | Class | Attendance % | Present/Total | Parent Contact |\n|---|---|---|---|---|---|---|\n${rows}`,
      toolUsed: 'getLowAttendanceStudents',
      data: lowAtt,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // ATTENDANCE: Date-Aware Absent Students (Today, Yesterday, etc.)
  // ----------------------------------------------------
  if (
    pLower.includes('absent today') ||
    pLower.includes('absent students') ||
    pLower.includes('how many students are absent') ||
    pLower.includes('how many students were absent') ||
    pLower.includes('who is absent')
  ) {
    const dateRange = parseNaturalDateRange(prompt);
    const absData = await ControlledSchoolTools.getTodayAbsentStudents(dateRange.dateStr);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_ABSENT_STUDENTS',
      'ATTENDANCE',
      `Found ${absData.count} absent students for date ${absData.date}.`
    );

    if (absData.count === 0) {
      return {
        text: `✅ **Full Attendance:** No students were recorded as absent on **${absData.date}** in MongoDB Atlas.`,
        toolUsed: 'getTodayAbsentStudents',
        data: absData,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const rows = absData.absents
      .map(
        a =>
          `| **${a.name}** | ${a.class_name} (${a.section}) | ${a.father_name} | ${a.phone} | \`${a.status}\` | ${a.remarks} |`
      )
      .join('\n');

    const headerNote = absData.isFallbackDate
      ? `### 📅 Absent Students on Record (${absData.lastMarkedDate})\n*Note: Today (${absData.date}) has no marked attendance session yet. Showing absents from the most recent session (${absData.lastMarkedDate}):*\n\n`
      : `### 📅 Absent Students on Record (${absData.date})\n\n`;

    return {
      text: `${headerNote}Total **${absData.count}** absent student(s) logged:\n\n| Student Name | Class | Father Name | Parent Phone | Status | Remarks |\n|---|---|---|---|---|---|\n${rows}`,
      toolUsed: 'getTodayAbsentStudents',
      data: absData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // FEES: Students with Unpaid Fees
  // ----------------------------------------------------
  if (
    pLower.includes('unpaid fee') ||
    pLower.includes('unpaid fees') ||
    pLower.includes('fee dues') ||
    pLower.includes('pending fees') ||
    pLower.includes('fee defaulters')
  ) {
    const feeData = await ControlledSchoolTools.getStudentsWithUnpaidFees();
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_UNPAID_FEES',
      'FEE',
      `Found ${feeData.count} students with unpaid fees totaling PKR ${feeData.grandTotalDue}.`
    );

    if (feeData.count === 0) {
      return {
        text: `✅ **All Cleared:** There are currently no students with unpaid or overdue fee vouchers in MongoDB Atlas.`,
        toolUsed: 'getStudentsWithUnpaidFees',
        data: feeData,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const rows = feeData.students
      .map(
        s =>
          `| **${s.rollNo}** | **${s.studentName}** | ${s.fatherName} | ${s.className} | **PKR ${s.totalDue.toLocaleString()}** | ${s.vouchers.length} voucher(s) | ${s.phone} |`
      )
      .join('\n');

    return {
      text: `### 💳 Students with Unpaid / Outstanding Fees\n\nFound **${feeData.count}** student(s) with pending dues totaling **PKR ${feeData.grandTotalDue.toLocaleString()}**:\n\n| Roll | Student Name | Father Name | Class | Total Due | Vouchers | Parent Phone |\n|---|---|---|---|---|---|---|\n${rows}`,
      toolUsed: 'getStudentsWithUnpaidFees',
      data: feeData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // ENROLLMENT: How many students are enrolled in Class X?
  // ----------------------------------------------------
  const enrollMatch = pLower.match(
    /(?:how many\s+(?:students|children)|enrollment|enrolled\s+in)\s+(class\s+\w+|grade\s+\w+|1st\s+year|2nd\s+year|\d+)/i
  );
  if (enrollMatch || (pLower.includes('enroll') && (pLower.includes('class') || pLower.includes('grade')))) {
    const targetClass = enrollMatch
      ? enrollMatch[1]
      : pLower.match(/class\s+\d+|grade\s+\d+/i)?.[0] || 'Class 8';
    const enrollData = await ControlledSchoolTools.getClassEnrollment(targetClass);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_CLASS_ENROLLMENT',
      'CLASS',
      `Checked enrollment for ${targetClass}: ${enrollData.totalEnrolled} students.`
    );

    const secText = Object.entries(enrollData.sectionBreakdown)
      .map(([sec, count]) => `Section ${sec}: ${count} student(s)`)
      .join(', ');

    return {
      text: `### 🎒 Enrollment Status: ${enrollData.className}\n\n* **Total Active Students Enrolled:** **${enrollData.totalEnrolled}**\n* **Gender Breakdown:** ${enrollData.genderBreakdown.male} Male(s), ${enrollData.genderBreakdown.female} Female(s)\n* **Sections:** ${secText || 'Section A'}\n\n*All records pulled directly from MongoDB Atlas Student collection.*`,
      toolUsed: 'getClassEnrollment',
      data: enrollData,
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // ATTENDANCE: Specific Student Attendance
  // ----------------------------------------------------
  if (
    pLower.includes('attendance') &&
    !pLower.includes('below') &&
    !pLower.includes('today') &&
    !pLower.includes('summary')
  ) {
    const cleanName =
      extractStudentTargetName(prompt) ||
      (context.activeEntity?.type === 'student' ? context.activeEntity.name || context.activeEntity.id : '') ||
      context.selectedId ||
      '';

    if (!cleanName) {
      return {
        text: 'Please specify which student you would like to view attendance for (by name, roll number, or admission number), or select a student from previous search results.',
        toolUsed: 'getStudentAttendance',
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const attRes: any = await ControlledSchoolTools.getStudentAttendance(cleanName, context);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_STUDENT_ATTENDANCE',
      'ATTENDANCE',
      `Checked attendance for ${cleanName}.`
    );

    if (!attRes.found) {
      return {
        text: attRes.message || `No matching record was found in the school database for "${cleanName}".`,
        toolUsed: 'getStudentAttendance',
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }
    if (attRes.disambiguationRequired) {
      return {
        text: attRes.message,
        toolUsed: 'getStudentAttendance',
        disambiguationRequired: true,
        candidates: attRes.candidates,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const a = attRes.attendance;
    return {
      text: `### 📊 Attendance Record: ${attRes.studentName}\n\n* **Class & Roll:** ${attRes.className} (Roll #${attRes.rollNo})\n* **Overall Attendance Rate:** **${a.percentage}%** (${a.statusLabel})\n* **Total Days Recorded:** ${a.totalDays}\n* **Presents:** ${a.presents} days\n* **Absents:** ${a.absents} days\n* **Leaves / Late:** ${a.leaves} days\n${a.recentAbsentDates.length > 0 ? `* **Recent Absent Dates:** ${a.recentAbsentDates.join(', ')}` : ''}`,
      toolUsed: 'getStudentAttendance',
      data: attRes,
      activeEntity: {
        type: 'student',
        id: attRes.studentId,
        name: attRes.studentName,
        className: attRes.className,
        rollNo: attRes.rollNo,
      },
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // FEES: Specific Student Fee Status
  // ----------------------------------------------------
  if (pLower.includes('fee') && (pLower.includes('owe') || pLower.includes('due') || pLower.includes('status'))) {
    const cleanName =
      extractStudentTargetName(prompt) ||
      (context.activeEntity?.type === 'student' ? context.activeEntity.name || context.activeEntity.id : '') ||
      context.selectedId ||
      '';

    if (!cleanName) {
      return {
        text: 'Please specify which student you would like to view fee status for (by name, roll number, or admission number), or select a student from previous search results.',
        toolUsed: 'getStudentFeeStatus',
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const feeRes: any = await ControlledSchoolTools.getStudentFeeStatus(cleanName, context);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_STUDENT_FEES',
      'FEE',
      `Checked fee status for ${cleanName}.`
    );

    if (!feeRes.found) {
      return {
        text: feeRes.message || `No matching record was found in the school database for "${cleanName}".`,
        toolUsed: 'getStudentFeeStatus',
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }
    if (feeRes.disambiguationRequired) {
      return {
        text: feeRes.message,
        toolUsed: 'getStudentFeeStatus',
        disambiguationRequired: true,
        candidates: feeRes.candidates,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const f = feeRes.fees;
    const voucherList = f.recentVouchers.length
      ? f.recentVouchers
          .map((v: any) => `* **${v.month} ${v.year}:** PKR ${v.amount.toLocaleString()} (Due: ${v.dueDate})`)
          .join('\n')
      : '* None (all vouchers paid)';

    return {
      text: `### 💰 Fee Balance Record: ${feeRes.studentName}\n\n* **Student:** ${feeRes.studentName} (${feeRes.className} - Roll #${feeRes.rollNo})\n* **Father Name:** ${feeRes.fatherName}\n* **Current Outstanding Dues:** **PKR ${f.pendingDue.toLocaleString()}** (\`${f.status}\`)\n* **Total Billed:** PKR ${f.totalBilled.toLocaleString()} | **Total Paid:** PKR ${f.totalPaid.toLocaleString()}\n* **Parent Contact:** ${feeRes.parentContact || 'Not available in database.'}\n\n#### 📄 Pending Vouchers:\n${voucherList}`,
      toolUsed: 'getStudentFeeStatus',
      data: feeRes,
      activeEntity: {
        type: 'student',
        id: feeRes.studentId,
        name: feeRes.studentName,
        className: feeRes.className,
        rollNo: feeRes.rollNo,
      },
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // FACULTY: Teacher Assigned Subjects
  // ----------------------------------------------------
  if (pLower.includes('subject') && (pLower.includes('teacher') || pLower.includes('assigned'))) {
    const cleanTeacher =
      extractTeacherTargetName(prompt) ||
      (context.activeEntity?.type === 'teacher' ? context.activeEntity.name || context.activeEntity.id : '') ||
      context.selectedId ||
      '';

    if (!cleanTeacher) {
      return {
        text: 'Please specify which teacher you would like to view assigned subjects for, or select a faculty member from the directory.',
        toolUsed: 'getTeacherAssignedSubjects',
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const subRes: any = await ControlledSchoolTools.getTeacherAssignedSubjects(cleanTeacher, context);
    const auditId = await recordAuditLog(
      context,
      'AI_QUERY_TEACHER_SUBJECTS',
      'TEACHER',
      `Checked subjects for teacher ${cleanTeacher}.`
    );

    if (!subRes.found || !subRes.teacherName) {
      return {
        text: subRes.message || `No matching record was found in the school database for "${cleanTeacher}".`,
        toolUsed: 'getTeacherAssignedSubjects',
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }
    if (subRes.disambiguationRequired) {
      return {
        text: subRes.message,
        toolUsed: 'getTeacherAssignedSubjects',
        disambiguationRequired: true,
        candidates: subRes.candidates,
        auditLogId: auditId,
        aiProviderStatus: getAiProviderStatus(),
      };
    }

    const subList = subRes.assignedSubjects?.length
      ? subRes.assignedSubjects
          .map((s: any) => `* **${s.name}** (${s.class}): ${s.weekly_periods} periods/week`)
          .join('\n')
      : `* ${subRes.primarySubject} across assigned classes (${subRes.classes.join(', ')})`;

    return {
      text: `### 📚 Assigned Subjects: ${subRes.teacherName}\n\n* **Faculty Member:** ${subRes.teacherName}\n* **Primary Specialization:** ${subRes.primarySubject}\n* **Classes Taught:** ${subRes.classes.join(', ')}\n\n#### 📖 Assigned Curriculum Load:\n${subList}`,
      toolUsed: 'getTeacherAssignedSubjects',
      data: subRes,
      activeEntity: {
        type: 'teacher',
        id: subRes.teacherId,
        name: subRes.teacherName,
        className: subRes.classes.join(', '),
      },
      auditLogId: auditId,
      aiProviderStatus: getAiProviderStatus(),
    };
  }

  // ----------------------------------------------------
  // GENERAL FALLBACK HELP (ZERO FABRICATION POLICY)
  // ----------------------------------------------------
  const providerStatus = getAiProviderStatus();
  const providerUnavailableBanner =
    providerStatus.configured && providerStatus.errorCode
      ? `\n\n> **AI Provider Notice:** ${providerStatus.message}`
      : '';

  const auditId = await recordAuditLog(
    context,
    'AI_QUERY_GENERAL',
    'GENERAL',
    `Processed administrative query via deterministic guide: "${prompt.substring(0, 80)}"`
  );

  return {
    text: `I am the **Shawan School and College Admin AI Assistant** connected strictly to authoritative MongoDB Atlas school collections (no fabricated or guessed records).\n\n### 💡 Supported Database Queries:\n* **Admissions:** *"Show new admitted students"*, *"Show recent admissions this month"*\n* **Student Records:** *"Give me the complete record of this student"*, *"Show student attendance and fee status"*, *"Show parent details for this student"*\n* **Faculty Dossiers:** *"Show teacher details and assigned classes"*, *"Show assigned subjects for teacher [Name]"*\n* **Multi-Tool Queries:** *"Show students who have attendance below 75% AND unpaid fees"*, *"Prepare a parent warning list for students below 75% attendance"*, *"Find parents of all students with unpaid fees"*\n* **School-Wide Reports:** *"Give me the school overview"*, *"Give me a summary of today's school attendance"*, *"Give me a summary of pending fees"*, *"Which classes have the highest number of absences?"*, *"How many students are in each class?"*\n* **Administrative Actions:** *"Draft fee reminder for students with unpaid fees"*, *"Send SMS alert to absent students"*${providerUnavailableBanner}`,
    toolUsed: 'generalHelp',
    auditLogId: auditId,
    aiProviderStatus: providerStatus,
    ...(providerStatus.configured && providerStatus.errorCode ? { error: providerStatus.errorCode } : {}),
  };
}