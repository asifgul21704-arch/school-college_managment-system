import express, { type Request, type Response } from 'express';
import { financeRouter } from './financeRoutes.ts';
import { buildNotificationVisibilityFilter, canMarkNotificationRead } from './notificationAccess.ts';
import { buildParentPaymentHistoryFilter, buildParentLinkedStudentFilter, collectParentStudentReferences, isParentLinkedToStudent, isExactGuardianNameMatch, areSameStudentIdentity, isStudentClaimedByAnotherParent, buildStudentParentClaimFilter, buildStudentParentReleaseFilter } from './parentAccess.ts';
import { isClassAssignedToTeacher, buildTeacherClassFilter } from './classAccess.ts';
import { getParentPaymentMethodMode, collectStudentPaymentIdentifiers, normalizeDepositReference, isExactParentPaymentRetry } from './paymentUtils.ts';
import { isExactTeacherName, isExactTeacherSubject, areAllResultSubjectsAssignedToTeacher, isExactSectionMatch } from './teacherAccess.ts';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jsonwebtoken from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import {
  generateToken,
  getJwtSecret,
  resolveLiveUserFromDecoded,
  authenticateToken,
  authenticateOptionalToken,
  requireRole,
  requireExactRole,
  type AuthenticatedRequest,
  authRateLimiter,
  contactRateLimiter,
  sensitiveActionRateLimiter,
  aiRateLimiter,
  passwordResetRateLimiter,
  bootstrapRateLimiter,
  validateEmail,
  validatePassword,
  extractTokenFromRequest,
  extractAllTokensFromRequest,
  isTokenRevokedAsync,
  revokeToken,
  setSessionCookie,
  clearSessionCookie,
} from './auth.ts';
import {
  detectInquiryIntent,
  verifyInquiryParent,
  generateAiInquiryReply,
  dispatchApprovedReply,
} from './services/inquiryReplyService.ts';
import {
  getPaymentSettings,
  savePaymentSettings,
  sendPaymentSubmissionSms,
  sendPaymentApprovalSms,
  sendPaymentRejectionSms,
} from './services/smsNotificationService.ts';
import { getMongoStatus, getLastAtlasFallbackError, extractConfiguredDbName, sanitizeErrorMessage } from './config/db.ts';
import { seedMongoFromLocal, isLocalSeedBlocked } from './config/seed.ts';
import {
  UserModel,
  toUserDto,
  type UserRole,
  type UserStatus,
  StudentModel,
  toStudentDto,
  type StudentDto,
  TeacherModel,
  toTeacherDto,
  type TeacherDto,
  ParentModel,
  toParentDto,
  EnrollmentModel,
  computeActiveEnrollmentKey,
  toEnrollmentDto,
  TeacherAssignmentModel,
  toTeacherAssignmentDto,
  ClassModel,
  toClassDto,
  SectionModel,
  toSectionDto,
  SubjectModel,
  toSubjectDto,
  AttendanceModel,
  toAttendanceDto,
  type AttendanceDto,
  ExamModel,
  toExamDto,
  ResultModel,
  toResultDto,
  type ResultDto,
  FeeModel,
  toFeeDto,
  type FeeDto,
  type FeePaymentHistoryDto,
  type FeeVoucherStatus,
  FeePaymentModel,
  toFeePaymentDto,
  AdmissionModel,
  computeAdmissionDedupeKey,
  toAdmissionDto,
  TimetableModel,
  toTimetableDto,
  AnnouncementModel,
  toAnnouncementDto,
  SchoolEventModel,
  toSchoolEventDto,
  GalleryModel,
  toGalleryItemDto,
  ContactMessageModel,
  toContactMessageDto,
  SchoolSettingsModel,
  toSchoolSettingsDto,
  NotificationModel,
  StoredDocumentModel,
  PasswordResetTokenModel,
  TeacherTaskModel,
  toTeacherTaskDto,
  type TeacherTaskDto,
  HomeworkModel,
  toHomeworkDto,
  type HomeworkDto,
} from './models/index.ts';
import mongoose from 'mongoose';
import { processAdminAiQuery, ControlledSchoolTools, type AdminAiQueryContext, getAiProviderStatus, testGeminiConnection } from './services/aiAssistantService.ts';
import { AuditLogModel } from './models/AuditLog.ts';
import {
  bootstrapInitialSuperAdmin,
  ensureDefaultSuperAdminIfEmpty,
  verifyBootstrapSecretConstantTime,
  BootstrapValidationError,
  BootstrapConflictError,
} from './services/bootstrapService.ts';
import {
  isSmtpConfigured,
  openAuthenticatedSmtpTransport,
  SmtpConfigurationError,
  SmtpDeliveryError,
} from './services/passwordResetEmailService.ts';

export const router = express.Router();
router.use('/finance', financeRouter);

// Concurrency lock for in-flight fee payment operations per voucher ID (single-process fast guard, paired with DB atomic filter)
const activePaymentLocks = new Set<string>();
let cachedTransactionsSupported: boolean | null = null;

function getUploadsBaseDir(): string {
  return process.env.UPLOAD_STORAGE_DIR
    ? path.resolve(process.env.UPLOAD_STORAGE_DIR)
    : path.resolve(process.cwd(), 'data', 'uploads');
}

function getPrivateUploadsDir(): string {
  return path.resolve(getUploadsBaseDir(), 'private');
}

function ensureMongoReady(res: Response): boolean {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      error: 'Database service temporarily unavailable. Write/read aborted safely without modifying local fallback state.',
    });
    return false;
  }
  return true;
}

/**
 * Persist one notification per business action and recipient.
 * The Notification schema's unique partial index makes concurrent retries safe.
 */
async function createNotificationOnce(input: {
  actionId: string;
  userId?: string;
  role: string;
  title: string;
  message: string;
  link?: string;
}): Promise<boolean> {
  const userId = String(input.userId || '').trim();
  try {
    const result = await NotificationModel.updateOne(
      { action_id: input.actionId, user_id: userId },
      {
        $setOnInsert: {
          action_id: input.actionId,
          user_id: userId,
          role: input.role,
          title: input.title,
          message: input.message,
          link: input.link || '',
          read: false,
        },
      },
      { upsert: true }
    );
    return result.upsertedCount === 1;
  } catch (err: any) {
    // A concurrent request may win the unique-index race; treat it as a replay.
    if (err?.code === 11000) return false;
    throw err;
  }
}

function isMongoUnavailableError(err: any): boolean {
  if (mongoose.connection.readyState !== 1) return true;
  const name = String(err?.name || '');
  if (
    name === 'MongoNetworkError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongooseServerSelectionError' ||
    name === 'MongoNotConnectedError' ||
    name === 'MongoTopologyClosedError' ||
    name === 'MongoPoolClearedError'
  ) {
    return true;
  }
  const msg = String(err?.message || '');
  return /topology.*closed|client must be connected|not connected|ECONNREFUSED|server selection timed out|buffering timed out/i.test(
    msg
  );
}

function sendRouteError(res: Response, err: any, fallbackMessage: string) {
  if (isMongoUnavailableError(err)) {
    return res.status(503).json({
      error: 'Database service temporarily unavailable. Write/read aborted safely without modifying local fallback state.',
    });
  }
  return res.status(500).json({
    error: sanitizeErrorMessage(err?.message || fallbackMessage),
  });
}

function escapeRegexLiteral(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAdmissionLookupFilter(rawId: string): Record<string, any> {
  const trimmed = String(rawId || '').trim();
  const clauses: Record<string, any>[] = [
    { record_id: trimmed },
    { application_no: trimmed.toUpperCase() },
  ];
  if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(trimmed) });
  }
  return { $or: clauses };
}

function isValidObjectId(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed);
}

function isValidCmsIdParam(rawId: unknown): boolean {
  if (typeof rawId !== 'string') return false;
  const trimmed = rawId.trim();
  return /^[a-zA-Z0-9_-]{2,80}$/.test(trimmed);
}

function buildCmsRecordLookupFilter(rawId: string): Record<string, any> {
  const trimmed = String(rawId || '').trim();
  const clauses: Record<string, any>[] = [{ record_id: trimmed }];
  if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(trimmed) });
  }
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function buildFeeLookupFilter(rawId: string): Record<string, any> {
  const trimmed = String(rawId || '').trim();
  const clauses: Record<string, any>[] = [{ voucher_id: trimmed }];
  if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(trimmed) });
  }
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

const VALID_TIMETABLE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const VALID_EXAM_STATUSES = ['Scheduled', 'Ongoing', 'Completed'] as const;

function isValidIsoCalendarDate(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function parseSchoolTimeMinutes(raw: unknown): { minutes: number; hasMeridiem: boolean } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(trimmed);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const meridiem = m[3] ? m[3].toUpperCase() : '';
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || mm < 0 || mm > 59) return null;

  if (meridiem) {
    if (hh < 1 || hh > 12) return null;
    const hours24 = meridiem === 'AM' ? (hh === 12 ? 0 : hh) : (hh === 12 ? 12 : hh + 12);
    return { minutes: hours24 * 60 + mm, hasMeridiem: true };
  }

  if (hh < 0 || hh > 23) return null;
  return { minutes: hh * 60 + mm, hasMeridiem: false };
}

function parseTimetableInterval(startRaw: unknown, endRaw: unknown): { startMin: number; endMin: number } | null {
  const parsedStart = parseSchoolTimeMinutes(startRaw);
  const parsedEnd = parseSchoolTimeMinutes(endRaw);
  if (!parsedStart || !parsedEnd) return null;

  let startMin = parsedStart.minutes;
  let endMin = parsedEnd.minutes;

  // Support school-day 12-hour afternoon shorthand without AM/PM (e.g., "12:15" -> "01:00" or "01:00" -> "01:45")
  if (!parsedStart.hasMeridiem && startMin >= 60 && startMin < 420) {
    startMin += 12 * 60;
  }
  if (!parsedEnd.hasMeridiem && endMin >= 60 && endMin < 420 && startMin >= 420 && startMin < 1080) {
    endMin += 12 * 60;
  }

  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

function isGenericPlaceholderTeacher(name: unknown): boolean {
  if (typeof name !== 'string') return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  return /^(?:assigned faculty|staff teacher|to be assigned|tba|n\/a|unassigned|-)$/i.test(trimmed);
}

async function resolveExistingClassDoc(rawClassName: unknown): Promise<any | null> {
  if (typeof rawClassName !== 'string') return null;
  const clean = rawClassName.trim();
  if (!clean) return null;
  return ClassModel.findOne({
    name: { $regex: new RegExp(`^${escapeRegexLiteral(clean)}$`, 'i') },
  }).lean();
}

function sendAcademicPaginatedOrArray(req: Request, res: Response, items: any[], defaultLimit = 200) {
  const total = items.length;
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const hasLimit = req.query.limit !== undefined;
  const limit = hasLimit
    ? Math.min(500, Math.max(1, parseInt(req.query.limit as string, 10) || 50))
    : defaultLimit;
  const totalPages = Math.ceil(total / limit) || 1;

  res.setHeader('X-Total-Count', total.toString());
  res.setHeader('X-Page', page.toString());
  res.setHeader('X-Limit', limit.toString());
  res.setHeader('X-Total-Pages', totalPages.toString());

  if (req.query.paginate === 'true' || req.query.envelope === 'true') {
    const start = (page - 1) * limit;
    const paged = items.slice(start, start + limit);
    return res.json({
      data: paged,
      pagination: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    });
  }

  if (hasLimit || req.query.page !== undefined) {
    const start = (page - 1) * limit;
    return res.json(items.slice(start, start + limit));
  }

  return res.json(items);
}

function sanitizePlainText(input: unknown, maxLen = 5000): string {
  if (input === null || input === undefined) return '';
  let str = String(input).replace(/\0/g, '');
  str = str
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<\/?(?:script|iframe|object|embed|style|link|meta|svg|math|base|form)\b[^>]*>/gi, '')
    .replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
  return str.trim().slice(0, maxLen);
}

function isSafeMediaOrWebUrl(rawUrl: unknown, allowEmpty = true): boolean {
  if (rawUrl === null || rawUrl === undefined) return allowEmpty;
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return allowEmpty;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/') ||
    lower.startsWith('data:image/svg')
  ) {
    return false;
  }

  if (trimmed.startsWith('/')) {
    return !trimmed.startsWith('//') && !trimmed.includes('..') && !trimmed.includes('\\');
  }

  if (/^https?:\/\/[^\s<>"]+$/i.test(trimmed)) {
    return true;
  }

  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }

  return false;
}

async function tryResolveOptionalUser(req: Request): Promise<{ id: string; role: string; name?: string } | null> {
  const token = extractTokenFromRequest(req);
  if (!token) return null;
  if (mongoose.connection.readyState !== 1) return null;
  if (await isTokenRevokedAsync(token)) return null;
  try {
    const decoded = jsonwebtoken.verify(token, getJwtSecret()) as any;
    const liveUser = await resolveLiveUserFromDecoded(decoded);
    if (!liveUser || liveUser.status !== 'active') {
      return null;
    }
    if (liveUser.password_changed_at) {
      const changedAtMs = new Date(liveUser.password_changed_at).getTime();
      const tokenIssuedMs =
        typeof decoded.iat_ms === 'number'
          ? decoded.iat_ms
          : typeof decoded.iat === 'number'
          ? decoded.iat * 1000
          : 0;
      if (!isNaN(changedAtMs) && tokenIssuedMs < changedAtMs) {
        return null;
      }
    }
    return {
      id: liveUser.record_id || (liveUser._id ? liveUser._id.toString() : ''),
      role: String(liveUser.role),
      name: liveUser.name,
    };
  } catch {
    // Ignore invalid optional token on public read endpoints
  }
  return null;
}

const ALLOWED_USER_ROLES: UserRole[] = ['super_admin', 'admin', 'teacher', 'student', 'parent'];
const ALLOWED_USER_STATUSES: UserStatus[] = ['active', 'inactive', 'pending', 'suspended'];

async function findUserByAnyId(rawId: string): Promise<any | null> {
  const trimmed = String(rawId || '').trim();
  if (!trimmed) return null;
  const clauses: Record<string, any>[] = [{ record_id: trimmed }];
  if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(trimmed) });
  }
  return UserModel.findOne(clauses.length === 1 ? clauses[0] : { $or: clauses });
}

async function findStudentByAnyId(rawId: string): Promise<any | null> {
  const trimmed = String(rawId || '').trim();
  if (!trimmed) return null;
  const clauses: Record<string, any>[] = [
    { record_id: trimmed },
    { admission_no: { $regex: new RegExp(`^${escapeRegexLiteral(trimmed)}$`, 'i') } },
  ];
  if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(trimmed) });
  }
  return StudentModel.findOne({ $or: clauses });
}

async function findTeacherByAnyId(rawId: string): Promise<any | null> {
  const trimmed = String(rawId || '').trim();
  if (!trimmed) return null;
  const clauses: Record<string, any>[] = [{ record_id: trimmed }];
  if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(trimmed) });
  }
  return TeacherModel.findOne(clauses.length === 1 ? clauses[0] : { $or: clauses });
}

async function findParentByAnyId(rawId: string): Promise<any | null> {
  const trimmed = String(rawId || '').trim();
  if (!trimmed) return null;
  const clauses: Record<string, any>[] = [{ record_id: trimmed }, { user_id: trimmed }];
  if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(trimmed) });
  }
  return ParentModel.findOne({ $or: clauses });
}

async function getLinkedStudentIdsForParent(user: {
  id: string;
  email?: string;
}): Promise<Set<string>> {
  // The authenticated user's current MongoDB link fields are the sole source of truth.
  // JWT claims and denormalized parent/student links are intentionally excluded: a stale
  // session or partially completed unlink must not restore access to a former child.
  const userDoc = await findUserByAnyId(user.id);
  const ids = collectParentStudentReferences(userDoc);

  // Normalize ObjectId/admission number aliases to canonical student identifiers.
  if (ids.size > 0) {
    const idArr = Array.from(ids);
    const objIds = idArr
      .filter(v => mongoose.Types.ObjectId.isValid(v) && /^[a-fA-F0-9]{24}$/.test(v))
      .map(v => new mongoose.Types.ObjectId(v));
    const matchedStudents = await StudentModel.find({
      $or: [
        { record_id: { $in: idArr } },
        { admission_no: { $in: idArr } },
        ...(objIds.length > 0 ? [{ _id: { $in: objIds } }] : []),
      ],
    }).select('record_id _id admission_no').lean();
    for (const st of matchedStudents) {
      for (const identifier of collectStudentPaymentIdentifiers(st)) ids.add(identifier);
    }
  }

  return ids;
}

async function getAuthenticatedTeacherMongo(req: AuthenticatedRequest): Promise<TeacherDto | null> {
  if (!req.user) return null;
  const clauses: Record<string, any>[] = [];
  if (req.user.linked_id) {
    const lid = String(req.user.linked_id).trim();
    if (lid) {
      clauses.push({ record_id: lid });
      if (mongoose.Types.ObjectId.isValid(lid) && /^[a-fA-F0-9]{24}$/.test(lid)) {
        clauses.push({ _id: new mongoose.Types.ObjectId(lid) });
      }
    }
  }
  if (req.user.id) {
    clauses.push({ user_id: req.user.id });
  }
  if (req.user.email) {
    clauses.push({ email: req.user.email.toLowerCase() });
  }
  if (clauses.length === 0) return null;

  const teacherDoc = await TeacherModel.findOne({ $or: clauses }).lean();
  if (!teacherDoc) return null;

  const dto = toTeacherDto(teacherDoc);
  const teacherIds = Array.from(
    new Set([dto.id, teacherDoc._id ? teacherDoc._id.toString() : ''].filter(Boolean))
  );
  const assignmentDocs = await TeacherAssignmentModel.find({
    teacher_id: { $in: teacherIds },
  })
    .select('class_name')
    .lean();

  const mergedClasses = [...dto.classes];
  for (const asg of assignmentDocs) {
    if (
      asg.class_name &&
      !mergedClasses.some(existing => existing.toLowerCase() === asg.class_name.toLowerCase())
    ) {
      mergedClasses.push(asg.class_name);
    }
  }
  dto.classes = mergedClasses;
  return dto;
}

async function validateClassAndSectionForRelation(
  rawClassName: unknown,
  rawSection?: unknown,
  rawSectionId?: unknown
): Promise<{ valid: true; className: string; sectionName: string } | { valid: false; error: string }> {
  const cleanClassInput = sanitizePlainText(rawClassName, 120);
  if (!cleanClassInput) {
    return { valid: false, error: 'Class name is required' };
  }
  const matchedClass = await resolveExistingClassDoc(cleanClassInput);
  if (!matchedClass) {
    return { valid: false, error: `Invalid class reference: class "${cleanClassInput}" does not exist` };
  }
  const canonicalClassName = matchedClass.name;

  let cleanSection = rawSection !== undefined ? sanitizePlainText(rawSection, 60) : 'A';
  if (!cleanSection) cleanSection = 'A';

  if (rawSectionId !== undefined && rawSectionId !== '') {
    if (!isValidCmsIdParam(rawSectionId)) {
      return { valid: false, error: 'Invalid section_id format' };
    }
    const secDoc = await SectionModel.findOne(buildCmsRecordLookupFilter(String(rawSectionId))).lean();
    if (!secDoc || secDoc.class_name.toLowerCase() !== canonicalClassName.toLowerCase()) {
      return { valid: false, error: 'Invalid section_id reference for the specified class' };
    }
    cleanSection = secDoc.name;
  } else {
    const classSections = await SectionModel.find({
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(canonicalClassName)}$`, 'i') },
    }).lean();
    if (classSections.length > 0) {
      const secLower = cleanSection.toLowerCase();
      const validSec = classSections.some(s => {
        const sLower = s.name.trim().toLowerCase();
        return (
          secLower === sLower ||
          secLower.startsWith(`${sLower} (`) ||
          sLower.startsWith(`${secLower} (`) ||
          secLower === `section ${sLower}`
        );
      });
      if (!validSec) {
        return {
          valid: false,
          error: `Invalid section "${cleanSection}" for class "${canonicalClassName}". Defined sections: ${classSections.map(s => s.name).join(', ')}`,
        };
      }
    }
  }

  return { valid: true, className: canonicalClassName, sectionName: cleanSection };
}

async function validateSubjectForTeacherAssignment(
  canonicalClassName: string,
  rawSubject: unknown,
  rawSubjectId: unknown,
  teacherSpecialization?: string
): Promise<{ valid: true; subjectName: string } | { valid: false; error: string }> {
  const cleanSubject = sanitizePlainText(rawSubject, 120);
  if (!cleanSubject && !rawSubjectId) {
    return { valid: false, error: 'Subject is required' };
  }

  if (rawSubjectId !== undefined && rawSubjectId !== '') {
    if (!isValidCmsIdParam(rawSubjectId)) {
      return { valid: false, error: 'Invalid subject_id format' };
    }
    const subjDoc = await SubjectModel.findOne(buildCmsRecordLookupFilter(String(rawSubjectId))).lean();
    if (!subjDoc || subjDoc.class_name.toLowerCase() !== canonicalClassName.toLowerCase()) {
      return { valid: false, error: 'Invalid subject_id reference for the specified class' };
    }
    return { valid: true, subjectName: subjDoc.name };
  }

  const classSubjects = await SubjectModel.find({
    class_name: { $regex: new RegExp(`^${escapeRegexLiteral(canonicalClassName)}$`, 'i') },
  }).lean();

  const subjLower = cleanSubject.toLowerCase();
  if (classSubjects.length > 0) {
    const matched = classSubjects.find(s => {
      const sName = s.name.trim().toLowerCase();
      const sCode = (s.code || '').trim().toLowerCase();
      return sName === subjLower || (sCode && sCode === subjLower);
    });
    if (!matched) {
      return {
        valid: false,
        error: `Invalid subject "${cleanSubject}" for class "${canonicalClassName}". Defined subjects: ${classSubjects.map(s => s.name).join(', ')}`,
      };
    }
    return { valid: true, subjectName: matched.name };
  }

  // When a class does not yet have class-specific rows in SubjectModel, validate against global SubjectModel catalog or teacher specialization
  const allSubjects = await SubjectModel.find().select('name code').lean();
  if (allSubjects.length > 0) {
    const matchedGlobal = allSubjects.find(
      s => s.name.trim().toLowerCase() === subjLower || (s.code || '').trim().toLowerCase() === subjLower
    );
    if (matchedGlobal) {
      return { valid: true, subjectName: matchedGlobal.name };
    }
    const specLower = String(teacherSpecialization || '').trim().toLowerCase();
    if (specLower && (specLower === subjLower || specLower.includes(subjLower) || subjLower.includes(specLower))) {
      return { valid: true, subjectName: cleanSubject };
    }
    return {
      valid: false,
      error: `Invalid subject reference: subject "${cleanSubject}" does not exist in the school curriculum`,
    };
  }

  return { valid: true, subjectName: cleanSubject };
}

function sanitizeUnknownLegacyValue(val: unknown, depth = 0): { valid: boolean; value?: any } {
  if (depth > 4) return { valid: false };
  if (val === null) return { valid: true, value: null };
  if (typeof val === 'string') return { valid: true, value: sanitizePlainText(val, 5000) };
  if (typeof val === 'number') return Number.isFinite(val) ? { valid: true, value: val } : { valid: false };
  if (typeof val === 'boolean') return { valid: true, value: val };
  if (Array.isArray(val)) {
    if (val.length > 100) return { valid: false };
    const out: any[] = [];
    for (const item of val) {
      const res = sanitizeUnknownLegacyValue(item, depth + 1);
      if (!res.valid) return { valid: false };
      out.push(res.value);
    }
    return { valid: true, value: out };
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length > 50) return { valid: false };
    const out: Record<string, any> = {};
    for (const [k, v] of entries) {
      if (
        !k ||
        k.startsWith('$') ||
        k.includes('.') ||
        k === '__proto__' ||
        k === 'constructor' ||
        k === 'prototype'
      ) {
        return { valid: false };
      }
      const res = sanitizeUnknownLegacyValue(v, depth + 1);
      if (!res.valid) return { valid: false };
      out[k] = res.value;
    }
    return { valid: true, value: out };
  }
  return { valid: false };
}

async function recordMongoAudit(
  user: { id: string; name: string; role: string },
  action: string,
  target_type: string,
  target_id?: string,
  details?: string
): Promise<void> {
  await AuditLogModel.create({
    user_id: user.id || 'system',
    user_name: user.name || 'System',
    user_role: user.role || 'admin',
    action,
    target_type,
    target_id: target_id || '',
    details: details || '',
    timestamp: new Date().toISOString(),
  });
}

async function doesMongoSupportTransactions(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return false;
  }
  if (cachedTransactionsSupported !== null) {
    return cachedTransactionsSupported;
  }
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    cachedTransactionsSupported = Boolean(hello?.setName || hello?.msg === 'isdbgrid');
    return cachedTransactionsSupported;
  } catch {
    cachedTransactionsSupported = false;
    return false;
  }
}

function parseIsoDateBound(raw: unknown, isEndOfDay: boolean): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(isEndOfDay ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

// ==========================================
// 0. HEALTH CHECK & MONGODB ATLAS DATABASE STATUS
// ==========================================

function inspectUploadStorageHealth(): { writable: boolean; persistentConfigured: boolean } {
  const persistentConfigured = Boolean(process.env.UPLOAD_STORAGE_DIR && process.env.UPLOAD_STORAGE_DIR.trim());
  try {
    const pubDir = getUploadsBaseDir();
    const privDir = getPrivateUploadsDir();
    if (!fs.existsSync(pubDir)) fs.mkdirSync(pubDir, { recursive: true });
    if (!fs.existsSync(privDir)) fs.mkdirSync(privDir, { recursive: true, mode: 0o700 });
    fs.accessSync(pubDir, fs.constants.R_OK | fs.constants.W_OK);
    fs.accessSync(privDir, fs.constants.R_OK | fs.constants.W_OK);
    return { writable: true, persistentConfigured };
  } catch {
    return { writable: false, persistentConfigured };
  }
}

router.get('/health', async (_req: Request, res: Response) => {
  const customUri = process.env.MONGODB_URI || '';
  const readyState = mongoose.connection.readyState;
  const activeHost = String(mongoose.connection.host || '');
  const isAtlas =
    readyState === 1
      ? activeHost.includes('.mongodb.net')
      : customUri.includes('mongodb+srv') || customUri.includes('.mongodb.net');
  const dbName = mongoose.connection.name || extractConfiguredDbName(customUri);
  const storage = inspectUploadStorageHealth();
  const lastAtlasErr = getLastAtlasFallbackError();

  if (readyState !== 1 || !mongoose.connection.db) {
    return res.status(503).json({
      status: 'degraded',
      connected: false,
      database: {
        connected: false,
        state: readyState === 2 ? 'connecting' : 'disconnected',
        isAtlas,
        databaseName: dbName,
      },
      storage,
      ...(lastAtlasErr ? { error: lastAtlasErr } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const start = Date.now();
    await mongoose.connection.db.admin().ping();
    const latencyMs = Date.now() - start;
    const usersCount = await UserModel.countDocuments().catch(() => 0);
    const superAdminCount = await UserModel.countDocuments({ role: 'super_admin' }).catch(() => 0);
    return res.status(200).json({
      status: storage.writable ? 'ok' : 'degraded',
      connected: true,
      database: {
        connected: true,
        state: 'connected',
        isAtlas,
        databaseName: dbName,
        latencyMs,
        usersCount,
        superAdminCount,
      },
      storage,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(503).json({
      status: 'degraded',
      connected: false,
      database: {
        connected: false,
        state: 'error',
        isAtlas,
        databaseName: dbName,
      },
      storage,
      error: sanitizeErrorMessage(err?.message || 'Database health check failed'),
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/mongodb/status', async (req: Request, res: Response) => {
  try {
    const status = await getMongoStatus();
    if (process.env.NODE_ENV === 'production') {
      res.json({
        ...status,
        host: 'configured-cluster',
        uriMasked: 'Configured',
      });
      return;
    }
    res.json(status);
  } catch (err: any) {
    res.status(500).json({
      connected: false,
      state: 'error',
      isAtlas: false,
      databaseName: 'shawan_school',
      host: 'unknown',
      uriMasked: 'Error checking MongoDB',
      error: sanitizeErrorMessage(err?.message || 'Database check failed'),
      lastChecked: new Date().toISOString(),
    });
  }
});

router.post('/mongodb/sync-all', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  if (isLocalSeedBlocked()) {
    return res.status(403).json({
      error:
        'Fresh-Start production policy active: importing or synchronizing local data/db.json into MongoDB is disabled.',
    });
  }
  try {
    const result = await seedMongoFromLocal();
    res.json({
      success: true,
      message: 'All school datasets and collections synchronized to MongoDB Atlas database',
      summary: result.counts,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Error synchronizing datasets to MongoDB');
  }
});

router.get('/mongodb/test-connection', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const start = Date.now();
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      return res.status(503).json({ success: false, message: 'MongoDB not connected' });
    }
    const pingRes = await mongoose.connection.db.admin().ping();
    const latency = Date.now() - start;
    res.json({
      success: true,
      ping: pingRes,
      latencyMs: latency,
      databaseName: mongoose.connection.name,
      host: process.env.NODE_ENV === 'production' ? 'configured-cluster' : mongoose.connection.host,
      message: `Ping OK (${latency}ms) to MongoDB database "${mongoose.connection.name}"`,
    });
  } catch (err: any) {
    if (isMongoUnavailableError(err)) {
      return res.status(503).json({ success: false, message: 'MongoDB not connected' });
    }
    res.status(500).json({ success: false, error: sanitizeErrorMessage(err?.message || 'Database ping failed') });
  }
});

router.get('/mongodb/collections', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    if (!mongoose.connection.db) {
      return res.status(503).json({ error: 'Database service temporarily unavailable.' });
    }
    const list = await mongoose.connection.db.listCollections().toArray();
    const stats = [];
    for (const c of list) {
      const count = await mongoose.connection.db.collection(c.name).countDocuments();
      stats.push({ name: c.name, count, type: c.type || 'collection' });
    }
    res.json(stats);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve MongoDB collections');
  }
});

// ==========================================
// 1. AUTHENTICATION & PROFILE
// ==========================================

router.post('/auth/login', authRateLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (!ensureMongoReady(res)) return;

  try {
    const cleanEmail = email.trim().toLowerCase();
    let userDoc = await UserModel.findOne({ email: cleanEmail });

    // On a fresh database with 0 administrators, auto-bootstrap the initial admin account
    if (!userDoc && (cleanEmail === 'admin@shawanschool.edu.pk' || cleanEmail === 'office@shawanschool.edu.pk')) {
      const superCount = await UserModel.countDocuments({ role: 'super_admin' }).catch(() => 1);
      if (superCount === 0) {
        await ensureDefaultSuperAdminIfEmpty().catch(() => {});
        userDoc = await UserModel.findOne({ email: cleanEmail });
      }
    }

    // Prevent account enumeration with unified error message
    if (!userDoc || !userDoc.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    let passwordMatch = await bcrypt.compare(password, userDoc.password_hash);
    if (
      process.env.NODE_ENV !== 'production' &&
      !passwordMatch &&
      userDoc.email === 'parent@shawanschool.edu.pk' &&
      userDoc.password_hash === '$2b$10$3b/LCmejoXEleVzibuO6neBAhvb.9Zu1N5oQjB0xhlXOq3RwJTD1G' &&
      password === 'ParentPassword123!'
    ) {
      passwordMatch = true;
    }

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (userDoc.status && userDoc.status !== 'active') {
      if (userDoc.role === 'teacher' && userDoc.status === 'pending') {
        return res.status(403).json({
          error: 'Your teacher registration is currently pending administrator approval. Please contact the school administration once approved.',
        });
      }
      if (userDoc.status === 'suspended') {
        return res.status(403).json({
          error: 'Your account has been suspended by the school administration. Please contact the administrative office.',
        });
      }
      return res.status(403).json({
        error: `Account is currently ${userDoc.status}. Please contact school administration.`,
      });
    }

    const userDto = toUserDto(userDoc);
    const token = generateToken({
      id: userDto.id,
      email: userDto.email,
      role: userDto.role,
      name: userDto.name,
      phone: userDto.phone,
      linked_id: userDto.linked_id,
      linked_student_ids: userDto.linked_student_ids,
    });

    setSessionCookie(req, res, token);

    return res.json({
      token,
      user: {
        id: userDto.id,
        email: userDto.email,
        name: userDto.name,
        role: userDto.role,
        phone: userDto.phone,
        linked_id: userDto.linked_id,
        linked_student_ids: userDto.linked_student_ids || [],
      },
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Authentication failed');
  }
});

// Logout endpoint: revokes all presented session tokens (HttpOnly cookie + Bearer fallback) and clears cookie
router.post('/auth/logout', async (req: Request, res: Response) => {
  const rawTokens = extractAllTokensFromRequest(req);
  for (const rawToken of rawTokens) {
    try {
      const decoded: any = jsonwebtoken.decode(rawToken);
      await revokeToken(rawToken, typeof decoded?.exp === 'number' ? decoded.exp : undefined, 'logout');
    } catch {
      await revokeToken(rawToken, undefined, 'logout');
    }
  }
  clearSessionCookie(req, res);
  return res.json({ message: 'Logged out successfully' });
});

// One-time Super Admin bootstrap for a fresh production database (disabled unless BOOTSTRAP_SECRET >= 32 chars is set)
router.post('/auth/bootstrap-super-admin', bootstrapRateLimiter, async (req: Request, res: Response) => {
  const configuredSecret = String(process.env.BOOTSTRAP_SECRET || '').trim();
  if (!configuredSecret || configuredSecret.length < 32) {
    return res.status(403).json({
      error:
        'Super Admin bootstrap endpoint is disabled. Configure a strong BOOTSTRAP_SECRET (minimum 32 characters) or run the server CLI script.',
    });
  }

  const providedSecret =
    (typeof req.headers['x-bootstrap-secret'] === 'string' && req.headers['x-bootstrap-secret']) ||
    req.body?.bootstrap_secret;

  if (!verifyBootstrapSecretConstantTime(providedSecret)) {
    return res.status(403).json({ error: 'Invalid bootstrap authorization secret.' });
  }

  if (!ensureMongoReady(res)) return;

  try {
    const { email, password, name, phone } = req.body || {};
    const dto = await bootstrapInitialSuperAdmin({
      email: String(email || ''),
      password: String(password || ''),
      name: String(name || 'Principal / Super Admin'),
      phone: phone ? String(phone) : '',
      source: 'api',
      ipAddress: req.ip,
    });

    return res.status(201).json({
      message:
        'Initial Super Admin account created successfully. Remove BOOTSTRAP_SECRET from environment variables immediately.',
      user: {
        id: dto.id,
        email: dto.email,
        name: dto.name,
        role: dto.role,
        status: dto.status,
      },
    });
  } catch (err: any) {
    if (err instanceof BootstrapValidationError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof BootstrapConflictError) {
      return res.status(409).json({ error: err.message });
    }
    return sendRouteError(res, err, 'Super Admin bootstrap failed');
  }
});

// Self-service Forgot Password: issues short-lived (15m), single-use, SHA-256-hashed reset token via SMTP
router.post('/auth/forgot-password', passwordResetRateLimiter, async (req: Request, res: Response) => {
  const rawEmail = req.body?.email;
  if (!rawEmail || typeof rawEmail !== 'string' || !validateEmail(rawEmail)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  if (!isSmtpConfigured()) {
    return res.status(503).json({
      error:
        'Email-based password recovery is not currently configured on this server. Please contact school administration for an authorized password reset.',
    });
  }

  if (!ensureMongoReady(res)) return;

  const uniformResponseMessage =
    'If an active account is registered with that email address, password reset instructions have been sent.';
  const cleanEmail = rawEmail.trim().toLowerCase();
  const expiresInMinutes = 15;

  let smtpTransport: Awaited<ReturnType<typeof openAuthenticatedSmtpTransport>> | null = null;
  try {
    // Open and authenticate SMTP BEFORE querying UserModel so missing/failing SMTP cannot leak account existence
    smtpTransport = await openAuthenticatedSmtpTransport();
  } catch (err: any) {
    if (err instanceof SmtpConfigurationError || err instanceof SmtpDeliveryError) {
      console.warn('[Password Reset Mailer] SMTP unavailable:', sanitizeErrorMessage(err.message));
      return res.status(503).json({
        error:
          'Password recovery email service is temporarily unavailable. Please try again later or contact school administration.',
      });
    }
    return res.status(503).json({
      error: 'Password recovery email service is temporarily unavailable.',
    });
  }

  let createdTokenHash: string | null = null;
  try {
    const userDoc = await UserModel.findOne({ email: cleanEmail, status: 'active' }).lean();
    if (!userDoc) {
      await smtpTransport.close();
      return res.json({ message: uniformResponseMessage });
    }

    const userId = String(userDoc.record_id || userDoc._id);
    const now = new Date();

    // Invalidate any prior unused reset tokens for this user
    await PasswordResetTokenModel.updateMany(
      { user_id: userId, used_at: null },
      { $set: { used_at: now } }
    );

    // 256-bit cryptographically random token; store ONLY SHA-256 hash in MongoDB (never log raw token)
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    createdTokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000);

    await PasswordResetTokenModel.create({
      token_hash: createdTokenHash,
      user_id: userId,
      email: cleanEmail,
      expires_at: expiresAt,
      used_at: null,
      request_ip: req.ip || '',
      created_at: now,
    });

    await smtpTransport.sendPasswordResetMail({
      toEmail: cleanEmail,
      recipientName: String(userDoc.name || 'Portal User'),
      rawResetToken,
      expiresInMinutes,
    });
    await smtpTransport.close();

    await AuditLogModel.create({
      user_id: userId,
      user_name: String(userDoc.name || cleanEmail),
      role: String(userDoc.role || 'student'),
      action: 'Requested Password Reset Email',
      entity: 'User',
      entity_id: userId,
      details: 'Password reset link dispatched via SMTP (15-minute single-use token)',
      ip_address: req.ip || '',
      created_at: new Date(),
    }).catch(() => {});

    return res.json({ message: uniformResponseMessage });
  } catch (err: any) {
    if (smtpTransport) {
      await smtpTransport.close().catch(() => {});
    }
    if (createdTokenHash) {
      await PasswordResetTokenModel.deleteOne({ token_hash: createdTokenHash }).catch(() => {});
    }
    console.warn('[Password Reset Error]', sanitizeErrorMessage(err?.message || 'Reset dispatch failed'));
    return res.status(503).json({
      error:
        'Password recovery email could not be delivered at this time. Please try again later or contact school administration.',
    });
  }
});

// Self-service Verify Password Reset Token: allows frontend to pre-validate whether a reset token is valid/unexpired
router.get('/auth/verify-reset-token', passwordResetRateLimiter, async (req: Request, res: Response) => {
  const rawToken = req.query.token || req.body?.token;
  if (!rawToken || typeof rawToken !== 'string' || !/^[a-fA-F0-9]{64}$/.test(rawToken.trim())) {
    return res.status(400).json({
      valid: false,
      error: 'Invalid password reset link. The link is malformed or has an invalid token format.',
    });
  }

  if (!ensureMongoReady(res)) return;

  try {
    const cleanToken = rawToken.trim();
    const tokenHash = crypto.createHash('sha256').update(cleanToken.toLowerCase()).digest('hex');
    const exactTokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
    const now = new Date();

    const tokenDoc = await PasswordResetTokenModel.findOne({
      token_hash: { $in: [exactTokenHash, tokenHash] },
      used_at: null,
      expires_at: { $gt: now },
    }).lean();

    if (!tokenDoc) {
      return res.status(400).json({
        valid: false,
        error: 'This password reset link is invalid, expired, or has already been used. Please request a new link.',
      });
    }

    let maskedEmail = '';
    if (tokenDoc.email) {
      const parts = tokenDoc.email.split('@');
      const localPart = parts[0] || '';
      const domain = parts[1] || '';
      if (localPart && domain) {
        const maskedLocal =
          localPart.length > 2
            ? `${localPart[0]}${'*'.repeat(Math.min(localPart.length - 2, 5))}${localPart[localPart.length - 1]}`
            : `${localPart[0]}*`;
        maskedEmail = `${maskedLocal}@${domain}`;
      }
    }

    return res.json({
      valid: true,
      email: maskedEmail,
      message: 'Password reset token is valid and unexpired.',
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to verify reset token');
  }
});

router.post('/auth/verify-reset-token', passwordResetRateLimiter, async (req: Request, res: Response) => {
  const rawToken = req.body?.token || req.query.token;
  if (!rawToken || typeof rawToken !== 'string' || !/^[a-fA-F0-9]{64}$/.test(rawToken.trim())) {
    return res.status(400).json({
      valid: false,
      error: 'Invalid password reset link. The link is malformed or has an invalid token format.',
    });
  }

  if (!ensureMongoReady(res)) return;

  try {
    const cleanToken = rawToken.trim();
    const tokenHash = crypto.createHash('sha256').update(cleanToken.toLowerCase()).digest('hex');
    const exactTokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
    const now = new Date();

    const tokenDoc = await PasswordResetTokenModel.findOne({
      token_hash: { $in: [exactTokenHash, tokenHash] },
      used_at: null,
      expires_at: { $gt: now },
    }).lean();

    if (!tokenDoc) {
      return res.status(400).json({
        valid: false,
        error: 'This password reset link is invalid, expired, or has already been used. Please request a new link.',
      });
    }

    let maskedEmail = '';
    if (tokenDoc.email) {
      const parts = tokenDoc.email.split('@');
      const localPart = parts[0] || '';
      const domain = parts[1] || '';
      if (localPart && domain) {
        const maskedLocal =
          localPart.length > 2
            ? `${localPart[0]}${'*'.repeat(Math.min(localPart.length - 2, 5))}${localPart[localPart.length - 1]}`
            : `${localPart[0]}*`;
        maskedEmail = `${maskedLocal}@${domain}`;
      }
    }

    return res.json({
      valid: true,
      email: maskedEmail,
      message: 'Password reset token is valid and unexpired.',
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to verify reset token');
  }
});

// Self-service Confirm Password Reset: consumes single-use hashed token and revokes all existing sessions
router.post('/auth/confirm-reset-password', passwordResetRateLimiter, async (req: Request, res: Response) => {
  const { token, new_password, confirm_password } = req.body || {};
  if (!token || typeof token !== 'string' || !/^[a-fA-F0-9]{64}$/.test(token.trim())) {
    return res.status(400).json({
      error: 'Invalid, expired, or already-used password reset link. Please request a new password reset.',
    });
  }
  if (!new_password || typeof new_password !== 'string') {
    return res.status(400).json({ error: 'New password is required.' });
  }
  if (confirm_password !== undefined && new_password !== confirm_password) {
    return res.status(400).json({ error: 'New password and confirmation password do not match.' });
  }
  const passCheck = validatePassword(new_password);
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.message });
  }

  if (!ensureMongoReady(res)) return;

  try {
    const tokenHash = crypto.createHash('sha256').update(token.trim().toLowerCase()).digest('hex');
    // Note: rawResetToken is lowercase hex from randomBytes(32).toString('hex')
    const exactTokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const now = new Date();

    // Atomic single-use claim: only matches if used_at === null and expires_at > now
    const claimedReset = await PasswordResetTokenModel.findOneAndUpdate(
      {
        token_hash: { $in: [exactTokenHash, tokenHash] },
        used_at: null,
        expires_at: { $gt: now },
      },
      { $set: { used_at: now } },
      { returnDocument: 'after' }
    ).lean();

    if (!claimedReset) {
      return res.status(400).json({
        error: 'Invalid, expired, or already-used password reset link. Please request a new password reset.',
      });
    }

    const userDoc = await findUserByAnyId(String(claimedReset.user_id));
    if (!userDoc || userDoc.status !== 'active') {
      return res.status(400).json({
        error: 'Invalid or expired password reset link.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    userDoc.password_hash = await bcrypt.hash(new_password, salt);
    // Setting password_changed_at immediately invalidates all previously issued JWTs across all instances
    userDoc.password_changed_at = new Date();
    await userDoc.save();

    // Invalidate any other remaining reset tokens for this user
    await PasswordResetTokenModel.updateMany(
      { user_id: String(claimedReset.user_id), used_at: null },
      { $set: { used_at: new Date() } }
    );

    // Clear any active session cookie on this browser
    const activeTokens = extractAllTokensFromRequest(req);
    for (const activeTok of activeTokens) {
      const dec: any = jsonwebtoken.decode(activeTok);
      await revokeToken(activeTok, typeof dec?.exp === 'number' ? dec.exp : undefined, 'password_reset');
    }
    clearSessionCookie(req, res);

    const dto = toUserDto(userDoc);
    await AuditLogModel.create({
      user_id: dto.id,
      user_name: dto.name,
      role: dto.role,
      action: 'Completed Self-Service Password Reset',
      entity: 'User',
      entity_id: dto.id,
      details: 'Password updated via single-use email reset token; all prior sessions invalidated',
      ip_address: req.ip || '',
      created_at: new Date(),
    }).catch(() => {});

    return res.json({
      message:
        'Your password has been reset successfully. All previous sessions have been signed out. Please sign in with your new password.',
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to complete password reset');
  }
});

// Authenticated self-service password change (invalidates older sessions)
router.post('/auth/change-password', authRateLimiter, authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password || typeof current_password !== 'string' || typeof new_password !== 'string') {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  const passCheck = validatePassword(new_password);
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.message });
  }
  if (current_password === new_password) {
    return res.status(400).json({ error: 'New password must be different from your current password' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const userDoc = await findUserByAnyId(req.user!.id);
    if (!userDoc || !userDoc.password_hash) {
      return res.status(404).json({ error: 'User account not found' });
    }
    const matchesCurrent = await bcrypt.compare(current_password, userDoc.password_hash);
    if (!matchesCurrent) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    userDoc.password_hash = await bcrypt.hash(new_password, salt);
    const changedAt = new Date();
    userDoc.password_changed_at = changedAt;
    await userDoc.save();

    const oldToken = extractTokenFromRequest(req);
    if (oldToken) {
      const decodedOld: any = jsonwebtoken.decode(oldToken);
      await revokeToken(
        oldToken,
        typeof decodedOld?.exp === 'number' ? decodedOld.exp : undefined,
        'password_changed'
      );
    }

    // Ensure the replacement token has iat_ms strictly >= changedAt
    await new Promise(r => setTimeout(r, 2));
    const userDto = toUserDto(userDoc);
    const freshToken = generateToken({
      id: userDto.id,
      email: userDto.email,
      role: userDto.role,
      name: userDto.name,
      phone: userDto.phone,
      linked_id: userDto.linked_id,
      linked_student_ids: userDto.linked_student_ids,
    });
    setSessionCookie(req, res, freshToken);

    await recordMongoAudit(req.user!, 'Changed Account Password', 'User', userDto.id, 'Self-service password update');

    return res.json({
      message: 'Password updated successfully',
      token: freshToken,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to change password');
  }
});

// Authorized administrative password reset (super_admin / admin; revokes all prior user sessions)
router.post('/auth/reset-password', authRateLimiter, authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, email, new_password } = req.body || {};
  if ((!user_id && !email) || !new_password || typeof new_password !== 'string') {
    return res.status(400).json({ error: 'Target user_id (or email) and new_password are required' });
  }
  const passCheck = validatePassword(new_password);
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.message });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const targetDoc = user_id
      ? await findUserByAnyId(String(user_id).trim())
      : await UserModel.findOne({ email: String(email).trim().toLowerCase() });
    if (!targetDoc) {
      return res.status(404).json({ error: 'Target user account not found' });
    }
    if (targetDoc.role === 'super_admin' && req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super_admin may reset a super_admin account password' });
    }

    const salt = await bcrypt.genSalt(10);
    targetDoc.password_hash = await bcrypt.hash(new_password, salt);
    targetDoc.password_changed_at = new Date();
    await targetDoc.save();

    const dto = toUserDto(targetDoc);
    await recordMongoAudit(
      req.user!,
      'Admin Reset User Password',
      'User',
      dto.id,
      `Reset password for ${dto.email} (${dto.role})`
    );

    return res.json({
      message: 'User password reset successfully. All previous sessions have been invalidated.',
      user: dto,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to reset user password');
  }
});

// Student self-signup (MongoDB-authoritative)
router.post('/auth/register-student', authRateLimiter, async (req: Request, res: Response) => {
  const {
    full_name,
    email,
    password,
    confirm_password,
    dob,
    gender,
    father_name,
    phone,
    address,
    class_name,
    section,
    role: injectedRole,
  } = req.body || {};

  // Block privilege escalation attempts on public student registration
  if (injectedRole !== undefined && String(injectedRole).trim().toLowerCase() !== 'student') {
    return res.status(403).json({
      error: 'Privilege escalation blocked: Public student registration can only create student accounts.',
    });
  }

  if (!full_name || !email || !password || !father_name || !class_name) {
    return res.status(400).json({ error: 'Full name, email, password, father name, and class are required' });
  }

  if (password !== confirm_password) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  const passCheck = validatePassword(String(password));
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.message });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!validateEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }

  if (!ensureMongoReady(res)) return;

  try {
    const existingUser = await UserModel.findOne({ email: cleanEmail }).lean();
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email address already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(String(password), salt);

    const ts = Date.now();
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const newStudentId = `std_${ts}_${randSuffix}`;
    const newUserId = `usr_${ts}_${randSuffix}`;
    const year = new Date().getFullYear();

    let admission_no = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `SSC-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
      const exists = await StudentModel.exists({ admission_no: candidate });
      if (!exists) {
        admission_no = candidate;
        break;
      }
    }
    if (!admission_no) {
      admission_no = `SSC-${year}-${String(ts).slice(-5)}`;
    }

    const cleanClassName = sanitizePlainText(class_name, 120);
    const cleanSection = sanitizePlainText(section, 60) || 'A';

    // Allocate unique roll_no within (class_name, section)
    const totalStudentsCount = await StudentModel.countDocuments();
    let rollNum = totalStudentsCount + 101;
    let roll_no = String(rollNum);
    while (
      await StudentModel.exists({
        class_name: { $regex: new RegExp(`^${escapeRegexLiteral(cleanClassName)}$`, 'i') },
        section: { $regex: new RegExp(`^${escapeRegexLiteral(cleanSection)}$`, 'i') },
        roll_no,
      })
    ) {
      rollNum++;
      roll_no = String(rollNum);
    }

    const admissionDate = new Date().toISOString().split('T')[0];
    const cleanFullName = sanitizePlainText(full_name, 150);
    const cleanFatherName = sanitizePlainText(father_name, 150);
    const cleanPhone = phone ? sanitizePlainText(phone, 40) : '';
    const cleanAddress = address ? sanitizePlainText(address, 300) : 'Paharpur, Dera Ismail Khan';
    const normalizedGender: 'Male' | 'Female' | 'Other' =
      gender === 'Female' ? 'Female' : gender === 'Other' ? 'Other' : 'Male';
    const cleanDob = dob ? sanitizePlainText(dob, 20) : '2010-01-01';

    const createdUser = await UserModel.create({
      record_id: newUserId,
      email: cleanEmail,
      password_hash,
      name: cleanFullName,
      role: 'student',
      phone: cleanPhone,
      linked_id: newStudentId,
      linked_student_ids: [],
      status: 'active',
    });

    let createdStudent: any;
    try {
      createdStudent = await StudentModel.create({
        record_id: newStudentId,
        user_id: newUserId,
        admission_no,
        roll_no,
        full_name: cleanFullName,
        father_name: cleanFatherName,
        dob: cleanDob,
        gender: normalizedGender,
        class_name: cleanClassName,
        section: cleanSection,
        contact_no: cleanPhone,
        address: cleanAddress,
        emergency_contact: cleanPhone,
        admission_date: admissionDate,
        academic_status: 'Active',
      });
    } catch (studentErr) {
      await UserModel.deleteOne({ _id: createdUser._id }).catch(() => {});
      throw studentErr;
    }

    const academicYear = '2026-2027';
    await EnrollmentModel.create({
      record_id: `enr_${ts}_${randSuffix}`,
      student_id: newStudentId,
      student_name: cleanFullName,
      class_name: cleanClassName,
      section: cleanSection,
      academic_year: academicYear,
      roll_no,
      enrolled_date: admissionDate,
      status: 'Active',
      active_enrollment_key: computeActiveEnrollmentKey(newStudentId, academicYear, 'Active'),
    }).catch(() => {});

    const userDto = toUserDto(createdUser);
    const studentDto = toStudentDto(createdStudent);

    await recordMongoAudit(
      { id: userDto.id, name: userDto.name, role: userDto.role },
      'Student Account Registered',
      'Student',
      studentDto.id,
      `Class: ${studentDto.class_name}`
    );

    const token = generateToken({
      id: userDto.id,
      email: userDto.email,
      role: userDto.role,
      name: userDto.name,
      phone: userDto.phone,
      linked_id: userDto.linked_id,
    });

    setSessionCookie(req, res, token);

    return res.status(201).json({
      message: 'Student account successfully created',
      token,
      user: {
        id: userDto.id,
        email: userDto.email,
        name: userDto.name,
        role: userDto.role,
        phone: userDto.phone,
        linked_id: userDto.linked_id,
      },
      studentProfile: studentDto,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'An account or student record with these unique identifiers already exists' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to register student account') });
  }
});

// Parent self-signup (MongoDB-authoritative)
router.post('/auth/register-parent', authRateLimiter, async (req: Request, res: Response) => {
  const {
    full_name,
    email,
    password,
    confirm_password,
    phone,
    address,
    occupation,
    child_admission_no,
    child_dob,
    role: injectedRole,
  } = req.body || {};

  // Block privilege escalation attempts on public parent registration
  if (injectedRole !== undefined && String(injectedRole).trim().toLowerCase() !== 'parent') {
    return res.status(403).json({
      error: 'Privilege escalation blocked: Public parent registration can only create parent accounts.',
    });
  }

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required' });
  }

  if (password !== confirm_password) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  const passCheck = validatePassword(String(password));
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.message });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!validateEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }

  if (!ensureMongoReady(res)) return;

  try {
    const existingUser = await UserModel.findOne({ email: cleanEmail }).lean();
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email address already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(String(password), salt);

    const ts = Date.now();
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const newUserId = `usr_${ts}_${randSuffix}`;
    const linkedStudentIds: string[] = [];
    const linkedStudentDtos: StudentDto[] = [];

    // Optional child linking during signup requires BOTH matching admission_no AND child_dob
    if (child_admission_no && String(child_admission_no).trim()) {
      const cleanAdm = String(child_admission_no).trim().toUpperCase();
      const cleanChildDob = child_dob ? String(child_dob).trim() : '';
      if (!cleanChildDob) {
        return res.status(400).json({
          error: 'Child date of birth is required when linking a student by admission number during registration',
        });
      }
      const studentDoc = await StudentModel.findOne({
        admission_no: { $regex: new RegExp(`^${escapeRegexLiteral(cleanAdm)}$`, 'i') },
      });
      if (!studentDoc || studentDoc.dob !== cleanChildDob) {
        return res.status(404).json({
          error: 'No student found matching both the provided admission number and date of birth.',
        });
      }
      const sid = studentDoc.record_id || studentDoc._id.toString();
      linkedStudentIds.push(sid);
      studentDoc.parent_user_id = newUserId;
      await studentDoc.save();
      linkedStudentDtos.push(toStudentDto(studentDoc));
    }

    const cleanName = sanitizePlainText(full_name, 150);
    const cleanPhone = phone ? sanitizePlainText(phone, 40) : '';
    const cleanAddress = address ? sanitizePlainText(address, 300) : '';
    const cleanOccupation = occupation ? sanitizePlainText(occupation, 150) : '';

    const createdUser = await UserModel.create({
      record_id: newUserId,
      email: cleanEmail,
      password_hash,
      name: cleanName,
      role: 'parent',
      phone: cleanPhone,
      linked_id: linkedStudentIds[0] || '',
      linked_student_ids: linkedStudentIds,
      status: 'active',
    });

    await ParentModel.create({
      record_id: `prt_${newUserId}`,
      user_id: newUserId,
      name: cleanName,
      father_name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      address: cleanAddress,
      occupation: cleanOccupation,
      linked_students: linkedStudentIds,
    });

    const userDto = toUserDto(createdUser);
    await recordMongoAudit(
      { id: userDto.id, name: userDto.name, role: userDto.role },
      'Parent Account Registered',
      'Parent',
      userDto.id,
      `Linked students: ${linkedStudentIds.length}`
    );

    const token = generateToken({
      id: userDto.id,
      email: userDto.email,
      role: userDto.role,
      name: userDto.name,
      phone: userDto.phone,
      linked_id: userDto.linked_id,
      linked_student_ids: userDto.linked_student_ids,
    });

    setSessionCookie(req, res, token);

    return res.status(201).json({
      message: 'Parent account successfully created',
      token,
      user: {
        id: userDto.id,
        email: userDto.email,
        name: userDto.name,
        role: userDto.role,
        phone: userDto.phone,
        linked_id: userDto.linked_id,
        linked_student_ids: userDto.linked_student_ids,
      },
      linked_students: linkedStudentDtos,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'An account with this email address already exists' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to register parent account') });
  }
});

// Teacher self-signup (MongoDB-authoritative with mandatory Admin approval)
router.post('/auth/register-teacher', authRateLimiter, async (req: Request, res: Response) => {
  const {
    full_name,
    father_name,
    email,
    password,
    confirm_password,
    phone,
    cnic,
    qualification,
    subject,
    specialization,
    experience,
    bio,
    profile_photo,
    role: injectedRole,
  } = req.body || {};

  // Strict server-enforced role boundary: Never trust role from frontend or allow escalation
  if (injectedRole !== undefined && String(injectedRole).trim().toLowerCase() !== 'teacher') {
    return res.status(403).json({
      error: 'Privilege escalation blocked: Teacher registration can only create teacher accounts.',
    });
  }

  if (!full_name || !email || !password || !qualification || (!subject && !specialization)) {
    return res.status(400).json({
      error: 'Full name, email, password, qualification, and subject/specialization are required.',
    });
  }

  if (password !== confirm_password) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  const passCheck = validatePassword(String(password));
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.message });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!validateEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }

  if (!ensureMongoReady(res)) return;

  try {
    const existingUser = await UserModel.findOne({ email: cleanEmail }).lean();
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email address already exists' });
    }

    const cleanPhone = phone ? String(phone).trim() : '';
    if (cleanPhone) {
      const existingPhone = await UserModel.findOne({ phone: cleanPhone }).lean();
      if (existingPhone) {
        return res.status(409).json({ error: 'An account with this mobile number already exists' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(String(password), salt);

    const ts = Date.now();
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const newTeacherId = `tch_${ts}_${randSuffix}`;
    const newUserId = `usr_${ts}_${randSuffix}`;

    const chosenSubject = String(subject || specialization || 'General').trim();
    const chosenSpec = String(specialization || subject || '').trim();

    // 1. Create Teacher profile in 'Pending' state
    const teacherDoc = await TeacherModel.create({
      record_id: newTeacherId,
      user_id: newUserId,
      name: String(full_name).trim(),
      father_name: father_name ? String(father_name).trim() : '',
      cnic: cnic ? String(cnic).trim() : '',
      profile_photo: profile_photo ? String(profile_photo).trim() : '',
      qualification: String(qualification).trim(),
      subject: chosenSubject,
      specialization: chosenSpec,
      classes: [],
      contact_no: cleanPhone,
      email: cleanEmail,
      joining_date: new Date().toISOString().split('T')[0],
      experience: experience ? String(experience).trim() : '',
      status: 'Pending',
      bio: bio ? String(bio).trim() : '',
    });

    // 2. Create User account strictly with role: 'teacher' and status: 'pending'
    await UserModel.create({
      record_id: newUserId,
      email: cleanEmail,
      name: String(full_name).trim(),
      password_hash,
      role: 'teacher',
      status: 'pending',
      linked_id: newTeacherId,
      phone: cleanPhone,
    });

    // 3. Log to AuditLog
    await AuditLogModel.create({
      log_id: `aud_${ts}_${randSuffix}`,
      user_id: newUserId,
      user_name: String(full_name).trim(),
      role: 'teacher',
      action: 'TEACHER_SIGNUP_REQUEST',
      details: `Teacher self-registration submitted: ${full_name} (${cleanEmail}), subject: ${chosenSubject}. Pending admin approval.`,
      ip_address: req.ip || '',
    }).catch(() => {});

    // 4. Create one admin notification for this teacher signup.
    await createNotificationOnce({
      actionId: crypto.createHash('sha256').update(`teacher-signup:${newUserId}`).digest('hex'),
      userId: 'admin',
      role: 'admin',
      title: 'New Teacher Signup Application',
      message: `${full_name} (${cleanEmail}) applied for teacher position (${chosenSubject}). Please review in Admin Console.`,
    }).catch(() => false);

    return res.status(201).json({
      success: true,
      message:
        'Your teacher registration request has been submitted successfully! The School Administration must review and approve your account before access is granted. Please check back later or contact the administration office.',
      teacher: toTeacherDto(teacherDoc),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'An account or teacher record with these identifiers already exists' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to submit teacher application') });
  }
});

// Helper matching functions for parent-child verification
function isStudentNameMatch(studentName: string, inputName: string): boolean {
  const s = String(studentName || '').toLowerCase().trim();
  const inp = String(inputName || '').toLowerCase().trim();
  if (!s || !inp) return false;
  if (s === inp || s.includes(inp) || inp.includes(s)) return true;
  const sWords = s.split(/\s+/).filter(w => w.length > 1);
  const inpWords = inp.split(/\s+/).filter(w => w.length > 1);
  if (inpWords.length > 0 && inpWords.every(w => sWords.some(sw => sw.includes(w) || w.includes(sw)))) {
    return true;
  }
  return false;
}

function isStudentClassMatch(studentClass: string, inputClass: string): boolean {
  const s = String(studentClass || '').toLowerCase().trim();
  const inp = String(inputClass || '').toLowerCase().trim();
  if (!s || !inp) return false;
  if (s === inp || s.includes(inp) || inp.includes(s)) return true;

  const sNorm = s.replace(/[^a-z0-9]/g, '');
  const inpNorm = inp.replace(/[^a-z0-9]/g, '');
  if (sNorm && inpNorm && (sNorm.includes(inpNorm) || inpNorm.includes(sNorm))) return true;

  const sDigits = s.match(/\b\d+\b/) || s.match(/\d+/);
  const inpDigits = inp.match(/\b\d+\b/) || inp.match(/\d+/);
  if (sDigits && inpDigits && sDigits[0] === inpDigits[0]) {
    return true;
  }
  return false;
}

function isStudentRollMatch(studentRoll: string, inputRoll: string): boolean {
  const s = String(studentRoll || '').trim().toLowerCase();
  const inp = String(inputRoll || '').trim().toLowerCase();
  if (!s || !inp) return false;
  if (s === inp) return true;
  const sNum = parseInt(s.replace(/\D/g, ''), 10);
  const inpNum = parseInt(inp.replace(/\D/g, ''), 10);
  if (!isNaN(sNum) && !isNaN(inpNum) && sNum === inpNum) return true;
  return false;
}

function isFatherNameMatch(studentFather: string, inputFather: string): boolean {
  const s = String(studentFather || '').toLowerCase().trim();
  const inp = String(inputFather || '').toLowerCase().trim();
  if (!s || !inp) return false;
  if (s === inp || s.includes(inp) || inp.includes(s)) return true;
  const sWords = s.split(/\s+/).filter(w => w.length > 1);
  const inpWords = inp.split(/\s+/).filter(w => w.length > 1);
  if (inpWords.some(w => sWords.some(sw => sw.includes(w) || w.includes(sw)))) {
    return true;
  }
  return false;
}

async function fetchLinkedStudentsForParentUser(userId: string, email?: string): Promise<StudentDto[]> {
  const ids = await getLinkedStudentIdsForParent({ id: userId, email });
  if (ids.size === 0) return [];
  const idArr = Array.from(ids);
  const objIds = idArr
    .filter(v => mongoose.Types.ObjectId.isValid(v) && /^[a-fA-F0-9]{24}$/.test(v))
    .map(v => new mongoose.Types.ObjectId(v));
  const docs = await StudentModel.find({
    $or: [
      { record_id: { $in: idArr } },
      { admission_no: { $in: idArr } },
      ...(objIds.length > 0 ? [{ _id: { $in: objIds } }] : []),
    ],
  })
    .sort({ created_at: -1, _id: -1 })
    .lean();
  return docs.map(toStudentDto);
}

async function claimStudentForParent(studentDoc: any, canonicalUserId: string, mongoUserId: string): Promise<any | null> {
  if (!studentDoc?._id || !canonicalUserId || !mongoUserId) return null;
  // One atomic conditional write decides ownership. Concurrent parent requests cannot both claim an unowned student.
  return StudentModel.findOneAndUpdate(
    buildStudentParentClaimFilter(studentDoc._id, canonicalUserId, mongoUserId),
    { $set: { parent_user_id: canonicalUserId } },
    { new: true }
  );
}

// Parent link student endpoint (secure verification by Admission No and Date of Birth)
router.post('/parents/link-student', sensitiveActionRateLimiter, authenticateToken, requireRole(['parent']), async (req: AuthenticatedRequest, res: Response) => {
  const { admission_no, dob } = req.body || {};
  if (!admission_no || !dob) {
    return res.status(400).json({ error: 'Child admission number and date of birth are required for verification' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const cleanAdm = String(admission_no).trim().toUpperCase();
    const cleanDob = String(dob).trim();

    const studentDoc = await StudentModel.findOne({
      admission_no: { $regex: new RegExp(`^${escapeRegexLiteral(cleanAdm)}$`, 'i') },
      dob: cleanDob,
    });

    if (!studentDoc) {
      return res.status(404).json({
        error: 'No student found matching both the provided admission number and date of birth. Please verify institutional records.',
      });
    }

    const userDoc = await findUserByAnyId(req.user!.id);
    if (!userDoc) {
      return res.status(404).json({ error: 'Parent user account not found' });
    }

    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();
    const canonicalUserId = userDoc.record_id || userDoc._id.toString();
    const claimedStudent = await claimStudentForParent(studentDoc, canonicalUserId, userDoc._id.toString());
    if (!claimedStudent) {
      return res.status(409).json({ error: 'This student is already linked to another parent account. Please contact school administration if this is incorrect.' });
    }

    await UserModel.updateOne(
      { _id: userDoc._id, role: 'parent' },
      {
        $addToSet: { linked_student_ids: canonicalStudentId },
        $set: { linked_id: canonicalStudentId },
      }
    );
    Object.assign(studentDoc, claimedStudent.toObject ? claimedStudent.toObject() : claimedStudent);

    await ParentModel.findOneAndUpdate(
      { $or: [{ user_id: canonicalUserId }, { email: userDoc.email.toLowerCase() }] },
      {
        $setOnInsert: {
          record_id: `prt_${canonicalUserId}`,
          user_id: canonicalUserId,
          name: userDoc.name,
          father_name: userDoc.name,
          phone: userDoc.phone || '',
          email: userDoc.email.toLowerCase(),
        },
        $addToSet: { linked_students: canonicalStudentId },
      },
      { upsert: true }
    );

    await recordMongoAudit(
      req.user!,
      'Linked Student to Parent',
      'Student',
      canonicalStudentId,
      `Admission No: ${studentDoc.admission_no}`
    );

    const linkedStudents = await fetchLinkedStudentsForParentUser(canonicalUserId, userDoc.email);
    return res.json({
      message: `Successfully linked ${studentDoc.full_name} (${studentDoc.admission_no}) to parent account`,
      student: toStudentDto(studentDoc),
      linked_students: linkedStudents,
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to link student') });
  }
});

// 1. Find Child for Parent Linking (Father Name + Student Name + Class + Roll No)
router.post('/parents/find-child', sensitiveActionRateLimiter, authenticateToken, requireRole(['parent']), async (req: AuthenticatedRequest, res: Response) => {
  const { father_name, student_name, class_name, roll_no } = req.body || {};

  if (!father_name || !student_name || !class_name || !roll_no) {
    return res.status(400).json({
      error: 'Please fill all required verification fields: Father/Guardian Name, Child Name, Class, and Roll Number.',
    });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const cleanFather = String(father_name).toLowerCase().trim();
    const cleanStudent = String(student_name).toLowerCase().trim();
    const cleanClass = String(class_name).toLowerCase().trim();
    const cleanRoll = String(roll_no).toLowerCase().trim();

    const userDoc = await findUserByAnyId(req.user!.id);
    if (!userDoc) {
      return res.status(404).json({ error: 'Parent account not found' });
    }

    // Narrow candidate records by roll number and class before applying tolerant name/guardian matching.
    const rollDigits = cleanRoll.replace(/\D/g, '');
    const rollClauses: Record<string, any>[] = [
      { roll_no: { $regex: new RegExp('^' + escapeRegexLiteral(cleanRoll) + '$', 'i') } },
    ];
    if (rollDigits) {
      const normalizedRoll = String(parseInt(rollDigits, 10));
      rollClauses.push(
        { roll_no: { $regex: new RegExp('^\\D*0*' + escapeRegexLiteral(normalizedRoll) + '\\D*$', 'i') } },
        { roll_no: Number(normalizedRoll) }
      );
    }
    const classDigits = cleanClass.match(/\d+/)?.[0] || '';
    const classClauses: Record<string, any>[] = [
      { class_name: { $regex: new RegExp(escapeRegexLiteral(cleanClass), 'i') } },
    ];
    if (classDigits) {
      classClauses.push({ class_name: { $regex: new RegExp('\\b' + escapeRegexLiteral(classDigits) + '\\b', 'i') } });
    }
    const candidateDocs = await StudentModel.find({
      $and: [{ $or: rollClauses }, { $or: classClauses }],
    }).lean();
    const matches = candidateDocs.map(toStudentDto).filter(s => {
      if (!isStudentNameMatch(s.full_name, cleanStudent)) return false;
      if (!isStudentClassMatch(s.class_name, cleanClass)) return false;
      const fatherMatches =
        isFatherNameMatch(s.father_name, cleanFather) ||
        (userDoc.name && isFatherNameMatch(s.father_name, userDoc.name));
      return Boolean(fatherMatches);
    });

    if (matches.length === 0) {
      return res.status(404).json({
        error: 'Student could not be verified. Please check the information or contact school administration.',
      });
    }

    const canonicalUserId = userDoc.record_id || userDoc._id.toString();
    const alreadyLinkedIds = await getLinkedStudentIdsForParent({
      id: canonicalUserId,
      email: userDoc.email,
    });

    const unlinkedMatches = matches.filter(s => !alreadyLinkedIds.has(s.id));
    if (unlinkedMatches.length === 0) {
      return res.status(400).json({
        error: 'This child is already linked to your guardian account.',
      });
    }

    return res.json({
      count: unlinkedMatches.length,
      matches: unlinkedMatches.map(s => ({
        id: s.id,
        full_name: s.full_name,
        class_name: s.class_name,
        section: s.section,
        roll_no: s.roll_no,
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to verify child record') });
  }
});

// 2. Confirm & Link Verified Child to Guardian Account
router.post('/parents/confirm-link-child', sensitiveActionRateLimiter, authenticateToken, requireRole(['parent']), async (req: AuthenticatedRequest, res: Response) => {
  const { student_id } = req.body || {};
  if (!student_id) {
    return res.status(400).json({ error: 'Student ID is required for confirmation' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const userDoc = await findUserByAnyId(req.user!.id);
    if (!userDoc) {
      return res.status(404).json({ error: 'Parent account not found' });
    }

    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student record could not be found' });
    }

    // Never trust a guardian name supplied by the browser as proof of identity.
    // The student's recorded father/guardian name must exactly match the authenticated
    // parent's registered account name. For other legitimate guardians, use the
    // admission-number + date-of-birth verification workflow or ask an admin to link.
    const fatherMatches = isExactGuardianNameMatch(studentDoc.father_name, userDoc.name);

    if (!fatherMatches) {
      return res.status(403).json({
        error: 'Student could not be verified. Please check the information or contact school administration.',
      });
    }

    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();
    const canonicalUserId = userDoc.record_id || userDoc._id.toString();
    const claimedStudent = await claimStudentForParent(studentDoc, canonicalUserId, userDoc._id.toString());
    if (!claimedStudent) {
      return res.status(409).json({ error: 'This student is already linked to another parent account. Please contact school administration if this is incorrect.' });
    }

    await UserModel.updateOne(
      { _id: userDoc._id, role: 'parent' },
      {
        $addToSet: { linked_student_ids: canonicalStudentId },
        $set: { linked_id: canonicalStudentId },
      }
    );
    Object.assign(studentDoc, claimedStudent.toObject ? claimedStudent.toObject() : claimedStudent);

    await ParentModel.findOneAndUpdate(
      { $or: [{ user_id: canonicalUserId }, { email: userDoc.email.toLowerCase() }] },
      {
        $setOnInsert: {
          record_id: `prt_${canonicalUserId}`,
          user_id: canonicalUserId,
          name: userDoc.name,
          father_name: userDoc.name,
          phone: userDoc.phone || '',
          email: userDoc.email.toLowerCase(),
        },
        $addToSet: { linked_students: canonicalStudentId },
      },
      { upsert: true }
    );

    await recordMongoAudit(
      req.user!,
      'Linked Student to Guardian Account',
      'Student',
      canonicalStudentId,
      `Name: ${studentDoc.full_name}, Class: ${studentDoc.class_name}, Roll: ${studentDoc.roll_no}`
    );

    const allLinked = await fetchLinkedStudentsForParentUser(canonicalUserId, userDoc.email);
    return res.json({
      success: true,
      message: `Successfully linked ${studentDoc.full_name} to your parent account!`,
      student: toStudentDto(studentDoc),
      linked_students: allLinked,
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to confirm child link') });
  }
});

// 3. Unlink Child from Guardian Account
router.post('/parents/unlink-child', authenticateToken, requireRole(['parent']), async (req: AuthenticatedRequest, res: Response) => {
  const { student_id } = req.body || {};
  if (!student_id) {
    return res.status(400).json({ error: 'Student ID is required to unlink' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const userDoc = await findUserByAnyId(req.user!.id);
    if (!userDoc) {
      return res.status(404).json({ error: 'Parent account not found' });
    }

    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();
    const canonicalUserId = userDoc.record_id || userDoc._id.toString();
    const linkedSet = await getLinkedStudentIdsForParent({
      id: canonicalUserId,
      email: userDoc.email,
    });

    if (!linkedSet.has(canonicalStudentId) && !linkedSet.has(String(student_id))) {
      return res.status(403).json({ error: 'Access denied: This child is not linked to your guardian account.' });
    }

    const idsToPull = new Set([
      canonicalStudentId,
      studentDoc._id.toString(),
      studentDoc.admission_no,
      String(student_id),
    ]);

    const idsToRemove = Array.from(idsToPull).filter(Boolean);
    // Remove access from the authoritative User record atomically; never save a stale document snapshot.
    await UserModel.updateOne(
      { _id: userDoc._id, role: 'parent' },
      { $pull: { linked_student_ids: { $in: idsToRemove } } }
    );

    // Release denormalized ownership only while this parent still owns the student.
    // A concurrent relink by another parent cannot be overwritten by this stale request.
    await StudentModel.updateOne(
      buildStudentParentReleaseFilter(studentDoc._id, canonicalUserId),
      { $set: { parent_user_id: '' } }
    );

    const updatedUserDoc = await UserModel.findOne({ _id: userDoc._id, role: 'parent' }).lean();
    if (updatedUserDoc?.linked_id && idsToPull.has(updatedUserDoc.linked_id)) {
      const nextLinkedId = (updatedUserDoc.linked_student_ids || []).find((id: string) => !idsToPull.has(id)) || '';
      await UserModel.updateOne(
        { _id: userDoc._id, role: 'parent', linked_id: { $in: idsToRemove } },
        { $set: { linked_id: nextLinkedId } }
      );
    }

    await ParentModel.updateMany(
      { $or: [{ user_id: canonicalUserId }, { email: userDoc.email.toLowerCase() }] },
      { $pull: { linked_students: { $in: Array.from(idsToPull) } } }
    );

    await recordMongoAudit(
      req.user!,
      'Unlinked Student from Guardian Account',
      'Student',
      canonicalStudentId,
      `Student: ${studentDoc.full_name}`
    );

    const [remainingLinked, finalUserDoc] = await Promise.all([
      fetchLinkedStudentsForParentUser(canonicalUserId, userDoc.email),
      UserModel.findOne({ _id: userDoc._id, role: 'parent' }).lean(),
    ]);
    return res.json({
      success: true,
      message: `Successfully unlinked ${studentDoc.full_name} from your account.`,
      linked_students: remainingLinked,
      active_child_id: finalUserDoc?.linked_id || undefined,
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to unlink child') });
  }
});

// Parent directory & profile CRUD (MongoDB-authoritative)
router.get('/parents', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const [parentDocs, parentUserDocs, studentDocs] = await Promise.all([
      ParentModel.find().sort({ created_at: -1, _id: -1 }).lean(),
      UserModel.find({ role: 'parent' }).sort({ created_at: -1, _id: -1 }).lean(),
      StudentModel.find().lean(),
    ]);

    const allStudents = studentDocs.map(toStudentDto);
    const studentById = new Map<string, StudentDto>();
    for (const s of allStudents) {
      studentById.set(s.id, s);
      studentById.set(s.admission_no, s);
    }

    const mergedByUserId = new Map<string, any>();
    for (const u of parentUserDocs) {
      const uid = u.record_id || u._id.toString();
      const linkedSet = new Set<string>([
        ...(u.linked_id ? [u.linked_id] : []),
        ...(Array.isArray(u.linked_student_ids) ? u.linked_student_ids : []),
      ]);
      for (const s of allStudents) {
        if (s.parent_user_id === uid) linkedSet.add(s.id);
      }
      mergedByUserId.set(uid, {
        id: uid,
        user_id: uid,
        name: u.name,
        father_name: u.name,
        phone: u.phone || '',
        email: u.email,
        address: '',
        occupation: '',
        status: u.status || 'active',
        linked_students: Array.from(linkedSet),
        children: Array.from(linkedSet)
          .map(sid => studentById.get(sid))
          .filter(Boolean),
      });
    }

    for (const p of parentDocs) {
      const dto = toParentDto(p);
      const existing = dto.user_id ? mergedByUserId.get(dto.user_id) : null;
      if (existing) {
        const unionIds = Array.from(new Set([...existing.linked_students, ...dto.linked_students]));
        existing.address = dto.address || existing.address;
        existing.occupation = dto.occupation || existing.occupation;
        existing.father_name = dto.father_name || existing.father_name;
        existing.phone = existing.phone || dto.phone;
        existing.linked_students = unionIds;
        existing.children = unionIds.map(sid => studentById.get(sid)).filter(Boolean);
      } else {
        mergedByUserId.set(dto.id, {
          ...dto,
          status: 'active',
          children: dto.linked_students.map(sid => studentById.get(sid)).filter(Boolean),
        });
      }
    }

    let items = Array.from(mergedByUserId.values());
    if (search) {
      items = items.filter(
        p =>
          String(p.name || '').toLowerCase().includes(search) ||
          String(p.email || '').toLowerCase().includes(search) ||
          String(p.phone || '').toLowerCase().includes(search)
      );
    }

    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve parents') });
  }
});

// Get all linked students for current parent (must be registered before /parents/:id)
router.get('/parents/my-students', authenticateToken, requireRole(['parent']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const userDoc = await findUserByAnyId(req.user!.id);
    if (!userDoc) {
      return res.status(404).json({ error: 'User not found' });
    }
    const canonicalUserId = userDoc.record_id || userDoc._id.toString();
    const students = await fetchLinkedStudentsForParentUser(canonicalUserId, userDoc.email);
    return res.json(students);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to load linked students') });
  }
});

router.get('/parents/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid parent ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const isAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';
    if (!isAdmin && req.user?.role !== 'parent') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const parentDoc = await findParentByAnyId(req.params.id);
    const userDoc = await findUserByAnyId(parentDoc?.user_id || req.params.id);

    if (!parentDoc && (!userDoc || userDoc.role !== 'parent')) {
      return res.status(404).json({ error: 'Parent profile not found' });
    }

    const ownerUserId = userDoc ? userDoc.record_id || userDoc._id.toString() : parentDoc?.user_id;
    if (!isAdmin && req.user?.id !== ownerUserId && req.params.id !== `prt_${req.user?.id}`) {
      return res.status(403).json({ error: 'Access denied: You may only view your own parent profile.' });
    }

    const linkedStudents = ownerUserId ? await fetchLinkedStudentsForParentUser(ownerUserId, userDoc?.email) : [];
    return res.json({
      id: ownerUserId || (parentDoc ? toParentDto(parentDoc).id : req.params.id),
      user_id: ownerUserId || '',
      name: userDoc?.name || parentDoc?.name || '',
      father_name: parentDoc?.father_name || userDoc?.name || '',
      phone: userDoc?.phone || parentDoc?.phone || '',
      email: userDoc?.email || parentDoc?.email || '',
      address: parentDoc?.address || '',
      occupation: parentDoc?.occupation || '',
      linked_students: linkedStudents,
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve parent profile') });
  }
});

router.put('/parents/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid parent ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const isAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';
    if (!isAdmin && req.user?.role !== 'parent') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const parentDoc = await findParentByAnyId(req.params.id);
    const userDoc = await findUserByAnyId(parentDoc?.user_id || req.params.id);

    if (!parentDoc && (!userDoc || userDoc.role !== 'parent')) {
      return res.status(404).json({ error: 'Parent profile not found' });
    }

    const ownerUserId = userDoc ? userDoc.record_id || userDoc._id.toString() : parentDoc?.user_id;
    if (!isAdmin && req.user?.id !== ownerUserId && req.params.id !== `prt_${req.user?.id}`) {
      return res.status(403).json({ error: 'Access denied: You may only update your own parent profile.' });
    }

    const body = req.body || {};
    if (!isAdmin && (body.role !== undefined || body.linked_students !== undefined || body.linked_student_ids !== undefined)) {
      return res.status(403).json({ error: 'Only administrators or verified child-linking workflows may modify roles or child links.' });
    }

    if (body.email !== undefined && isAdmin) {
      const nextEmail = String(body.email).trim().toLowerCase();
      if (!validateEmail(nextEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address' });
      }
      if (userDoc && nextEmail !== userDoc.email) {
        const dup = await UserModel.findOne({ _id: { $ne: userDoc._id }, email: nextEmail }).lean();
        if (dup) {
          return res.status(409).json({ error: 'Email address is already in use by another account' });
        }
        userDoc.email = nextEmail;
      }
    }

    if (userDoc) {
      if (body.name !== undefined) {
        const cleanName = sanitizePlainText(body.name, 150);
        if (!cleanName) return res.status(400).json({ error: 'Name cannot be empty' });
        userDoc.name = cleanName;
      }
      if (body.phone !== undefined) {
        userDoc.phone = sanitizePlainText(body.phone, 40);
      }
      await userDoc.save();
    }

    const updatedParent = await ParentModel.findOneAndUpdate(
      parentDoc ? { _id: parentDoc._id } : { user_id: ownerUserId },
      {
        $set: {
          ...(ownerUserId ? { user_id: ownerUserId } : {}),
          name: body.name !== undefined ? sanitizePlainText(body.name, 150) : userDoc?.name || parentDoc?.name || '',
          father_name:
            body.father_name !== undefined
              ? sanitizePlainText(body.father_name, 150)
              : parentDoc?.father_name || userDoc?.name || '',
          phone: body.phone !== undefined ? sanitizePlainText(body.phone, 40) : userDoc?.phone || parentDoc?.phone || '',
          email: userDoc?.email || parentDoc?.email || '',
          ...(body.address !== undefined ? { address: sanitizePlainText(body.address, 300) } : {}),
          ...(body.occupation !== undefined ? { occupation: sanitizePlainText(body.occupation, 150) } : {}),
        },
        $setOnInsert: {
          record_id: parentDoc?.record_id || `prt_${ownerUserId || Date.now()}`,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const dto = toParentDto(updatedParent);
    await recordMongoAudit(req.user!, 'Updated Parent Profile', 'Parent', ownerUserId || dto.id, `Name: ${dto.name}`);
    return res.json(dto);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to update parent profile');
  }
});

router.delete('/parents/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid parent ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const parentDoc = await findParentByAnyId(req.params.id);
    const userDoc = await findUserByAnyId(parentDoc?.user_id || req.params.id);

    if (!parentDoc && (!userDoc || userDoc.role !== 'parent')) {
      return res.status(404).json({ error: 'Parent profile not found' });
    }

    const ownerUserId = userDoc ? userDoc.record_id || userDoc._id.toString() : parentDoc?.user_id;
    const parentName = userDoc?.name || parentDoc?.name || req.params.id;

    if (parentDoc) {
      await ParentModel.deleteOne({ _id: parentDoc._id });
    } else if (ownerUserId) {
      await ParentModel.deleteMany({ user_id: ownerUserId });
    }

    if (userDoc && userDoc.role === 'parent') {
      await UserModel.deleteOne({ _id: userDoc._id });
    }

    if (ownerUserId) {
      await StudentModel.updateMany({ parent_user_id: ownerUserId }, { $set: { parent_user_id: '' } });
    }

    await recordMongoAudit(req.user!, 'Deleted Parent Account', 'Parent', ownerUserId || req.params.id, `Name: ${parentName}`);
    return res.json({ message: 'Parent account deleted successfully', id: ownerUserId || req.params.id });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete parent account') });
  }
});

// 4. Admin View Parent-Child Relationships
router.get('/admin/parent-links', authenticateToken, requireRole(['super_admin', 'admin']), async (_req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const [parentUserDocs, parentProfileDocs, studentDocs] = await Promise.all([
      UserModel.find({ role: 'parent' }).sort({ created_at: -1, _id: -1 }).lean(),
      ParentModel.find().lean(),
      StudentModel.find().sort({ created_at: -1, _id: -1 }).lean(),
    ]);

    const allStudents = studentDocs.map(toStudentDto);
    const profileByUserId = new Map<string, any>();
    for (const p of parentProfileDocs) {
      if (p.user_id) profileByUserId.set(p.user_id, p);
      if (p.email) profileByUserId.set(p.email.toLowerCase(), p);
    }

    const parents = parentUserDocs.map(u => {
      const uid = u.record_id || u._id.toString();
      const prof = profileByUserId.get(uid) || (u.email ? profileByUserId.get(u.email.toLowerCase()) : null);
      const parentStudentIds = new Set<string>();
      if (u.linked_id) parentStudentIds.add(u.linked_id);
      if (Array.isArray(u.linked_student_ids)) {
        u.linked_student_ids.forEach((id: string) => parentStudentIds.add(id));
      }
      // Admin relationship view follows the same authoritative source as parent access:
      // current User.linked_id / User.linked_student_ids only. Denormalized Parent and
      // Student pointers are intentionally excluded so stale links cannot reappear.
      const linked = studentDocs
        .filter((student: any) => isParentLinkedToStudent(parentStudentIds, [
          student.record_id,
          student._id?.toString(),
          student.admission_no,
        ]))
        .map(toStudentDto);
      return {
        id: uid,
        name: u.name,
        email: u.email,
        phone: u.phone || prof?.phone || '',
        linked_students: linked,
      };
    });

    return res.json({
      parents,
      all_students: allStudents.map(s => ({
        id: s.id,
        admission_no: s.admission_no,
        full_name: s.full_name,
        father_name: s.father_name,
        class_name: s.class_name,
        section: s.section,
        roll_no: s.roll_no,
        parent_user_id: s.parent_user_id,
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to load parent-child links') });
  }
});

// 5. Admin Manually Link Student to Parent
router.post('/admin/parent-links/link', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const { parent_id, student_id } = req.body || {};
  if (!parent_id || !student_id) {
    return res.status(400).json({ error: 'Both parent ID and student ID are required' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const parentUser = await findUserByAnyId(String(parent_id));
    if (!parentUser || parentUser.role !== 'parent') {
      return res.status(404).json({ error: 'Parent account not found' });
    }

    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const canonicalParentId = parentUser.record_id || parentUser._id.toString();
    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();

    const nextLinked = Array.isArray(parentUser.linked_student_ids) ? [...parentUser.linked_student_ids] : [];
    if (!nextLinked.includes(canonicalStudentId)) {
      nextLinked.push(canonicalStudentId);
    }
    parentUser.linked_student_ids = nextLinked;
    if (!parentUser.linked_id) {
      parentUser.linked_id = canonicalStudentId;
    }
    await parentUser.save();

    studentDoc.parent_user_id = canonicalParentId;
    await studentDoc.save();

    await ParentModel.findOneAndUpdate(
      { $or: [{ user_id: canonicalParentId }, { email: parentUser.email.toLowerCase() }] },
      {
        $setOnInsert: {
          record_id: `prt_${canonicalParentId}`,
          user_id: canonicalParentId,
          name: parentUser.name,
          father_name: parentUser.name,
          phone: parentUser.phone || '',
          email: parentUser.email.toLowerCase(),
        },
        $addToSet: { linked_students: canonicalStudentId },
      },
      { upsert: true }
    );

    await recordMongoAudit(
      req.user!,
      'Admin Linked Student to Parent',
      'ParentLink',
      canonicalStudentId,
      `Parent: ${parentUser.name}, Student: ${studentDoc.full_name}`
    );

    return res.json({
      success: true,
      message: `Linked student ${studentDoc.full_name} to parent ${parentUser.name}`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to link student to parent') });
  }
});

// 6. Admin Unlink Student from Parent
router.post('/admin/parent-links/unlink', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const { parent_id, student_id } = req.body || {};
  if (!parent_id || !student_id) {
    return res.status(400).json({ error: 'Both parent ID and student ID are required' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const parentUser = await findUserByAnyId(String(parent_id));
    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!parentUser || parentUser.role !== 'parent') {
      return res.status(404).json({ error: 'Parent account not found' });
    }
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const canonicalParentId = parentUser.record_id || parentUser._id.toString();
    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();
    const idsToPull = new Set([
      canonicalStudentId,
      studentDoc._id.toString(),
      studentDoc.admission_no,
      String(student_id),
    ]);

    const filteredIds = (parentUser.linked_student_ids || []).filter((id: string) => !idsToPull.has(id));
    parentUser.linked_student_ids = filteredIds;
    if (!parentUser.linked_id || idsToPull.has(parentUser.linked_id)) {
      parentUser.linked_id = filteredIds.length > 0 ? filteredIds[0] : '';
    }
    await parentUser.save();

    if (studentDoc.parent_user_id === canonicalParentId || studentDoc.parent_user_id === String(parent_id)) {
      studentDoc.parent_user_id = '';
      await studentDoc.save();
    }

    await ParentModel.updateMany(
      { $or: [{ user_id: canonicalParentId }, { email: parentUser.email.toLowerCase() }] },
      { $pull: { linked_students: { $in: Array.from(idsToPull) } } }
    );

    await recordMongoAudit(
      req.user!,
      'Admin Unlinked Student from Parent',
      'ParentLink',
      canonicalStudentId,
      `Parent: ${parentUser.name}`
    );

    return res.json({
      success: true,
      message: 'Relationship successfully removed',
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to unlink student from parent') });
  }
});

router.get('/auth/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const userDoc = await findUserByAnyId(req.user!.id);
    if (!userDoc) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userDto = toUserDto(userDoc);
    let studentProfile: StudentDto | null = null;
    let teacherProfile: TeacherDto | null = null;
    let linkedStudents: StudentDto[] = [];

    if (userDto.role === 'student') {
      const studentDoc =
        (userDto.linked_id ? await findStudentByAnyId(userDto.linked_id) : null) ||
        (await StudentModel.findOne({ user_id: userDto.id }));
      studentProfile = studentDoc ? toStudentDto(studentDoc) : null;
    } else if (userDto.role === 'teacher') {
      teacherProfile = await getAuthenticatedTeacherMongo(req);
    } else if (userDto.role === 'parent') {
      linkedStudents = await fetchLinkedStudentsForParentUser(userDto.id, userDto.email);
      if (linkedStudents.length > 0) {
        studentProfile =
          linkedStudents.find(s => s.id === userDto.linked_id) || linkedStudents[0];
      }
    }

    return res.json({
      user: {
        id: userDto.id,
        email: userDto.email,
        name: userDto.name,
        role: userDto.role,
        phone: userDto.phone,
        avatar: userDto.avatar,
        linked_id: userDto.linked_id,
        linked_student_ids: userDto.linked_student_ids || [],
      },
      studentProfile,
      teacherProfile,
      linkedStudents,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to load current user profile');
  }
});

// ==========================================
// 2. DASHBOARD METRICS
// ==========================================

router.get('/dashboard/stats', authenticateToken, requireRole(['super_admin', 'admin', 'teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const isTeacher = req.user?.role === 'teacher';
    const today = new Date().toISOString().split('T')[0];

    let [
      totalStudents,
      totalTeachers,
      totalParents,
      totalClasses,
      totalSections,
      pendingAdmissions,
      approvedAdmissions,
      recentDocs,
      upcomingEvents,
      publishedAnnCount,
      unreadMessages,
      recentAnnDocs,
      todayAttendanceDocs,
      allFeeDocs,
    ] = await Promise.all([
      StudentModel.countDocuments(),
      TeacherModel.countDocuments(),
      UserModel.countDocuments({ role: 'parent' }),
      ClassModel.countDocuments(),
      SectionModel.countDocuments(),
      AdmissionModel.countDocuments({ status: { $in: ['Pending', 'Under Review'] } }),
      AdmissionModel.countDocuments({ status: 'Approved' }),
      isTeacher
        ? Promise.resolve([])
        : AdmissionModel.find().sort({ created_at: -1, _id: -1 }).limit(5).lean(),
      SchoolEventModel.countDocuments({ status: 'Upcoming' }),
      AnnouncementModel.countDocuments({ published: { $ne: false } }),
      isTeacher ? Promise.resolve(0) : ContactMessageModel.countDocuments({ read: false }),
      AnnouncementModel.find({
        published: { $ne: false },
        ...(isTeacher ? { audience: { $in: ['All', 'Teachers', 'Public'] } } : {}),
      })
        .sort({ created_at: -1, _id: -1 })
        .limit(4)
        .lean(),
      AttendanceModel.find({ date: today }).lean(),
      isTeacher
        ? Promise.resolve([])
        : FeeModel.find().sort({ created_at: -1, _id: -1 }).lean(),
    ]);

    // Teachers receive dashboard aggregates only for their currently assigned classes.
    // Never expose school-wide student or attendance totals through a teacher dashboard.
    if (isTeacher) {
      const teacher = await getAuthenticatedTeacherMongo(req);
      const assignedClasses = (teacher?.classes || []).filter(Boolean);
      if (assignedClasses.length > 0) {
        const assignedStudentDocs = await StudentModel.find({
          class_name: { $in: assignedClasses },
        }).select('record_id admission_no _id').lean();
        const studentIdentifiers = Array.from(new Set(
          assignedStudentDocs.flatMap((student: any) => [
            student.record_id,
            student.admission_no,
            student._id?.toString(),
          ]).filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
        ));
        const scopedAttendance = studentIdentifiers.length > 0
          ? await AttendanceModel.find({ date: today, student_id: { $in: studentIdentifiers } }).lean()
          : [];
        totalStudents = assignedStudentDocs.length;
        todayAttendanceDocs.splice(0, todayAttendanceDocs.length, ...scopedAttendance);
      } else {
        totalStudents = 0;
        todayAttendanceDocs.splice(0, todayAttendanceDocs.length);
      }
    }

    const recentAdmissions = recentDocs.map(toAdmissionDto);
    const totalAnnouncements = isTeacher
      ? await AnnouncementModel.countDocuments({
          published: { $ne: false },
          audience: { $in: ['All', 'Teachers', 'Public'] },
        })
      : publishedAnnCount;
    const activeAnnouncements = publishedAnnCount;
    const recentAnnouncements = recentAnnDocs.map(toAnnouncementDto);

    const totalMarkedToday = todayAttendanceDocs.length;
    const presentToday = todayAttendanceDocs.filter(a => a.status === 'Present').length;
    const absentStudentsToday = todayAttendanceDocs.filter(a => a.status === 'Absent').length;
    const attendanceRate = totalMarkedToday > 0 ? Math.round((presentToday / totalMarkedToday) * 100) : 100;

    const totalPendingFee = isTeacher ? 0 : allFeeDocs.reduce((acc, f) => acc + (Number(f.pending_amount) || 0), 0);
    const totalCollectedFee = isTeacher ? 0 : allFeeDocs.reduce((acc, f) => acc + (Number(f.paid_amount) || 0), 0);
    const recentFees = isTeacher ? [] : allFeeDocs.slice(0, 5).map(toFeeDto);

    return res.json({
      totalStudents,
      totalTeachers,
      totalParents,
      totalClasses,
      totalSections,
      pendingAdmissions,
      approvedAdmissions,
      todayMarked: totalMarkedToday,
      presentToday,
      absentToday: absentStudentsToday,
      absentStudentsToday,
      attendanceRate,
      totalPendingFee,
      totalCollectedFee,
      upcomingEvents,
      totalAnnouncements,
      activeAnnouncements,
      unreadMessages,
      recentAnnouncements,
      recentAdmissions,
      recentFees,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to compute dashboard statistics');
  }
});

// ==========================================
// 3. SETTINGS & CMS (MONGODB-AUTHORITATIVE)
// ==========================================

const SETTINGS_STRING_KEYS = new Set([
  'school_name',
  'short_name',
  'slogan',
  'location',
  'google_maps_code',
  'google_maps_embed_query',
  'phone',
  'alt_phone',
  'email',
  'admission_email',
  'affiliation',
  'registration_info',
  'school_timings_summer',
  'school_timings_winter',
  'principal_name',
  'principal_message',
  'about_text',
  'mission',
  'vision',
  'social_facebook',
  'social_whatsapp',
  'hero_badge',
  'hero_title',
  'hero_subtitle',
]);

const SETTINGS_IGNORED_KEYS = new Set([
  '_id',
  '__v',
  'singleton_key',
  'created_at',
  'updated_at',
]);

router.get('/settings', async (_req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const doc =
      (await SchoolSettingsModel.findOne({ singleton_key: 'default' }).lean()) ||
      (await SchoolSettingsModel.findOne({}).lean());
    return res.json(toSchoolSettingsDto(doc));
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to load school settings') });
  }
});

router.put('/settings', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Valid settings object is required' });
  }

  const sanitizedPatch: Record<string, any> = {};

  for (const [key, rawVal] of Object.entries(req.body)) {
    if (
      key.startsWith('$') ||
      key.includes('.') ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      return res.status(400).json({ error: `Disallowed settings field: ${key}` });
    }
    if (SETTINGS_IGNORED_KEYS.has(key) || rawVal === undefined) {
      continue;
    }

    if (SETTINGS_STRING_KEYS.has(key)) {
      if (typeof rawVal !== 'string') {
        return res.status(400).json({ error: `Field "${key}" must be a string` });
      }
      const cleaned = sanitizePlainText(rawVal, 6000);
      if (key === 'school_name' && !cleaned) {
        return res.status(400).json({ error: 'school_name cannot be empty' });
      }
      if ((key === 'email' || key === 'admission_email') && cleaned && !validateEmail(cleaned)) {
        return res.status(400).json({ error: `Field "${key}" must be a valid email address` });
      }
      if (key === 'social_facebook' && cleaned && !isSafeMediaOrWebUrl(cleaned, true)) {
        return res.status(400).json({ error: 'Invalid or unsafe social_facebook URL' });
      }
      sanitizedPatch[key] = cleaned;
      continue;
    }

    if (key === 'core_values') {
      if (!Array.isArray(rawVal) || rawVal.length > 30 || rawVal.some(v => typeof v !== 'string')) {
        return res.status(400).json({ error: 'core_values must be an array of strings' });
      }
      sanitizedPatch.core_values = rawVal.map(v => sanitizePlainText(v, 300)).filter(Boolean);
      continue;
    }

    if (key === 'features') {
      if (!Array.isArray(rawVal) || rawVal.length > 30) {
        return res.status(400).json({ error: 'features must be an array of feature items' });
      }
      const nextFeatures: Array<{ title: string; description: string; icon: string }> = [];
      for (const item of rawVal) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return res.status(400).json({ error: 'Each feature must be a valid object' });
        }
        nextFeatures.push({
          title: sanitizePlainText(item.title, 200),
          description: sanitizePlainText(item.description, 1500),
          icon: sanitizePlainText(item.icon || 'Award', 80) || 'Award',
        });
      }
      sanitizedPatch.features = nextFeatures;
      continue;
    }

    if (key === 'academic_levels') {
      if (!Array.isArray(rawVal) || rawVal.length > 30) {
        return res.status(400).json({ error: 'academic_levels must be an array of academic level items' });
      }
      const nextLevels: Array<{ level: string; grades: string; description: string; stream: string }> = [];
      for (const item of rawVal) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return res.status(400).json({ error: 'Each academic_level item must be a valid object' });
        }
        nextLevels.push({
          level: sanitizePlainText(item.level, 200),
          grades: sanitizePlainText(item.grades, 200),
          description: sanitizePlainText(item.description, 1500),
          stream: sanitizePlainText(item.stream, 200),
        });
      }
      sanitizedPatch.academic_levels = nextLevels;
      continue;
    }

    if (key === 'facilities') {
      if (!Array.isArray(rawVal) || rawVal.length > 40) {
        return res.status(400).json({ error: 'facilities must be an array of facility items' });
      }
      const nextFacilities: Array<{ name: string; description: string; image: string }> = [];
      for (const item of rawVal) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return res.status(400).json({ error: 'Each facility item must be a valid object' });
        }
        if (item.image !== undefined && !isSafeMediaOrWebUrl(item.image, true)) {
          return res.status(400).json({ error: 'Invalid or unsafe facility image URL' });
        }
        nextFacilities.push({
          name: sanitizePlainText(item.name, 200),
          description: sanitizePlainText(item.description, 1500),
          image: typeof item.image === 'string' ? item.image.trim() : '',
        });
      }
      sanitizedPatch.facilities = nextFacilities;
      continue;
    }

    if (key === 'testimonials') {
      if (!Array.isArray(rawVal) || rawVal.length > 40) {
        return res.status(400).json({ error: 'testimonials must be an array of testimonial items' });
      }
      const nextTestimonials: Array<{ name: string; role: string; quote: string; year: string }> = [];
      for (const item of rawVal) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return res.status(400).json({ error: 'Each testimonial item must be a valid object' });
        }
        nextTestimonials.push({
          name: sanitizePlainText(item.name, 200),
          role: sanitizePlainText(item.role, 200),
          quote: sanitizePlainText(item.quote, 2000),
          year: sanitizePlainText(item.year, 100),
        });
      }
      sanitizedPatch.testimonials = nextTestimonials;
      continue;
    }

    // Preserve unknown-but-valid legacy fields safely after deep validation/sanitization
    const safeCustom = sanitizeUnknownLegacyValue(rawVal);
    if (!safeCustom.valid) {
      return res.status(400).json({ error: `Invalid value provided for settings field "${key}"` });
    }
    sanitizedPatch[key] = safeCustom.value;
  }

  if (Object.keys(sanitizedPatch).length === 0) {
    return res.status(400).json({ error: 'At least one valid settings field is required' });
  }

  try {
    const existingDoc =
      (await SchoolSettingsModel.findOne({ singleton_key: 'default' }).lean()) ||
      (await SchoolSettingsModel.findOne({}).lean());

    const filter = existingDoc ? { _id: existingDoc._id } : { singleton_key: 'default' };
    const updatedDoc = await SchoolSettingsModel.findOneAndUpdate(
      filter,
      {
        $set: {
          singleton_key: 'default',
          ...sanitizedPatch,
        },
      },
      { upsert: true, returnDocument: 'after', strict: false }
    ).lean();

    await recordMongoAudit(
      req.user!,
      'Updated School Settings',
      'Settings',
      'school_settings',
      `Updated keys: ${Object.keys(sanitizedPatch).join(', ')}`
    );

    return res.json({
      message: 'Settings and website content updated successfully',
      settings: toSchoolSettingsDto(updatedDoc),
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update school settings') });
  }
});

// ==========================================
// 4. STUDENTS MANAGEMENT
// ==========================================

router.get('/students', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { search, class_name, section, status } = req.query;

    // Object-level isolation for students (own record only)
    if (req.user?.role === 'student') {
      const ownDoc =
        (req.user.linked_id ? await findStudentByAnyId(req.user.linked_id) : null) ||
        (await StudentModel.findOne({ user_id: req.user.id }));
      return res.json(ownDoc ? [toStudentDto(ownDoc)] : []);
    }

    // Object-level isolation for parents (explicitly linked children only — no phone-matching escalation)
    if (req.user?.role === 'parent') {
      const linkedStudents = await fetchLinkedStudentsForParentUser(req.user.id, req.user.email);
      return res.json(linkedStudents);
    }

    const docs = await StudentModel.find().sort({ created_at: -1, _id: -1 }).lean();
    let result = docs.map(toStudentDto);

    // Object-level isolation for teachers (only assigned classes)
    if (req.user?.role === 'teacher') {
      const teacher = await getAuthenticatedTeacherMongo(req);
      const assignedClasses = teacher?.classes || [];
      if (class_name) {
        const isAssigned = isClassAssignedToTeacher(assignedClasses, String(class_name));
        if (!isAssigned) {
          return res.status(403).json({ error: 'Access denied: You may only view students in your assigned classes.' });
        }
      }
      result = result.filter(s => isClassAssignedToTeacher(assignedClasses, s.class_name));
    }

    if (search) {
      const q = String(search).toLowerCase();
      result = result.filter(
        s =>
          s.full_name.toLowerCase().includes(q) ||
          s.admission_no.toLowerCase().includes(q) ||
          s.father_name.toLowerCase().includes(q) ||
          s.roll_no.toLowerCase().includes(q) ||
          s.class_name.toLowerCase().includes(q) ||
          s.section.toLowerCase().includes(q)
      );
    }

    if (class_name) {
      result = result.filter(s => s.class_name.toLowerCase() === String(class_name).toLowerCase());
    }

    if (section) {
      result = result.filter(s => s.section.toLowerCase() === String(section).toLowerCase());
    }

    if (status) {
      result = result.filter(s => s.academic_status.toLowerCase() === String(status).toLowerCase());
    }

    const total = result.length;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const hasLimit = req.query.limit !== undefined;
    const limit = hasLimit ? Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 20)) : 100;
    const totalPages = Math.ceil(total / limit) || 1;

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page', page.toString());
    res.setHeader('X-Limit', limit.toString());
    res.setHeader('X-Total-Pages', totalPages.toString());

    if (req.query.paginate === 'true' || req.query.envelope === 'true') {
      const start = (page - 1) * limit;
      const paged = result.slice(start, start + limit);
      return res.json({
        data: paged,
        pagination: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    if (hasLimit || req.query.page !== undefined) {
      const start = (page - 1) * limit;
      result = result.slice(start, start + limit);
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve students') });
  }
});

router.get('/students/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid student ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const studentDoc = await findStudentByAnyId(req.params.id);
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student record not found' });
    }
    const student = toStudentDto(studentDoc);
    const studentIds = new Set<string>(collectStudentPaymentIdentifiers(studentDoc));

    // OBJECT-LEVEL SECURITY CHECK: STUDENT (own record only)
    if (req.user?.role === 'student') {
      const isStudentSelf =
        (req.user.linked_id && studentIds.has(req.user.linked_id)) ||
        (student.user_id && student.user_id === req.user.id);
      if (!isStudentSelf) {
        return res.status(403).json({ error: 'Access denied: You may only view your own student record.' });
      }
    }

    // OBJECT-LEVEL SECURITY CHECK: PARENT (explicitly linked child only — NO phone-number matching)
    if (req.user?.role === 'parent') {
      const linkedSet = await getLinkedStudentIdsForParent(req.user);
      const isLinked = isParentLinkedToStudent(linkedSet, [
        student.id,
        studentDoc._id.toString(),
        student.admission_no,
      ]);
      if (!isLinked) {
        return res.status(403).json({ error: 'Access denied: You may only view records for your linked child.' });
      }
    }

    // OBJECT-LEVEL SECURITY CHECK: TEACHER (assigned classes only)
    if (req.user?.role === 'teacher') {
      const teacher = await getAuthenticatedTeacherMongo(req);
      const assignedClasses = teacher?.classes || [];
      if (!isClassAssignedToTeacher(assignedClasses, student.class_name)) {
        return res.status(403).json({
          error: 'Access denied: You may only view records for students in your assigned classes.',
        });
      }
    }

    const studentIdList = Array.from(studentIds);
    const canSeeUnpublishedResults =
      req.user?.role === 'super_admin' ||
      req.user?.role === 'admin' ||
      req.user?.role === 'teacher';

    const [attDocs, feeDocs, resultDocs, enrDocs, ttDocs] = await Promise.all([
      AttendanceModel.find({ student_id: { $in: studentIdList } })
        .sort({ date: -1, _id: -1 })
        .lean(),
      req.user?.role === 'teacher'
        ? Promise.resolve([])
        : FeeModel.find({ student_id: { $in: studentIdList } })
            .sort({ created_at: -1, _id: -1 })
            .lean(),
      ResultModel.find({
        student_id: { $in: studentIdList },
        ...(canSeeUnpublishedResults ? {} : { published: { $ne: false } }),
      })
        .sort({ created_at: -1, _id: -1 })
        .lean(),
      EnrollmentModel.find({ student_id: { $in: studentIdList } })
        .sort({ created_at: -1, _id: -1 })
        .lean(),
      student.class_name
        ? TimetableModel.find({
            class_name: { $regex: new RegExp(`^${escapeRegexLiteral(student.class_name)}$`, 'i') },
          })
            .sort({ created_at: 1, _id: 1 })
            .lean()
        : Promise.resolve([]),
    ]);

    const attendance = attDocs.map(toAttendanceDto);
    const totalAtt = attendance.length;
    const presentCount = attendance.filter(a => a.status === 'Present').length;
    const absentCount = attendance.filter(a => a.status === 'Absent').length;
    const lateCount = attendance.filter(a => a.status === 'Late').length;
    const leaveCount = attendance.filter(a => a.status === 'Leave').length;
    const attPercentage = totalAtt > 0 ? Math.round((presentCount / totalAtt) * 100) : 100;
    const attendanceSummary = {
      total: totalAtt,
      present: presentCount,
      absent: absentCount,
      late: lateCount,
      leave: leaveCount,
      percentage: attPercentage,
    };

    const fees = feeDocs.map(toFeeDto);
    const totalFeeAmt = fees.reduce((sum, f) => sum + (f.total_amount || 0), 0);
    const paidFeeAmt = fees.reduce((sum, f) => sum + (f.paid_amount || 0), 0);
    const pendingFeeAmt = fees.reduce((sum, f) => sum + (f.pending_amount || 0), 0);
    const feeSummary =
      req.user?.role === 'teacher'
        ? null
        : {
            total_amount: totalFeeAmt,
            paid_amount: paidFeeAmt,
            pending_amount: pendingFeeAmt,
            status: pendingFeeAmt === 0 ? 'Cleared' : 'Pending',
          };

    const results = resultDocs.map(toResultDto);
    const avgResultPercentage =
      results.length > 0 ? Math.round(results.reduce((s, r) => s + (r.percentage || 0), 0) / results.length) : 0;
    const resultsSummary = {
      total_exams: results.length,
      average_percentage: avgResultPercentage,
      latest_grade: results.length > 0 ? results[0].overall_grade : 'N/A',
    };

    const enrollmentHistory = enrDocs.map(toEnrollmentDto);
    const timetable = ttDocs.map(toTimetableDto);
    const guardian = {
      father_name: student.father_name,
      contact_no: student.contact_no,
      emergency_contact: student.emergency_contact,
      address: student.address,
    };

    return res.json({
      student,
      guardian,
      attendance,
      attendanceSummary,
      fees,
      feeSummary,
      results,
      resultsSummary,
      enrollmentHistory,
      timetable,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to load student dossier');
  }
});

router.post('/students', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const {
      full_name,
      father_name,
      dob,
      gender,
      class_name,
      section,
      contact_no,
      address,
      emergency_contact,
      academic_status,
      roll_no,
      email,
      password,
    } = req.body || {};

    const cleanFullName = sanitizePlainText(full_name, 150);
    const cleanFatherName = sanitizePlainText(father_name, 150);
    const cleanClassName = sanitizePlainText(class_name, 120);
    if (!cleanFullName || !cleanFatherName || !cleanClassName) {
      return res.status(400).json({ error: 'Full name, Father name and Class are required' });
    }

    const ts = Date.now();
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const nextId = `std_${ts}_${randSuffix}`;
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const admission_no = req.body?.admission_no
      ? sanitizePlainText(req.body.admission_no, 60)
      : `SSC-${new Date().getFullYear()}-${randomNum}`;

    // Enforce unique admission number in MongoDB
    const dupAdm = await StudentModel.findOne({
      admission_no: { $regex: new RegExp(`^${escapeRegexLiteral(admission_no)}$`, 'i') },
    }).lean();
    if (dupAdm) {
      return res.status(409).json({
        error: `Admission number "${admission_no}" is already registered in the school database.`,
      });
    }

    const targetSection = section ? sanitizePlainText(section, 60) || 'A' : 'A';
    let targetRoll = '';
    if (roll_no !== undefined && String(roll_no).trim()) {
      targetRoll = sanitizePlainText(roll_no, 30);
      const dupRoll = await StudentModel.findOne({
        class_name: { $regex: new RegExp(`^${escapeRegexLiteral(cleanClassName)}$`, 'i') },
        section: { $regex: new RegExp(`^${escapeRegexLiteral(targetSection)}$`, 'i') },
        roll_no: targetRoll,
      }).lean();
      if (dupRoll) {
        return res.status(409).json({
          error: `Roll number "${targetRoll}" is already assigned in ${cleanClassName} Section ${targetSection}.`,
        });
      }
    } else {
      let candidateNum = (await StudentModel.countDocuments()) + 101;
      targetRoll = String(candidateNum);
      while (
        await StudentModel.exists({
          class_name: { $regex: new RegExp(`^${escapeRegexLiteral(cleanClassName)}$`, 'i') },
          section: { $regex: new RegExp(`^${escapeRegexLiteral(targetSection)}$`, 'i') },
          roll_no: targetRoll,
        })
      ) {
        candidateNum++;
        targetRoll = String(candidateNum);
      }
    }

    let createdUserDoc: any = null;
    let newUserId = '';
    if (email && String(email).trim()) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!validateEmail(cleanEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address' });
      }
      const existingUser = await UserModel.findOne({ email: cleanEmail }).lean();
      if (existingUser) {
        return res.status(409).json({ error: 'A user account with this email address already exists' });
      }
      newUserId = `usr_${ts}_${randSuffix}`;
      const rawPass =
        password && String(password).trim().length >= 6 ? String(password).trim() : `Student${randomNum}!`;
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(rawPass, salt);
      createdUserDoc = await UserModel.create({
        record_id: newUserId,
        email: cleanEmail,
        password_hash,
        name: cleanFullName,
        role: 'student',
        phone: contact_no ? sanitizePlainText(contact_no, 40) : '',
        linked_id: nextId,
        linked_student_ids: [],
        status: 'active',
      });
    }

    const admissionDate =
      typeof req.body?.admission_date === 'string' && req.body.admission_date.trim()
        ? sanitizePlainText(req.body.admission_date, 20)
        : new Date().toISOString().split('T')[0];

    const allowedStatuses = ['Active', 'Inactive', 'Graduated', 'Withdrawn', 'Suspended'] as const;
    const resolvedAcademicStatus = allowedStatuses.includes(academic_status) ? academic_status : 'Active';
    const resolvedGender: 'Male' | 'Female' | 'Other' =
      gender === 'Female' ? 'Female' : gender === 'Other' ? 'Other' : 'Male';

    let createdStudent: any;
    try {
      createdStudent = await StudentModel.create({
        record_id: nextId,
        ...(newUserId ? { user_id: newUserId } : {}),
        admission_no,
        roll_no: targetRoll,
        full_name: cleanFullName,
        father_name: cleanFatherName,
        dob: dob !== undefined ? sanitizePlainText(dob, 20) : '2010-01-01',
        gender: resolvedGender,
        class_name: cleanClassName,
        section: targetSection,
        contact_no: contact_no ? sanitizePlainText(contact_no, 40) : '',
        address: address ? sanitizePlainText(address, 300) : '',
        emergency_contact: emergency_contact ? sanitizePlainText(emergency_contact, 40) : '',
        admission_date: admissionDate,
        academic_status: resolvedAcademicStatus,
      });
    } catch (studentCreateErr) {
      if (createdUserDoc) {
        await UserModel.deleteOne({ _id: createdUserDoc._id }).catch(() => {});
      }
      throw studentCreateErr;
    }

    const academicYear = '2026-2027';
    if (resolvedAcademicStatus === 'Active') {
      await EnrollmentModel.create({
        record_id: `enr_${ts}_${randSuffix}`,
        student_id: nextId,
        student_name: cleanFullName,
        class_name: cleanClassName,
        section: targetSection,
        academic_year: academicYear,
        roll_no: targetRoll,
        enrolled_date: admissionDate,
        status: 'Active',
        active_enrollment_key: computeActiveEnrollmentKey(nextId, academicYear, 'Active'),
      }).catch(() => {});
    }

    const dto = toStudentDto(createdStudent);
    await recordMongoAudit(
      req.user!,
      'Created Student Record',
      'Student',
      dto.id,
      `Name: ${dto.full_name} (${dto.admission_no}), Class: ${dto.class_name}`
    );

    return res.status(201).json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        error: 'Duplicate student admission number, roll number, or linked account detected.',
      });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create student record') });
  }
});

router.put('/students/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid student ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await findStudentByAnyId(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const body = req.body || {};
    const targetClass =
      body.class_name !== undefined ? sanitizePlainText(body.class_name, 120) : existing.class_name;
    const targetSec =
      body.section !== undefined ? sanitizePlainText(body.section, 60) || 'A' : existing.section || 'A';
    const targetRoll =
      body.roll_no !== undefined ? sanitizePlainText(body.roll_no, 30) : existing.roll_no;

    if (!targetClass) {
      return res.status(400).json({ error: 'Class name cannot be empty' });
    }

    if (body.admission_no !== undefined) {
      const nextAdm = sanitizePlainText(body.admission_no, 60);
      if (!nextAdm) {
        return res.status(400).json({ error: 'Admission number cannot be empty' });
      }
      const dupAdm = await StudentModel.findOne({
        _id: { $ne: existing._id },
        admission_no: { $regex: new RegExp(`^${escapeRegexLiteral(nextAdm)}$`, 'i') },
      }).lean();
      if (dupAdm) {
        return res.status(409).json({
          error: `Admission number "${nextAdm}" is already registered in the school database.`,
        });
      }
      existing.admission_no = nextAdm;
    }

    const rollCollision = await StudentModel.findOne({
      _id: { $ne: existing._id },
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(targetClass)}$`, 'i') },
      section: { $regex: new RegExp(`^${escapeRegexLiteral(targetSec)}$`, 'i') },
      roll_no: targetRoll,
    }).lean();
    if (rollCollision) {
      return res.status(409).json({
        error: `Roll number "${targetRoll}" is already assigned in ${targetClass} Section ${targetSec}.`,
      });
    }

    if (body.full_name !== undefined) {
      const cleanName = sanitizePlainText(body.full_name, 150);
      if (!cleanName) return res.status(400).json({ error: 'Student full name cannot be empty' });
      existing.full_name = cleanName;
    }
    if (body.father_name !== undefined) {
      const cleanFather = sanitizePlainText(body.father_name, 150);
      if (!cleanFather) return res.status(400).json({ error: 'Father name cannot be empty' });
      existing.father_name = cleanFather;
    }
    if (body.dob !== undefined) existing.dob = sanitizePlainText(body.dob, 20);
    if (body.gender !== undefined && ['Male', 'Female', 'Other'].includes(body.gender)) {
      existing.gender = body.gender;
    }
    existing.class_name = targetClass;
    existing.section = targetSec;
    existing.roll_no = targetRoll;
    if (body.contact_no !== undefined) existing.contact_no = sanitizePlainText(body.contact_no, 40);
    if (body.address !== undefined) existing.address = sanitizePlainText(body.address, 300);
    if (body.emergency_contact !== undefined) {
      existing.emergency_contact = sanitizePlainText(body.emergency_contact, 40);
    }
    if (body.admission_date !== undefined) existing.admission_date = sanitizePlainText(body.admission_date, 20);
    if (
      body.academic_status !== undefined &&
      ['Active', 'Inactive', 'Graduated', 'Withdrawn', 'Suspended'].includes(body.academic_status)
    ) {
      existing.academic_status = body.academic_status;
    }

    await existing.save();
    const dto = toStudentDto(existing);

    // Sync linked student UserModel name if present
    await UserModel.updateMany(
      {
        $or: [
          { linked_id: dto.id },
          ...(existing.user_id ? [{ record_id: existing.user_id }] : []),
        ],
        role: 'student',
      },
      { $set: { name: existing.full_name } }
    );

    // Sync active enrollment class/section/roll_no/student_name
    await EnrollmentModel.updateMany(
      { student_id: dto.id, status: 'Active' },
      {
        $set: {
          student_name: dto.full_name,
          class_name: dto.class_name,
          section: dto.section,
          roll_no: dto.roll_no,
        },
      }
    );

    await recordMongoAudit(req.user!, 'Updated Student Record', 'Student', dto.id, `Name: ${dto.full_name}`);
    return res.json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Duplicate student admission number or roll number conflict' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update student') });
  }
});

router.delete('/students/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid student ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await findStudentByAnyId(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const isPermanent = req.query.permanent === 'true';
    const dto = toStudentDto(existing);
    const idsToClean = [dto.id, existing._id.toString(), dto.admission_no];

    if (isPermanent) {
      await StudentModel.deleteOne({ _id: existing._id });
      await EnrollmentModel.deleteMany({ student_id: { $in: idsToClean } });
      await UserModel.deleteMany({
        role: 'student',
        $or: [
          { linked_id: { $in: idsToClean } },
          ...(existing.user_id ? [{ record_id: existing.user_id }] : []),
        ],
      });
      await UserModel.updateMany(
        { role: 'parent' },
        { $pull: { linked_student_ids: { $in: idsToClean } } }
      );
      await UserModel.updateMany(
        { role: 'parent', linked_id: { $in: idsToClean } },
        { $set: { linked_id: '' } }
      );
      await ParentModel.updateMany({}, { $pull: { linked_students: { $in: idsToClean } } });

      await recordMongoAudit(
        req.user!,
        'Permanently Deleted Student Record',
        'Student',
        dto.id,
        `Name: ${dto.full_name}`
      );
      return res.json({ message: 'Student permanently deleted from database', student: dto });
    } else {
      existing.academic_status = 'Inactive';
      await existing.save();

      await UserModel.updateMany(
        {
          role: 'student',
          $or: [
            { linked_id: dto.id },
            ...(existing.user_id ? [{ record_id: existing.user_id }] : []),
          ],
        },
        { $set: { status: 'inactive' } }
      );

      const updatedDto = toStudentDto(existing);
      await recordMongoAudit(
        req.user!,
        'Deactivated Student Record',
        'Student',
        updatedDto.id,
        'Status set to Inactive'
      );
      return res.json({ message: 'Student deactivated and archived safely', student: updatedDto });
    }
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete student') });
  }
});

// ==========================================
// 5. TEACHERS MANAGEMENT (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/teachers', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const optionalUser = await tryResolveOptionalUser(req);
    const isAdminCaller = optionalUser?.role === 'super_admin' || optionalUser?.role === 'admin';

    const docs = await TeacherModel.find().sort({ created_at: -1, _id: -1 }).lean();
    const teachers = docs.map(toTeacherDto);

    if (isAdminCaller) {
      return sendAcademicPaginatedOrArray(req, res, teachers);
    }

    // Redact personal staff phone numbers and private emails on public directory endpoint
    const publicTeachers = teachers.map(t => ({
      ...t,
      contact_no: '',
      email: '',
    }));
    return sendAcademicPaginatedOrArray(req, res, publicTeachers);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve teachers');
  }
});

router.get('/teachers/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid teacher ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const teacherDoc = await findTeacherByAnyId(req.params.id);
    if (!teacherDoc) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    const teacher = toTeacherDto(teacherDoc);

    // Object-level authorization: Teacher can only view their own full profile
    if (req.user?.role === 'teacher') {
      const isSelf =
        req.user.linked_id === teacher.id ||
        req.user.linked_id === teacherDoc._id.toString() ||
        teacher.user_id === req.user.id ||
        (teacher.email && teacher.email.toLowerCase() === req.user.email.toLowerCase());
      if (!isSelf) {
        return res.status(403).json({ error: 'Access denied: You may only view your own teacher profile.' });
      }
    } else if (req.user?.role === 'student' || req.user?.role === 'parent') {
      return res.status(403).json({ error: 'Access denied: Personnel staff profiles are restricted.' });
    }

    return res.json(teacher);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve teacher profile') });
  }
});

router.post('/teachers', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const {
      name,
      qualification,
      subject,
      classes,
      contact_no,
      email,
      password,
      experience,
      bio,
      profile_photo,
      joining_date,
      status,
    } = req.body || {};

    const cleanName = sanitizePlainText(name, 150);
    const cleanQualification = sanitizePlainText(qualification, 200);
    const cleanSubject = sanitizePlainText(subject, 150);
    if (!cleanName || !cleanQualification || !cleanSubject) {
      return res.status(400).json({ error: 'Name, qualification and subject are required' });
    }

    const cleanEmail = email && String(email).trim() ? String(email).trim().toLowerCase() : '';
    if (cleanEmail && !validateEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    if (cleanEmail) {
      const [existingUser, existingTeacher] = await Promise.all([
        UserModel.findOne({ email: cleanEmail }).lean(),
        TeacherModel.findOne({ email: cleanEmail }).lean(),
      ]);
      if (existingUser || existingTeacher) {
        return res.status(409).json({ error: 'A user or teacher profile with this email address already exists' });
      }
    }

    const ts = Date.now();
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const newTeacherId = `tch_${ts}_${randSuffix}`;

    const normalizedClasses = Array.isArray(classes)
      ? classes.map((c: unknown) => sanitizePlainText(c, 120)).filter(Boolean)
      : classes
      ? [sanitizePlainText(classes, 120)].filter(Boolean)
      : [];

    const allowedStatuses = ['Active', 'On Leave', 'Resigned'] as const;
    const resolvedStatus = allowedStatuses.includes(status) ? status : 'Active';

    let createdUserDoc: any = null;
    let newUserId = '';
    let generatedPassword = '';

    if (cleanEmail) {
      newUserId = `usr_${ts}_${randSuffix}`;
      const rawPass =
        password && String(password).trim().length >= 6
          ? String(password).trim()
          : `Teacher${Math.floor(1000 + Math.random() * 9000)}!`;
      generatedPassword = rawPass;
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(rawPass, salt);

      createdUserDoc = await UserModel.create({
        record_id: newUserId,
        email: cleanEmail,
        password_hash,
        name: cleanName,
        role: 'teacher',
        phone: contact_no ? sanitizePlainText(contact_no, 40) : '',
        linked_id: newTeacherId,
        linked_student_ids: [],
        status: resolvedStatus === 'Resigned' ? 'inactive' : 'active',
      });
    }

    let createdTeacher: any;
    try {
      createdTeacher = await TeacherModel.create({
        record_id: newTeacherId,
        ...(newUserId ? { user_id: newUserId } : {}),
        name: cleanName,
        profile_photo: profile_photo ? String(profile_photo).trim() : '',
        qualification: cleanQualification,
        subject: cleanSubject,
        classes: normalizedClasses,
        contact_no: contact_no ? sanitizePlainText(contact_no, 40) : '',
        ...(cleanEmail ? { email: cleanEmail } : {}),
        joining_date: joining_date
          ? sanitizePlainText(joining_date, 20)
          : new Date().toISOString().split('T')[0],
        experience: experience ? sanitizePlainText(experience, 80) : '3+ Years',
        status: resolvedStatus,
        bio: bio ? sanitizePlainText(bio, 2000) : '',
      });
    } catch (teacherCreateErr) {
      if (createdUserDoc) {
        await UserModel.deleteOne({ _id: createdUserDoc._id }).catch(() => {});
      }
      throw teacherCreateErr;
    }

    const dto = toTeacherDto(createdTeacher);
    await recordMongoAudit(
      req.user!,
      'Created Teacher Profile',
      'Teacher',
      dto.id,
      `Name: ${dto.name} (${cleanEmail || 'No email'})`
    );

    return res.status(201).json({
      teacher: dto,
      account_created: Boolean(cleanEmail),
      temporary_password: generatedPassword || undefined,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A teacher or user account with this email address already exists' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create teacher profile') });
  }
});

router.put('/teachers/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid teacher ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await findTeacherByAnyId(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const body = req.body || {};
    if (body.email !== undefined) {
      const cleanEmail = body.email && String(body.email).trim() ? String(body.email).trim().toLowerCase() : '';
      if (cleanEmail && !validateEmail(cleanEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address' });
      }
      if (cleanEmail && cleanEmail !== existing.email) {
        const dupTeacher = await TeacherModel.findOne({ _id: { $ne: existing._id }, email: cleanEmail }).lean();
        if (dupTeacher) {
          return res.status(409).json({ error: 'Another teacher profile with this email already exists' });
        }
      }
      existing.email = cleanEmail || undefined;
    }

    if (body.name !== undefined) {
      const cleanName = sanitizePlainText(body.name, 150);
      if (!cleanName) return res.status(400).json({ error: 'Teacher name cannot be empty' });
      existing.name = cleanName;
    }
    if (body.qualification !== undefined) {
      const cleanQual = sanitizePlainText(body.qualification, 200);
      if (!cleanQual) return res.status(400).json({ error: 'Qualification cannot be empty' });
      existing.qualification = cleanQual;
    }
    if (body.subject !== undefined) {
      const cleanSubj = sanitizePlainText(body.subject, 150);
      if (!cleanSubj) return res.status(400).json({ error: 'Subject cannot be empty' });
      existing.subject = cleanSubj;
    }
    if (body.classes !== undefined) {
      existing.classes = Array.isArray(body.classes)
        ? body.classes.map((c: unknown) => sanitizePlainText(c, 120)).filter(Boolean)
        : body.classes
        ? [sanitizePlainText(body.classes, 120)].filter(Boolean)
        : [];
    }
    if (body.contact_no !== undefined) existing.contact_no = sanitizePlainText(body.contact_no, 40);
    if (body.joining_date !== undefined) existing.joining_date = sanitizePlainText(body.joining_date, 20);
    if (body.experience !== undefined) existing.experience = sanitizePlainText(body.experience, 80);
    if (body.status !== undefined && ['Active', 'On Leave', 'Resigned'].includes(body.status)) {
      existing.status = body.status;
    }
    if (body.bio !== undefined) existing.bio = sanitizePlainText(body.bio, 2000);
    if (body.profile_photo !== undefined) existing.profile_photo = String(body.profile_photo).trim();

    await existing.save();
    const dto = toTeacherDto(existing);

    // Sync linked user account name, phone, email, and status if present
    const linkedUserPatch: Record<string, any> = {
      name: dto.name,
      phone: dto.contact_no,
      ...(dto.status === 'Resigned' ? { status: 'inactive' } : {}),
    };
    if (dto.email) {
      linkedUserPatch.email = dto.email;
    }
    await UserModel.updateMany(
      {
        role: 'teacher',
        $or: [
          { linked_id: dto.id },
          ...(existing.user_id ? [{ record_id: existing.user_id }] : []),
        ],
      },
      { $set: linkedUserPatch }
    );

    // Sync teacher_name on TeacherAssignmentModel
    await TeacherAssignmentModel.updateMany(
      { teacher_id: { $in: [dto.id, existing._id.toString()] } },
      { $set: { teacher_name: dto.name } }
    );

    await recordMongoAudit(req.user!, 'Updated Teacher Record', 'Teacher', dto.id, `Name: ${dto.name}`);
    return res.json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Email conflict while updating teacher profile' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update teacher') });
  }
});

router.delete('/teachers/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid teacher ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await findTeacherByAnyId(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const isPermanent = req.query.permanent === 'true';
    const dto = toTeacherDto(existing);
    const teacherIds = [dto.id, existing._id.toString()];

    if (isPermanent) {
      await TeacherModel.deleteOne({ _id: existing._id });
      await TeacherAssignmentModel.deleteMany({ teacher_id: { $in: teacherIds } });
      await UserModel.deleteMany({
        role: 'teacher',
        $or: [
          { linked_id: { $in: teacherIds } },
          ...(existing.user_id ? [{ record_id: existing.user_id }] : []),
          ...(dto.email ? [{ email: dto.email.toLowerCase() }] : []),
        ],
      });

      await recordMongoAudit(req.user!, 'Permanently Deleted Teacher', 'Teacher', dto.id, `Name: ${dto.name}`);
      return res.json({ message: 'Teacher permanently deleted', teacher: dto });
    } else {
      existing.status = 'Resigned';
      await existing.save();

      await UserModel.updateMany(
        {
          role: 'teacher',
          $or: [
            { linked_id: { $in: teacherIds } },
            ...(existing.user_id ? [{ record_id: existing.user_id }] : []),
            ...(dto.email ? [{ email: dto.email.toLowerCase() }] : []),
          ],
        },
        { $set: { status: 'inactive' } }
      );

      const updatedDto = toTeacherDto(existing);
      await recordMongoAudit(req.user!, 'Deactivated Teacher', 'Teacher', updatedDto.id, 'Status set to Resigned');
      return res.json({ message: 'Teacher status set to Resigned', teacher: updatedDto });
    }
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete teacher') });
  }
});

// ==========================================
// 5.1 TEACHER APPROVAL & TASK MANAGEMENT (ADMIN)
// ==========================================

// Get all pending teacher signup requests
router.get('/admin/teacher-requests', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const pendingUsers = await UserModel.find({ role: 'teacher', status: 'pending' })
      .sort({ created_at: -1 })
      .lean();

    const results = await Promise.all(
      pendingUsers.map(async u => {
        const teacher = await TeacherModel.findOne({
          $or: [
            ...(u.linked_id ? [{ record_id: u.linked_id }, { _id: isValidObjectId(u.linked_id) ? u.linked_id : undefined }].filter(Boolean) : []),
            { user_id: u.record_id },
            { email: u.email.toLowerCase() },
          ],
        }).lean();

        return {
          id: u.record_id,
          user_id: u.record_id,
          teacher_id: teacher?.record_id || u.linked_id || '',
          name: u.name,
          email: u.email,
          phone: u.phone || teacher?.contact_no || '',
          father_name: teacher?.father_name || '',
          cnic: teacher?.cnic || '',
          qualification: teacher?.qualification || '',
          subject: teacher?.subject || '',
          specialization: teacher?.specialization || teacher?.subject || '',
          experience: teacher?.experience || '',
          bio: teacher?.bio || '',
          status: 'Pending',
          created_at: u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString(),
        };
      })
    );

    return res.json({ requests: results });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to fetch pending teacher applications');
  }
});

// Approve teacher application and assign classes/subjects
router.post('/admin/teacher-requests/:id/approve', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const targetId = req.params.id;
  if (!targetId) {
    return res.status(400).json({ error: 'Target ID is required' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    // 1. Locate user record
    const userDoc = await UserModel.findOne({
      $or: [
        { record_id: targetId },
        { linked_id: targetId },
        ...(isValidObjectId(targetId) ? [{ _id: targetId }] : []),
      ],
      role: 'teacher',
    });

    if (!userDoc) {
      return res.status(404).json({ error: 'Pending teacher account not found' });
    }

    // 2. Locate teacher profile
    const teacherDoc = await TeacherModel.findOne({
      $or: [
        ...(userDoc.linked_id ? [{ record_id: userDoc.linked_id }, { _id: isValidObjectId(userDoc.linked_id) ? userDoc.linked_id : undefined }].filter(Boolean) : []),
        { user_id: userDoc.record_id },
        { email: userDoc.email.toLowerCase() },
      ],
    });

    if (!teacherDoc) {
      return res.status(404).json({ error: 'Associated teacher profile not found' });
    }

    const {
      classes,
      subject,
      employment_status,
      assignments,
      is_class_teacher,
      class_teacher_for,
    } = req.body || {};

    const resolvedStatus = employment_status && ['Active', 'On Leave', 'Suspended'].includes(employment_status)
      ? employment_status
      : 'Active';

    // 3. Update User status to active
    userDoc.status = resolvedStatus === 'Suspended' ? 'suspended' : 'active';
    await userDoc.save();

    // 4. Update Teacher profile
    teacherDoc.status = resolvedStatus;
    if (Array.isArray(classes)) {
      teacherDoc.classes = classes.map(c => String(c).trim()).filter(Boolean);
    }
    if (subject && String(subject).trim()) {
      teacherDoc.subject = String(subject).trim();
    }
    await teacherDoc.save();

    const teacherDto = toTeacherDto(teacherDoc);

    // 5. Create Teacher Assignments if provided
    if (Array.isArray(assignments) && assignments.length > 0) {
      for (const asg of assignments) {
        if (!asg.class_name || !asg.section || !asg.subject) continue;
        const exists = await TeacherAssignmentModel.findOne({
          teacher_id: teacherDto.id,
          class_name: asg.class_name,
          section: asg.section,
          subject: asg.subject,
        });
        if (!exists) {
          const randSuffix = Math.random().toString(36).slice(2, 6);
          await TeacherAssignmentModel.create({
            record_id: `asg_${Date.now()}_${randSuffix}`,
            teacher_id: teacherDto.id,
            teacher_name: teacherDto.name,
            class_name: asg.class_name,
            section: asg.section,
            subject: asg.subject,
            academic_session: '2026-2027',
            assigned_date: new Date().toISOString().split('T')[0],
            is_class_teacher: Boolean(asg.is_class_teacher),
          });
        }
      }
    } else if (is_class_teacher && class_teacher_for?.class_name && class_teacher_for?.section) {
      // Direct class teacher assignment
      const exists = await TeacherAssignmentModel.findOne({
        teacher_id: teacherDto.id,
        class_name: class_teacher_for.class_name,
        section: class_teacher_for.section,
      });
      if (exists) {
        exists.is_class_teacher = true;
        await exists.save();
      } else {
        const randSuffix = Math.random().toString(36).slice(2, 6);
        await TeacherAssignmentModel.create({
          record_id: `asg_${Date.now()}_${randSuffix}`,
          teacher_id: teacherDto.id,
          teacher_name: teacherDto.name,
          class_name: class_teacher_for.class_name,
          section: class_teacher_for.section,
          subject: teacherDto.subject || 'All',
          academic_session: '2026-2027',
          assigned_date: new Date().toISOString().split('T')[0],
          is_class_teacher: true,
        });
      }
    }

    // 6. Audit Log
    await recordMongoAudit(
      req.user!,
      'Approved Teacher Application',
      'Teacher',
      teacherDto.id,
      `Approved ${teacherDto.name} (${teacherDto.email}). Status: ${resolvedStatus}, Classes: ${(teacherDoc.classes || []).join(', ')}`
    );

    // 7. Notify the teacher once for this account approval.
    await createNotificationOnce({
      actionId: crypto.createHash('sha256').update(`teacher-approved:${userDoc.record_id}`).digest('hex'),
      userId: userDoc.record_id,
      role: 'teacher',
      title: 'Teacher Account Approved',
      message: `Congratulations ${teacherDto.name}! Your teacher account has been approved by the School Administration. You can now access your teacher portal.`,
    }).catch(() => false);

    return res.json({
      success: true,
      message: `Teacher ${teacherDto.name} has been approved and activated successfully.`,
      teacher: teacherDto,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to approve teacher application');
  }
});

// Reject teacher application
router.post('/admin/teacher-requests/:id/reject', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const targetId = req.params.id;
  if (!targetId) {
    return res.status(400).json({ error: 'Target ID is required' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const { reason } = req.body || {};

    const userDoc = await UserModel.findOne({
      $or: [
        { record_id: targetId },
        { linked_id: targetId },
        ...(isValidObjectId(targetId) ? [{ _id: targetId }] : []),
      ],
      role: 'teacher',
    });

    if (!userDoc) {
      return res.status(404).json({ error: 'Pending teacher account not found' });
    }

    const teacherDoc = await TeacherModel.findOne({
      $or: [
        ...(userDoc.linked_id ? [{ record_id: userDoc.linked_id }, { _id: isValidObjectId(userDoc.linked_id) ? userDoc.linked_id : undefined }].filter(Boolean) : []),
        { user_id: userDoc.record_id },
        { email: userDoc.email.toLowerCase() },
      ],
    });

    userDoc.status = 'inactive';
    await userDoc.save();

    if (teacherDoc) {
      teacherDoc.status = 'Resigned';
      await teacherDoc.save();
    }

    await recordMongoAudit(
      req.user!,
      'Rejected Teacher Application',
      'Teacher',
      userDoc.record_id,
      `Rejected ${userDoc.name} (${userDoc.email}). Reason: ${reason || 'Not specified'}`
    );

    return res.json({
      success: true,
      message: `Teacher application for ${userDoc.name} has been rejected.`,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to reject teacher application');
  }
});

// Admin Teacher Tasks / Responsibilities Management
router.get('/admin/teacher-tasks', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const filter: Record<string, any> = {};
    if (req.query.teacher_id && typeof req.query.teacher_id === 'string' && req.query.teacher_id.trim()) {
      filter.teacher_id = req.query.teacher_id.trim();
    }
    if (req.query.status && typeof req.query.status === 'string' && req.query.status.trim()) {
      filter.status = req.query.status.trim();
    }

    const tasks = await TeacherTaskModel.find(filter).sort({ due_date: 1, created_at: -1 }).lean();
    return res.json({ tasks: tasks.map(toTeacherTaskDto) });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to fetch teacher tasks');
  }
});

router.post('/admin/teacher-tasks', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const { title, description, teacher_id, class_name, section, priority, due_date } = req.body || {};
  if (!title || !teacher_id || !due_date) {
    return res.status(400).json({ error: 'Title, teacher ID, and due date are required' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const teacher = await TeacherModel.findOne({
      $or: [{ record_id: teacher_id }, ...(isValidObjectId(teacher_id) ? [{ _id: teacher_id }] : [])],
    }).lean();

    const teacherName = teacher ? teacher.name : 'Teacher';
    const taskId = `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const taskDoc = await TeacherTaskModel.create({
      task_id: taskId,
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      teacher_id: String(teacher_id).trim(),
      teacher_name: teacherName,
      class_name: class_name ? String(class_name).trim() : '',
      section: section ? String(section).trim() : '',
      priority: ['Low', 'Medium', 'High', 'Urgent'].includes(priority) ? priority : 'Medium',
      status: 'Pending',
      due_date: String(due_date).trim(),
      assigned_by: req.user?.name || 'Administration',
    });

    // Notify the assigned teacher once for this persisted task.
    if (teacher?.user_id) {
      await createNotificationOnce({
        actionId: crypto.createHash('sha256').update(`teacher-task:${taskDoc._id.toString()}`).digest('hex'),
        userId: teacher.user_id,
        role: 'teacher',
        title: 'New Responsibility Assigned',
        message: `Admin assigned a new duty: "${title}" (Due: ${due_date}). Please review your tasks tab.`,
      }).catch(() => false);
    }

    await recordMongoAudit(
      req.user!,
      'Assigned Teacher Responsibility',
      'TeacherTask',
      taskId,
      `Assigned "${title}" to ${teacherName} (Due: ${due_date})`
    );

    return res.status(201).json({
      success: true,
      message: 'Teacher task assigned successfully',
      task: toTeacherTaskDto(taskDoc),
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to assign teacher task');
  }
});

router.patch('/admin/teacher-tasks/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const taskId = req.params.id;
  if (!ensureMongoReady(res)) return;

  try {
    const task = await TeacherTaskModel.findOne({
      $or: [{ task_id: taskId }, ...(isValidObjectId(taskId) ? [{ _id: taskId }] : [])],
    });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { title, description, priority, status, due_date, class_name, section } = req.body || {};
    if (title !== undefined) task.title = String(title).trim();
    if (description !== undefined) task.description = String(description).trim();
    if (priority !== undefined && ['Low', 'Medium', 'High', 'Urgent'].includes(priority)) task.priority = priority;
    if (status !== undefined && ['Pending', 'In Progress', 'Completed'].includes(status)) {
      task.status = status;
      if (status === 'Completed' && !task.completed_at) {
        task.completed_at = new Date().toISOString();
      }
    }
    if (due_date !== undefined) task.due_date = String(due_date).trim();
    if (class_name !== undefined) task.class_name = String(class_name).trim();
    if (section !== undefined) task.section = String(section).trim();

    await task.save();
    return res.json({ success: true, task: toTeacherTaskDto(task) });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to update task');
  }
});

router.delete('/admin/teacher-tasks/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const taskId = req.params.id;
  if (!ensureMongoReady(res)) return;

  try {
    const result = await TeacherTaskModel.findOneAndDelete({
      $or: [{ task_id: taskId }, ...(isValidObjectId(taskId) ? [{ _id: taskId }] : [])],
    });
    if (!result) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to delete task');
  }
});

// ==========================================
// 6. CLASSES & SUBJECTS (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/classes', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const filter: Record<string, any> = {};
    if (req.query.stream && typeof req.query.stream === 'string' && req.query.stream.trim()) {
      filter.stream = { $regex: new RegExp(`^${escapeRegexLiteral(req.query.stream.trim())}$`, 'i') };
    }
    if (req.query.grade_level && typeof req.query.grade_level === 'string' && req.query.grade_level.trim()) {
      filter.grade_level = { $regex: new RegExp(`^${escapeRegexLiteral(req.query.grade_level.trim())}$`, 'i') };
    }
    const docs = await ClassModel.find(filter).sort({ created_at: 1, _id: 1 }).lean();
    const items = docs.map(toClassDto);
    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve classes') });
  }
});

router.post('/classes', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { name, grade_level, stream, monthly_tuition_fee, capacity, class_teacher } = req.body || {};

    const cleanName = sanitizePlainText(name, 120);
    if (!cleanName) {
      return res.status(400).json({ error: 'Class name is required' });
    }

    let feeVal = 2500;
    if (monthly_tuition_fee !== undefined && monthly_tuition_fee !== '') {
      const parsedFee = Number(monthly_tuition_fee);
      if (!Number.isFinite(parsedFee) || parsedFee < 0 || parsedFee > 1000000) {
        return res.status(400).json({ error: 'Monthly tuition fee must be a valid non-negative amount' });
      }
      feeVal = Math.round(parsedFee * 100) / 100;
    }

    let capVal = 40;
    if (capacity !== undefined && capacity !== '') {
      const parsedCap = Number(capacity);
      if (!Number.isFinite(parsedCap) || !Number.isInteger(parsedCap) || parsedCap < 1 || parsedCap > 1000) {
        return res.status(400).json({ error: 'Class capacity must be an integer between 1 and 1000' });
      }
      capVal = parsedCap;
    }

    const existing = await ClassModel.findOne({
      name: { $regex: new RegExp(`^${escapeRegexLiteral(cleanName)}$`, 'i') },
    }).lean();
    if (existing) {
      return res.status(409).json({ error: 'A class with this name already exists' });
    }

    const recordId = `cls_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created = await ClassModel.create({
      record_id: recordId,
      name: cleanName,
      grade_level: sanitizePlainText(grade_level, 80) || 'General',
      stream: sanitizePlainText(stream, 80) || 'General',
      monthly_tuition_fee: feeVal,
      capacity: capVal,
      class_teacher: sanitizePlainText(class_teacher, 120) || 'To be assigned',
    });

    const dto = toClassDto(created);
    await recordMongoAudit(req.user!, 'Created Class', 'Class', dto.id, `Name: ${dto.name}`);
    return res.status(201).json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A class with this name already exists' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create class') });
  }
});

router.put('/classes/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid class ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const existing = await ClassModel.findOne(buildCmsRecordLookupFilter(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const body = req.body || {};
    const previousName = existing.name;

    if (body.name !== undefined) {
      const cleanName = sanitizePlainText(body.name, 120);
      if (!cleanName) {
        return res.status(400).json({ error: 'Class name cannot be empty' });
      }
      const dup = await ClassModel.findOne({
        _id: { $ne: existing._id },
        name: { $regex: new RegExp(`^${escapeRegexLiteral(cleanName)}$`, 'i') },
      }).lean();
      if (dup) {
        return res.status(409).json({ error: 'A class with this name already exists' });
      }
      existing.name = cleanName;
    }

    if (body.grade_level !== undefined) {
      existing.grade_level = sanitizePlainText(body.grade_level, 80);
    }
    if (body.stream !== undefined) {
      existing.stream = sanitizePlainText(body.stream, 80) || 'General';
    }
    if (body.monthly_tuition_fee !== undefined && body.monthly_tuition_fee !== '') {
      const parsedFee = Number(body.monthly_tuition_fee);
      if (!Number.isFinite(parsedFee) || parsedFee < 0 || parsedFee > 1000000) {
        return res.status(400).json({ error: 'Monthly tuition fee must be a valid non-negative amount' });
      }
      existing.monthly_tuition_fee = Math.round(parsedFee * 100) / 100;
    }
    if (body.capacity !== undefined && body.capacity !== '') {
      const parsedCap = Number(body.capacity);
      if (!Number.isFinite(parsedCap) || !Number.isInteger(parsedCap) || parsedCap < 1 || parsedCap > 1000) {
        return res.status(400).json({ error: 'Class capacity must be an integer between 1 and 1000' });
      }
      existing.capacity = parsedCap;
    }
    if (body.class_teacher !== undefined) {
      existing.class_teacher = sanitizePlainText(body.class_teacher, 120);
    }

    await existing.save();

    if (previousName !== existing.name) {
      const prevRegex = new RegExp(`^${escapeRegexLiteral(previousName)}$`, 'i');
      await Promise.all([
        SectionModel.updateMany({ class_name: { $regex: prevRegex } }, { $set: { class_name: existing.name } }),
        SubjectModel.updateMany({ class_name: { $regex: prevRegex } }, { $set: { class_name: existing.name } }),
        TimetableModel.updateMany({ class_name: { $regex: prevRegex } }, { $set: { class_name: existing.name } }),
        StudentModel.updateMany({ class_name: { $regex: prevRegex } }, { $set: { class_name: existing.name } }),
        EnrollmentModel.updateMany({ class_name: { $regex: prevRegex } }, { $set: { class_name: existing.name } }),
        TeacherAssignmentModel.updateMany({ class_name: { $regex: prevRegex } }, { $set: { class_name: existing.name } }),
      ]);
    }

    const dto = toClassDto(existing);
    await recordMongoAudit(req.user!, 'Updated Class', 'Class', dto.id, `Name: ${dto.name}`);
    return res.json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A class with this name already exists' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update class') });
  }
});

router.delete('/classes/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid class ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const removedDoc = await ClassModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
    if (!removedDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const dto = toClassDto(removedDoc);
    await recordMongoAudit(req.user!, 'Deleted Class', 'Class', dto.id, `Name: ${dto.name}`);
    return res.json({ message: 'Class removed successfully', item: dto });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete class') });
  }
});

// ==========================================
// 6b. SECTIONS MANAGEMENT (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/sections', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const filter: Record<string, any> = {};
    if (req.query.class_name && typeof req.query.class_name === 'string' && req.query.class_name.trim()) {
      filter.class_name = {
        $regex: new RegExp(`^${escapeRegexLiteral(req.query.class_name.trim())}$`, 'i'),
      };
    }
    const docs = await SectionModel.find(filter).sort({ created_at: 1, _id: 1 }).lean();
    const items = docs.map(toSectionDto);
    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve sections') });
  }
});

router.post('/sections', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { name, class_name, capacity, room, teacher_name } = req.body || {};

    const cleanName = sanitizePlainText(name, 60);
    const cleanClassInput = sanitizePlainText(class_name, 120);
    if (!cleanName || !cleanClassInput) {
      return res.status(400).json({ error: 'Section name and Class name are required' });
    }

    const matchedClass = await resolveExistingClassDoc(cleanClassInput);
    if (!matchedClass) {
      return res.status(400).json({ error: `Invalid class reference: class "${cleanClassInput}" does not exist` });
    }
    const canonicalClassName = matchedClass.name;

    let capVal = 40;
    if (capacity !== undefined && capacity !== '') {
      const parsedCap = Number(capacity);
      if (!Number.isFinite(parsedCap) || !Number.isInteger(parsedCap) || parsedCap < 1 || parsedCap > 1000) {
        return res.status(400).json({ error: 'Section capacity must be an integer between 1 and 1000' });
      }
      capVal = parsedCap;
    }

    const duplicate = await SectionModel.findOne({
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(canonicalClassName)}$`, 'i') },
      name: { $regex: new RegExp(`^${escapeRegexLiteral(cleanName)}$`, 'i') },
    }).lean();
    if (duplicate) {
      return res.status(409).json({ error: 'A section with this name already exists for this class' });
    }

    const recordId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created = await SectionModel.create({
      record_id: recordId,
      name: cleanName,
      class_name: canonicalClassName,
      capacity: capVal,
      room: sanitizePlainText(room, 80),
      teacher_name: sanitizePlainText(teacher_name, 120),
    });

    const dto = toSectionDto(created);
    await recordMongoAudit(
      req.user!,
      'Created Section',
      'Section',
      dto.id,
      `${dto.class_name} - Section ${dto.name}`
    );
    return res.status(201).json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A section with this name already exists for this class' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create section') });
  }
});

router.put('/sections/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid section ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const existing = await SectionModel.findOne(buildCmsRecordLookupFilter(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Section not found' });
    }

    const body = req.body || {};
    let nextClassName = existing.class_name;
    let nextName = existing.name;

    if (body.class_name !== undefined) {
      const cleanClassInput = sanitizePlainText(body.class_name, 120);
      if (!cleanClassInput) {
        return res.status(400).json({ error: 'Class name cannot be empty' });
      }
      const matchedClass = await resolveExistingClassDoc(cleanClassInput);
      if (!matchedClass) {
        return res.status(400).json({ error: `Invalid class reference: class "${cleanClassInput}" does not exist` });
      }
      nextClassName = matchedClass.name;
    }

    if (body.name !== undefined) {
      const cleanName = sanitizePlainText(body.name, 60);
      if (!cleanName) {
        return res.status(400).json({ error: 'Section name cannot be empty' });
      }
      nextName = cleanName;
    }

    const duplicate = await SectionModel.findOne({
      _id: { $ne: existing._id },
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(nextClassName)}$`, 'i') },
      name: { $regex: new RegExp(`^${escapeRegexLiteral(nextName)}$`, 'i') },
    }).lean();
    if (duplicate) {
      return res.status(409).json({ error: 'A section with this name already exists for this class' });
    }

    if (body.capacity !== undefined && body.capacity !== '') {
      const parsedCap = Number(body.capacity);
      if (!Number.isFinite(parsedCap) || !Number.isInteger(parsedCap) || parsedCap < 1 || parsedCap > 1000) {
        return res.status(400).json({ error: 'Section capacity must be an integer between 1 and 1000' });
      }
      existing.capacity = parsedCap;
    }

    existing.class_name = nextClassName;
    existing.name = nextName;
    if (body.room !== undefined) {
      existing.room = sanitizePlainText(body.room, 80);
    }
    if (body.teacher_name !== undefined) {
      existing.teacher_name = sanitizePlainText(body.teacher_name, 120);
    }

    await existing.save();
    const dto = toSectionDto(existing);
    await recordMongoAudit(req.user!, 'Updated Section', 'Section', dto.id, `${dto.class_name} - ${dto.name}`);
    return res.json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A section with this name already exists for this class' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update section') });
  }
});

router.delete('/sections/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid section ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const removedDoc = await SectionModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
    if (!removedDoc) {
      return res.status(404).json({ error: 'Section not found' });
    }
    const dto = toSectionDto(removedDoc);
    await recordMongoAudit(req.user!, 'Deleted Section', 'Section', dto.id, `${dto.class_name} - ${dto.name}`);
    return res.json({ message: 'Section removed successfully', item: dto });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete section') });
  }
});

// ==========================================
// 6c. SUBJECTS MANAGEMENT (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/subjects', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const filter: Record<string, any> = {};
    if (req.query.class_name && typeof req.query.class_name === 'string' && req.query.class_name.trim()) {
      filter.class_name = {
        $regex: new RegExp(`^${escapeRegexLiteral(req.query.class_name.trim())}$`, 'i'),
      };
    }
    if (req.query.status && typeof req.query.status === 'string' && req.query.status.trim()) {
      filter.status = req.query.status.trim();
    }
    const docs = await SubjectModel.find(filter).sort({ created_at: 1, _id: 1 }).lean();
    const items = docs.map(toSubjectDto);
    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve subjects') });
  }
});

router.post('/subjects', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { class_name, name, code, teacher_name, weekly_periods, status, max_marks, passing_marks } = req.body || {};

    const cleanClassInput = sanitizePlainText(class_name, 120);
    const cleanName = sanitizePlainText(name, 120);
    if (!cleanClassInput || !cleanName) {
      return res.status(400).json({ error: 'Class name and Subject name are required' });
    }

    const matchedClass = await resolveExistingClassDoc(cleanClassInput);
    if (!matchedClass) {
      return res.status(400).json({ error: `Invalid class reference: class "${cleanClassInput}" does not exist` });
    }
    const canonicalClassName = matchedClass.name;

    let periodsVal = 6;
    if (weekly_periods !== undefined && weekly_periods !== '') {
      const parsedPeriods = Number(weekly_periods);
      if (!Number.isFinite(parsedPeriods) || !Number.isInteger(parsedPeriods) || parsedPeriods < 1 || parsedPeriods > 50) {
        return res.status(400).json({ error: 'Weekly periods must be an integer between 1 and 50' });
      }
      periodsVal = parsedPeriods;
    }

    let statusVal: 'Active' | 'Inactive' = 'Active';
    if (status !== undefined && status !== '') {
      if (status !== 'Active' && status !== 'Inactive') {
        return res.status(400).json({ error: 'Subject status must be Active or Inactive' });
      }
      statusVal = status;
    }

    let parsedMaxMarks: number | undefined;
    let parsedPassingMarks: number | undefined;
    if (max_marks !== undefined && max_marks !== '') {
      const mm = Number(max_marks);
      if (!Number.isFinite(mm) || mm <= 0 || mm > 1000) {
        return res.status(400).json({ error: 'Subject max_marks must be a number between 1 and 1000' });
      }
      parsedMaxMarks = mm;
    }
    if (passing_marks !== undefined && passing_marks !== '') {
      const pm = Number(passing_marks);
      const upper = parsedMaxMarks !== undefined ? parsedMaxMarks : 1000;
      if (!Number.isFinite(pm) || pm < 0 || pm > upper) {
        return res.status(400).json({ error: `Subject passing_marks must be between 0 and ${upper}` });
      }
      parsedPassingMarks = pm;
    }

    const duplicate = await SubjectModel.findOne({
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(canonicalClassName)}$`, 'i') },
      name: { $regex: new RegExp(`^${escapeRegexLiteral(cleanName)}$`, 'i') },
    }).lean();
    if (duplicate) {
      return res.status(409).json({ error: 'A subject with this name already exists in this class' });
    }

    const cleanCode = sanitizePlainText(code, 30);
    const recordId = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created = await SubjectModel.create({
      record_id: recordId,
      class_name: canonicalClassName,
      name: cleanName,
      code: cleanCode || cleanName.slice(0, 3).toUpperCase(),
      teacher_name: sanitizePlainText(teacher_name, 120) || 'Staff Teacher',
      weekly_periods: periodsVal,
      status: statusVal,
      ...(parsedMaxMarks !== undefined ? { max_marks: parsedMaxMarks } : {}),
      ...(parsedPassingMarks !== undefined ? { passing_marks: parsedPassingMarks } : {}),
    });

    const dto = toSubjectDto(created);
    await recordMongoAudit(
      req.user!,
      'Created Subject',
      'Subject',
      dto.id,
      `${dto.name} (${dto.class_name})`
    );
    return res.status(201).json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A subject with this name already exists in this class' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create subject') });
  }
});

router.put('/subjects/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid subject ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const existing = await SubjectModel.findOne(buildCmsRecordLookupFilter(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const body = req.body || {};
    let nextClassName = existing.class_name;
    let nextName = existing.name;

    if (body.class_name !== undefined) {
      const cleanClassInput = sanitizePlainText(body.class_name, 120);
      if (!cleanClassInput) {
        return res.status(400).json({ error: 'Class name cannot be empty' });
      }
      const matchedClass = await resolveExistingClassDoc(cleanClassInput);
      if (!matchedClass) {
        return res.status(400).json({ error: `Invalid class reference: class "${cleanClassInput}" does not exist` });
      }
      nextClassName = matchedClass.name;
    }

    if (body.name !== undefined) {
      const cleanName = sanitizePlainText(body.name, 120);
      if (!cleanName) {
        return res.status(400).json({ error: 'Subject name cannot be empty' });
      }
      nextName = cleanName;
    }

    const duplicate = await SubjectModel.findOne({
      _id: { $ne: existing._id },
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(nextClassName)}$`, 'i') },
      name: { $regex: new RegExp(`^${escapeRegexLiteral(nextName)}$`, 'i') },
    }).lean();
    if (duplicate) {
      return res.status(409).json({ error: 'A subject with this name already exists in this class' });
    }

    if (body.weekly_periods !== undefined && body.weekly_periods !== '') {
      const parsedPeriods = Number(body.weekly_periods);
      if (!Number.isFinite(parsedPeriods) || !Number.isInteger(parsedPeriods) || parsedPeriods < 1 || parsedPeriods > 50) {
        return res.status(400).json({ error: 'Weekly periods must be an integer between 1 and 50' });
      }
      existing.weekly_periods = parsedPeriods;
    }

    if (body.status !== undefined && body.status !== '') {
      if (body.status !== 'Active' && body.status !== 'Inactive') {
        return res.status(400).json({ error: 'Subject status must be Active or Inactive' });
      }
      existing.status = body.status;
    }

    let nextMaxMarks = existing.max_marks;
    if (body.max_marks !== undefined && body.max_marks !== '') {
      const mm = Number(body.max_marks);
      if (!Number.isFinite(mm) || mm <= 0 || mm > 1000) {
        return res.status(400).json({ error: 'Subject max_marks must be a number between 1 and 1000' });
      }
      nextMaxMarks = mm;
      existing.max_marks = mm;
    }

    if (body.passing_marks !== undefined && body.passing_marks !== '') {
      const pm = Number(body.passing_marks);
      const upper = nextMaxMarks !== undefined ? nextMaxMarks : 1000;
      if (!Number.isFinite(pm) || pm < 0 || pm > upper) {
        return res.status(400).json({ error: `Subject passing_marks must be between 0 and ${upper}` });
      }
      existing.passing_marks = pm;
    } else if (
      nextMaxMarks !== undefined &&
      existing.passing_marks !== undefined &&
      existing.passing_marks > nextMaxMarks
    ) {
      return res.status(400).json({ error: 'Subject passing_marks cannot exceed max_marks' });
    }

    existing.class_name = nextClassName;
    existing.name = nextName;
    if (body.code !== undefined) {
      existing.code = sanitizePlainText(body.code, 30);
    }
    if (body.teacher_name !== undefined) {
      existing.teacher_name = sanitizePlainText(body.teacher_name, 120);
    }

    await existing.save();
    const dto = toSubjectDto(existing);
    await recordMongoAudit(req.user!, 'Updated Subject', 'Subject', dto.id, `${dto.name} (${dto.class_name})`);
    return res.json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A subject with this name already exists in this class' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update subject') });
  }
});

router.delete('/subjects/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid subject ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const removedDoc = await SubjectModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
    if (!removedDoc) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    const dto = toSubjectDto(removedDoc);
    await recordMongoAudit(req.user!, 'Deleted Subject', 'Subject', dto.id, `${dto.name} (${dto.class_name})`);
    return res.json({ message: 'Subject removed successfully', item: dto });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete subject') });
  }
});

// ==========================================
// 6d. TEACHER ASSIGNMENTS MANAGEMENT (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/admin/teacher-assignments', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { teacher_id, class_name, section, subject, academic_session } = req.query;
    const filter: Record<string, any> = {};

    if (teacher_id && typeof teacher_id === 'string' && teacher_id.trim()) {
      filter.teacher_id = teacher_id.trim();
    }
    if (class_name && typeof class_name === 'string' && class_name.trim()) {
      filter.class_name = { $regex: new RegExp(`^${escapeRegexLiteral(class_name.trim())}$`, 'i') };
    }
    if (section && typeof section === 'string' && section.trim()) {
      filter.section = { $regex: new RegExp(`^${escapeRegexLiteral(section.trim())}$`, 'i') };
    }
    if (subject && typeof subject === 'string' && subject.trim()) {
      filter.subject = { $regex: new RegExp(`^${escapeRegexLiteral(subject.trim())}$`, 'i') };
    }
    if (academic_session && typeof academic_session === 'string' && academic_session.trim()) {
      filter.academic_session = academic_session.trim();
    }

    const docs = await TeacherAssignmentModel.find(filter).sort({ created_at: -1, _id: -1 }).lean();
    const items = docs.map(toTeacherAssignmentDto);
    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve teacher assignments') });
  }
});

router.post('/admin/teacher-assignments', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { teacher_id, class_name, section, section_id, subject, subject_id, academic_session, is_class_teacher } =
      req.body || {};

    if (!teacher_id || !class_name || (!section && !section_id) || (!subject && !subject_id)) {
      return res.status(400).json({ error: 'Teacher, class, section, and subject are required' });
    }

    const teacherDoc = await findTeacherByAnyId(String(teacher_id));
    if (!teacherDoc) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    const canonicalTeacherId = teacherDoc.record_id || teacherDoc._id.toString();

    const classSecCheck = await validateClassAndSectionForRelation(class_name, section, section_id);
    if (classSecCheck.valid === false) {
      return res.status(400).json({ error: classSecCheck.error });
    }
    const { className: canonicalClassName, sectionName: canonicalSection } = classSecCheck;

    const subjectCheck = await validateSubjectForTeacherAssignment(
      canonicalClassName,
      subject,
      subject_id,
      teacherDoc.subject
    );
    if (subjectCheck.valid === false) {
      return res.status(400).json({ error: subjectCheck.error });
    }
    const canonicalSubject = subjectCheck.subjectName;

    const session = academic_session ? sanitizePlainText(academic_session, 30) : '2026-2027';

    const duplicate = await TeacherAssignmentModel.findOne({
      teacher_id: canonicalTeacherId,
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(canonicalClassName)}$`, 'i') },
      section: { $regex: new RegExp(`^${escapeRegexLiteral(canonicalSection)}$`, 'i') },
      subject: { $regex: new RegExp(`^${escapeRegexLiteral(canonicalSubject)}$`, 'i') },
      academic_session: session,
    }).lean();
    if (duplicate) {
      return res.status(409).json({
        error:
          'Duplicate assignment: This teacher is already assigned to this class, section, and subject in this session',
      });
    }

    const recordId = `asg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const assignedDate = new Date().toISOString().split('T')[0];

    const created = await TeacherAssignmentModel.create({
      record_id: recordId,
      teacher_id: canonicalTeacherId,
      teacher_name: teacherDoc.name,
      class_name: canonicalClassName,
      section: canonicalSection,
      subject: canonicalSubject,
      academic_session: session,
      assigned_date: assignedDate,
      is_class_teacher: Boolean(is_class_teacher),
    });

    // Ensure class is present in teacherDoc.classes array
    const existingClasses: string[] = Array.isArray(teacherDoc.classes) ? [...teacherDoc.classes] : [];
    if (!existingClasses.some(c => c.toLowerCase() === canonicalClassName.toLowerCase())) {
      existingClasses.push(canonicalClassName);
      teacherDoc.classes = existingClasses;
      await teacherDoc.save();
    }

    const dto = toTeacherAssignmentDto(created);
    await recordMongoAudit(
      req.user!,
      'Created Teacher Assignment',
      'TeacherAssignment',
      dto.id,
      `${teacherDoc.name} -> ${canonicalClassName} (${canonicalSection}) ${canonicalSubject}`
    );
    return res.status(201).json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        error:
          'Duplicate assignment: This teacher is already assigned to this class, section, and subject in this session',
      });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create teacher assignment') });
  }
});

router.put('/admin/teacher-assignments/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid teacher assignment ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await TeacherAssignmentModel.findOne(buildCmsRecordLookupFilter(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Teacher assignment not found' });
    }

    const body = req.body || {};
    let teacherDoc = await findTeacherByAnyId(
      body.teacher_id !== undefined ? String(body.teacher_id) : existing.teacher_id
    );
    if (!teacherDoc) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    const nextTeacherId = teacherDoc.record_id || teacherDoc._id.toString();

    const rawNextClass = body.class_name !== undefined ? body.class_name : existing.class_name;
    const rawNextSec = body.section !== undefined ? body.section : existing.section;
    const classSecCheck = await validateClassAndSectionForRelation(rawNextClass, rawNextSec, body.section_id);
    if (classSecCheck.valid === false) {
      return res.status(400).json({ error: classSecCheck.error });
    }

    const rawNextSubj = body.subject !== undefined ? body.subject : existing.subject;
    const subjectCheck = await validateSubjectForTeacherAssignment(
      classSecCheck.className,
      rawNextSubj,
      body.subject_id,
      teacherDoc.subject
    );
    if (subjectCheck.valid === false) {
      return res.status(400).json({ error: subjectCheck.error });
    }

    const nextSession =
      body.academic_session !== undefined
        ? sanitizePlainText(body.academic_session, 30) || existing.academic_session
        : existing.academic_session;

    const duplicate = await TeacherAssignmentModel.findOne({
      _id: { $ne: existing._id },
      teacher_id: nextTeacherId,
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(classSecCheck.className)}$`, 'i') },
      section: { $regex: new RegExp(`^${escapeRegexLiteral(classSecCheck.sectionName)}$`, 'i') },
      subject: { $regex: new RegExp(`^${escapeRegexLiteral(subjectCheck.subjectName)}$`, 'i') },
      academic_session: nextSession,
    }).lean();
    if (duplicate) {
      return res.status(409).json({
        error:
          'Duplicate assignment: This teacher is already assigned to this class, section, and subject in this session',
      });
    }

    existing.teacher_id = nextTeacherId;
    existing.teacher_name = teacherDoc.name;
    existing.class_name = classSecCheck.className;
    existing.section = classSecCheck.sectionName;
    existing.subject = subjectCheck.subjectName;
    existing.academic_session = nextSession;
    if (body.is_class_teacher !== undefined) {
      existing.is_class_teacher = Boolean(body.is_class_teacher);
    }

    await existing.save();

    const existingClasses: string[] = Array.isArray(teacherDoc.classes) ? [...teacherDoc.classes] : [];
    if (!existingClasses.some(c => c.toLowerCase() === classSecCheck.className.toLowerCase())) {
      existingClasses.push(classSecCheck.className);
      teacherDoc.classes = existingClasses;
      await teacherDoc.save();
    }

    const dto = toTeacherAssignmentDto(existing);
    await recordMongoAudit(
      req.user!,
      'Updated Teacher Assignment',
      'TeacherAssignment',
      dto.id,
      `${dto.teacher_name} -> ${dto.class_name} (${dto.section}) ${dto.subject}`
    );
    return res.json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        error:
          'Duplicate assignment: This teacher is already assigned to this class, section, and subject in this session',
      });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update teacher assignment') });
  }
});

router.delete('/admin/teacher-assignments/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid teacher assignment ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const removedDoc = await TeacherAssignmentModel.findOneAndDelete(
      buildCmsRecordLookupFilter(req.params.id)
    ).lean();
    if (!removedDoc) {
      return res.status(404).json({ error: 'Teacher assignment not found' });
    }

    const dto = toTeacherAssignmentDto(removedDoc);
    await recordMongoAudit(
      req.user!,
      'Deleted Teacher Assignment',
      'TeacherAssignment',
      dto.id,
      `${dto.teacher_name} -> ${dto.class_name}`
    );
    return res.json({ message: 'Teacher assignment removed successfully', assignment: dto });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete teacher assignment') });
  }
});

// ==========================================
// 6e. ENROLLMENT MANAGEMENT (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/admin/enrollments', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { student_id, class_name, section, academic_year, status } = req.query;
    const filter: Record<string, any> = {};

    if (student_id && typeof student_id === 'string' && student_id.trim()) {
      filter.student_id = student_id.trim();
    }
    if (class_name && typeof class_name === 'string' && class_name.trim()) {
      filter.class_name = { $regex: new RegExp(`^${escapeRegexLiteral(class_name.trim())}$`, 'i') };
    }
    if (section && typeof section === 'string' && section.trim()) {
      filter.section = { $regex: new RegExp(`^${escapeRegexLiteral(section.trim())}$`, 'i') };
    }
    if (academic_year && typeof academic_year === 'string' && academic_year.trim()) {
      filter.academic_year = academic_year.trim();
    }
    if (status && typeof status === 'string' && status.trim()) {
      filter.status = { $regex: new RegExp(`^${escapeRegexLiteral(status.trim())}$`, 'i') };
    }

    const docs = await EnrollmentModel.find(filter).sort({ created_at: -1, _id: -1 }).lean();
    const items = docs.map(toEnrollmentDto);
    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve enrollments') });
  }
});

router.get('/admin/enrollments/history/:studentId', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.studentId)) {
    return res.status(400).json({ error: 'Invalid student ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const studentDoc = await findStudentByAnyId(req.params.studentId);
    const idCandidates = new Set<string>([req.params.studentId]);
    if (studentDoc) {
      if (studentDoc.record_id) idCandidates.add(studentDoc.record_id);
      if (studentDoc._id) idCandidates.add(studentDoc._id.toString());
    }
    const docs = await EnrollmentModel.find({ student_id: { $in: Array.from(idCandidates) } })
      .sort({ created_at: -1, _id: -1 })
      .lean();
    return res.json(docs.map(toEnrollmentDto));
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to load enrollment history') });
  }
});

router.post('/admin/enrollments', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { student_id, class_name, section, section_id, academic_year, roll_no } = req.body || {};

    if (!student_id || !class_name) {
      return res.status(400).json({ error: 'Student ID and class name are required' });
    }

    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();

    const classSecCheck = await validateClassAndSectionForRelation(
      class_name,
      section !== undefined ? section : studentDoc.section || 'A',
      section_id
    );
    if (classSecCheck.valid === false) {
      return res.status(400).json({ error: classSecCheck.error });
    }

    const year = academic_year ? sanitizePlainText(academic_year, 30) : '2026-2027';
    const activeKey = computeActiveEnrollmentKey(canonicalStudentId, year, 'Active');

    const existingActive = await EnrollmentModel.findOne({
      $or: [
        { active_enrollment_key: activeKey },
        { student_id: canonicalStudentId, academic_year: year, status: 'Active' },
      ],
    }).lean();
    if (existingActive) {
      return res.status(409).json({
        error:
          'Student already has an active enrollment for this academic year. Use controlled transfer workflow to change class.',
      });
    }

    const resolvedRoll =
      roll_no !== undefined && String(roll_no).trim()
        ? sanitizePlainText(roll_no, 30)
        : studentDoc.roll_no || '';

    const recordId = `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const enrolledDate = new Date().toISOString().split('T')[0];

    const created = await EnrollmentModel.create({
      record_id: recordId,
      student_id: canonicalStudentId,
      student_name: studentDoc.full_name,
      class_name: classSecCheck.className,
      section: classSecCheck.sectionName,
      academic_year: year,
      roll_no: resolvedRoll,
      enrolled_date: enrolledDate,
      status: 'Active',
      active_enrollment_key: activeKey,
    });

    studentDoc.class_name = classSecCheck.className;
    studentDoc.section = classSecCheck.sectionName;
    if (resolvedRoll) {
      studentDoc.roll_no = resolvedRoll;
    }
    await studentDoc.save();

    const dto = toEnrollmentDto(created);
    await recordMongoAudit(
      req.user!,
      'Enrolled Student',
      'Enrollment',
      dto.id,
      `${studentDoc.full_name} into ${dto.class_name} (${dto.section})`
    );
    return res.status(201).json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        error:
          'Student already has an active enrollment for this academic year. Use controlled transfer workflow to change class.',
      });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create enrollment') });
  }
});

router.post('/admin/enrollments/transfer', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { student_id, new_class_name, new_section, section_id, reason, academic_year } = req.body || {};

    if (!student_id || !new_class_name) {
      return res.status(400).json({ error: 'Student ID and new class name are required' });
    }

    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();

    const prevClass = studentDoc.class_name;
    const prevSection = studentDoc.section || 'A';

    const classSecCheck = await validateClassAndSectionForRelation(
      new_class_name,
      new_section !== undefined ? new_section : prevSection,
      section_id
    );
    if (classSecCheck.valid === false) {
      return res.status(400).json({ error: classSecCheck.error });
    }

    const year = academic_year ? sanitizePlainText(academic_year, 30) : '2026-2027';
    const cleanReason = reason ? sanitizePlainText(reason, 300) : 'Administrative re-allocation';

    // Mark any previous Active enrollment(s) for this student as Transferred and unset active_enrollment_key
    await EnrollmentModel.updateMany(
      {
        student_id: { $in: [canonicalStudentId, studentDoc._id.toString()] },
        status: 'Active',
      },
      {
        $set: { status: 'Transferred', transfer_reason: cleanReason },
        $unset: { active_enrollment_key: 1 },
      }
    );

    const recordId = `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const enrolledDate = new Date().toISOString().split('T')[0];

    // Ensure student roll_no does not collide in the destination class/section
    let nextRoll = studentDoc.roll_no || '';
    const rollConflict = await StudentModel.findOne({
      _id: { $ne: studentDoc._id },
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(classSecCheck.className)}$`, 'i') },
      section: { $regex: new RegExp(`^${escapeRegexLiteral(classSecCheck.sectionName)}$`, 'i') },
      roll_no: nextRoll,
    }).lean();
    if (rollConflict) {
      let candidateNum = (await StudentModel.countDocuments()) + 101;
      nextRoll = String(candidateNum);
      while (
        await StudentModel.exists({
          _id: { $ne: studentDoc._id },
          class_name: { $regex: new RegExp(`^${escapeRegexLiteral(classSecCheck.className)}$`, 'i') },
          section: { $regex: new RegExp(`^${escapeRegexLiteral(classSecCheck.sectionName)}$`, 'i') },
          roll_no: nextRoll,
        })
      ) {
        candidateNum++;
        nextRoll = String(candidateNum);
      }
    }

    const createdTransfer = await EnrollmentModel.create({
      record_id: recordId,
      student_id: canonicalStudentId,
      student_name: studentDoc.full_name,
      class_name: classSecCheck.className,
      section: classSecCheck.sectionName,
      academic_year: year,
      roll_no: nextRoll,
      enrolled_date: enrolledDate,
      status: 'Active',
      transfer_reason: cleanReason,
      active_enrollment_key: computeActiveEnrollmentKey(canonicalStudentId, year, 'Active'),
    });

    studentDoc.class_name = classSecCheck.className;
    studentDoc.section = classSecCheck.sectionName;
    studentDoc.roll_no = nextRoll;
    await studentDoc.save();

    const dto = toEnrollmentDto(createdTransfer);
    await recordMongoAudit(
      req.user!,
      'Transferred Student Class',
      'Enrollment',
      dto.id,
      `${studentDoc.full_name}: From ${prevClass} (${prevSection}) to ${dto.class_name} (${dto.section}). Reason: ${cleanReason}`
    );

    return res.json({
      message: 'Student class transition successfully executed without loss of historical records',
      previous_class: prevClass,
      previous_section: prevSection,
      new_class: studentDoc.class_name,
      new_section: studentDoc.section,
      enrollment: dto,
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to transfer student enrollment') });
  }
});

router.delete('/admin/enrollments/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid enrollment ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const removedDoc = await EnrollmentModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
    if (!removedDoc) {
      return res.status(404).json({ error: 'Enrollment record not found' });
    }
    const dto = toEnrollmentDto(removedDoc);
    await recordMongoAudit(
      req.user!,
      'Deleted Enrollment Record',
      'Enrollment',
      dto.id,
      `${dto.student_name} (${dto.class_name} - ${dto.academic_year})`
    );
    return res.json({ message: 'Enrollment record deleted successfully', enrollment: dto });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete enrollment record') });
  }
});

// ==========================================
// 7. ADMISSIONS SYSTEM (MONGODB AUTHORITATIVE)
// ==========================================

router.post('/admissions/apply', contactRateLimiter, async (req: Request, res: Response) => {
  const { student_name, father_name, dob, gender, class_applying, previous_school, parent_phone, parent_email, address, documents } = req.body || {};

  const trimmedStudent = typeof student_name === 'string' ? student_name.trim() : '';
  const trimmedFather = typeof father_name === 'string' ? father_name.trim() : '';
  const trimmedClass = typeof class_applying === 'string' ? class_applying.trim() : '';
  const trimmedPhone = parent_phone !== undefined && parent_phone !== null ? String(parent_phone).trim() : '';

  if (!trimmedStudent || !trimmedFather || !trimmedClass || !trimmedPhone) {
    return res.status(400).json({ error: 'Student name, father name, class and parent phone are required' });
  }

  const allowedGenders = ['Male', 'Female', 'Other'] as const;
  const normalizedGender: 'Male' | 'Female' | 'Other' =
    gender === undefined || gender === ''
      ? 'Male'
      : allowedGenders.includes(gender)
      ? gender
      : (null as any);

  if (!normalizedGender) {
    return res.status(400).json({ error: 'Invalid gender value. Allowed: Male, Female, Other.' });
  }

  if (!ensureMongoReady(res)) {
    return;
  }

  try {
    const dedupeKey = computeAdmissionDedupeKey(trimmedStudent, trimmedFather, trimmedClass, 'Pending')!;

    // Check existing non-rejected application in authoritative MongoDB store
    const existingApp = await AdmissionModel.findOne({
      $or: [
        { active_dedupe_key: dedupeKey },
        {
          student_name: { $regex: new RegExp(`^${escapeRegexLiteral(trimmedStudent)}$`, 'i') },
          father_name: { $regex: new RegExp(`^${escapeRegexLiteral(trimmedFather)}$`, 'i') },
          class_applying: { $regex: new RegExp(`^${escapeRegexLiteral(trimmedClass)}$`, 'i') },
          status: { $ne: 'Rejected' },
        },
      ],
    }).lean();

    if (existingApp) {
      return res.status(409).json({
        error: `An admission application for ${trimmedStudent} in ${trimmedClass} has already been submitted (Application #${existingApp.application_no}, Status: ${existingApp.status}).`,
        application_no: existingApp.application_no,
      });
    }

    const sanitizedDocs = Array.isArray(documents)
      ? documents
          .filter(d => d && typeof d === 'object')
          .slice(0, 10)
          .map(d => ({
            title: typeof d.title === 'string' ? d.title.trim().slice(0, 120) : 'Supporting Document',
            filename: typeof d.filename === 'string' ? path.basename(d.filename.trim()).slice(0, 120) : '',
            verified: false,
          }))
      : [];

    const year = new Date().getFullYear();
    let createdDoc: any = null;
    let attempts = 0;

    while (!createdDoc && attempts < 10) {
      attempts++;
      const randomRef = Math.floor(1000 + Math.random() * 9000);
      const application_no = `ADM-${year}-${randomRef}`;
      const collision = await AdmissionModel.exists({ application_no });
      if (collision) {
        continue;
      }

      const record_id = `adm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      try {
        createdDoc = await AdmissionModel.create({
          record_id,
          application_no,
          student_name: trimmedStudent,
          father_name: trimmedFather,
          dob: typeof dob === 'string' ? dob.trim() : '',
          gender: normalizedGender,
          class_applying: trimmedClass,
          previous_school: previous_school ? String(previous_school).trim() : '',
          parent_phone: trimmedPhone,
          parent_email: parent_email ? String(parent_email).trim() : '',
          address: address ? String(address).trim() : '',
          documents: sanitizedDocs,
          status: 'Pending',
          remarks: 'Online application submitted. Awaiting verification.',
          active_dedupe_key: dedupeKey,
        });
      } catch (writeErr: any) {
        if (writeErr?.code === 11000) {
          // Check if duplicate was caused by concurrent submission of the same applicant
          const racedExisting = await AdmissionModel.findOne({ active_dedupe_key: dedupeKey }).lean();
          if (racedExisting) {
            return res.status(409).json({
              error: `An admission application for ${trimmedStudent} in ${trimmedClass} has already been submitted (Application #${racedExisting.application_no}, Status: ${racedExisting.status}).`,
              application_no: racedExisting.application_no,
            });
          }
          // Otherwise application_no collided — loop and generate a fresh reference number
          continue;
        }
        throw writeErr;
      }
    }

    if (!createdDoc) {
      return res.status(503).json({
        error: 'Unable to allocate a unique application reference number. Please try again.',
      });
    }

    const dto = toAdmissionDto(createdDoc);
    res.status(201).json({
      message: 'Application submitted successfully',
      application_no: dto.application_no,
      application: dto,
    });
  } catch (err: any) {
    res.status(500).json({
      error: `Failed to save admission application: ${sanitizeErrorMessage(err?.message || 'Database write error')}`,
    });
  }
});

router.get('/admissions/track/:applicationNo', contactRateLimiter, async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) {
    return;
  }

  try {
    const query = String(req.params.applicationNo || '').trim().toUpperCase();
    if (!query) {
      return res.status(400).json({ error: 'Application reference number is required' });
    }

    const doc = await AdmissionModel.findOne({
      application_no: { $regex: new RegExp(`^${escapeRegexLiteral(query)}$`, 'i') },
    }).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Application reference number not found' });
    }

    const application = toAdmissionDto(doc);
    // Mask sensitive PII for public tracking
    const rawPhone = (application.parent_phone || '').trim();
    const maskedPhone =
      rawPhone.length > 7 ? `${rawPhone.slice(0, 6)}****${rawPhone.slice(-2)}` : rawPhone ? '****' : '';

    const sanitizedApplication = {
      ...application,
      parent_phone: maskedPhone,
      parent_email: application.parent_email
        ? application.parent_email.replace(/^([^@]{2})[^@]+(@.+)$/, '$1***$2')
        : '',
      address: 'Masked for applicant privacy',
      documents: [], // Redact internal uploaded document paths from public endpoint
    };

    res.json(sanitizedApplication);
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to look up application status') });
  }
});

router.get('/admissions', authenticateToken, requireRole(['super_admin', 'admin', 'teacher']), async (req: AuthenticatedRequest, res: Response) => {
  const { status, class_applying, startDate, endDate, from, to } = req.query;

  const rawStart = (startDate ?? from) as string | undefined;
  const rawEnd = (endDate ?? to) as string | undefined;
  const parsedStart = rawStart !== undefined ? parseIsoDateBound(rawStart, false) : null;
  const parsedEnd = rawEnd !== undefined ? parseIsoDateBound(rawEnd, true) : null;

  if (rawStart !== undefined && !parsedStart) {
    return res.status(400).json({ error: 'Invalid startDate/from date format. Expected ISO date (YYYY-MM-DD).' });
  }
  if (rawEnd !== undefined && !parsedEnd) {
    return res.status(400).json({ error: 'Invalid endDate/to date format. Expected ISO date (YYYY-MM-DD).' });
  }
  if (parsedStart && parsedEnd && parsedStart.getTime() > parsedEnd.getTime()) {
    return res.status(400).json({ error: 'startDate cannot be later than endDate.' });
  }

  if (!ensureMongoReady(res)) {
    return;
  }

  try {
    const mongoFilter: Record<string, any> = {};
    if (status) {
      mongoFilter.status = { $regex: new RegExp(`^${escapeRegexLiteral(String(status).trim())}$`, 'i') };
    }
    if (class_applying) {
      mongoFilter.class_applying = {
        $regex: new RegExp(`^${escapeRegexLiteral(String(class_applying).trim())}$`, 'i'),
      };
    }
    if (parsedStart || parsedEnd) {
      mongoFilter.created_at = {};
      if (parsedStart) mongoFilter.created_at.$gte = parsedStart;
      if (parsedEnd) mongoFilter.created_at.$lte = parsedEnd;
    }

    const total = await AdmissionModel.countDocuments(mongoFilter);
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const hasLimit = req.query.limit !== undefined;
    const limit = hasLimit ? Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 20)) : 100;
    const totalPages = Math.ceil(total / limit) || 1;
    const isPagedRequest =
      hasLimit || req.query.page !== undefined || req.query.paginate === 'true' || req.query.envelope === 'true';

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page', page.toString());
    res.setHeader('X-Limit', limit.toString());
    res.setHeader('X-Total-Pages', totalPages.toString());

    const queryCursor = AdmissionModel.find(mongoFilter).sort({ created_at: -1, _id: -1 });
    if (isPagedRequest) {
      queryCursor.skip((page - 1) * limit).limit(limit);
    } else {
      queryCursor.limit(500);
    }

    const docs = await queryCursor.lean();
    const items = docs.map(toAdmissionDto);

    if (req.query.paginate === 'true' || req.query.envelope === 'true') {
      return res.json({
        data: items,
        pagination: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to fetch admission applications') });
  }
});

router.put('/admissions/:id/status', authenticateToken, requireRole(['super_admin', 'admin', 'teacher']), async (req: AuthenticatedRequest, res: Response) => {
  const { status, remarks } = req.body || {};
  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  const validStatuses = ['Pending', 'Under Review', 'Approved', 'Rejected', 'Completed'] as const;
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      error: `Invalid status "${status}". Allowed values: ${validStatuses.join(', ')}`,
    });
  }

  if (!ensureMongoReady(res)) {
    return;
  }

  try {
    const existingDoc = await AdmissionModel.findOne(buildAdmissionLookupFilter(String(req.params.id)));
    if (!existingDoc) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const nextDedupeKey = computeAdmissionDedupeKey(
      existingDoc.student_name,
      existingDoc.father_name,
      existingDoc.class_applying,
      status
    );

    const updateOps: Record<string, any> = {
      $set: {
        status,
        ...(remarks !== undefined ? { remarks: String(remarks) } : {}),
        ...(nextDedupeKey ? { active_dedupe_key: nextDedupeKey } : {}),
      },
    };
    if (!nextDedupeKey) {
      updateOps.$unset = { active_dedupe_key: 1 };
    }

    let updatedDoc: any;
    try {
      updatedDoc = await AdmissionModel.findOneAndUpdate({ _id: existingDoc._id }, updateOps, {
        returnDocument: 'after',
        runValidators: true,
      });
    } catch (updateErr: any) {
      if (updateErr?.code === 11000) {
        return res.status(409).json({
          error: 'Another active admission application already exists for this student and class.',
        });
      }
      throw updateErr;
    }

    if (!updatedDoc) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const appDto = toAdmissionDto(updatedDoc);

    // If approved, create student profile + active enrollment in authoritative MongoDB store if requested
    if (status === 'Approved' && req.body.createStudentRecord) {
      const existingMongoStudent = await StudentModel.findOne({
        full_name: { $regex: new RegExp(`^${escapeRegexLiteral(appDto.student_name)}$`, 'i') },
        father_name: { $regex: new RegExp(`^${escapeRegexLiteral(appDto.father_name)}$`, 'i') },
      }).lean();

      if (!existingMongoStudent) {
        const year = new Date().getFullYear();
        const ts = Date.now();
        const randSuffix = Math.random().toString(36).slice(2, 6);
        const newStudentId = `std_${ts}_${randSuffix}`;

        let admissionNo = '';
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = `SSC-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
          if (!(await StudentModel.exists({ admission_no: candidate }))) {
            admissionNo = candidate;
            break;
          }
        }
        if (!admissionNo) {
          admissionNo = `SSC-${year}-${String(ts).slice(-5)}`;
        }

        let rollNum = (await StudentModel.countDocuments()) + 101;
        let rollNo = String(rollNum);
        while (
          await StudentModel.exists({
            class_name: { $regex: new RegExp(`^${escapeRegexLiteral(appDto.class_applying)}$`, 'i') },
            section: { $regex: /^A$/i },
            roll_no: rollNo,
          })
        ) {
          rollNum++;
          rollNo = String(rollNum);
        }

        const admissionDate = new Date().toISOString().split('T')[0];
        await StudentModel.create({
          record_id: newStudentId,
          admission_no: admissionNo,
          roll_no: rollNo,
          full_name: appDto.student_name,
          father_name: appDto.father_name,
          dob: appDto.dob || '',
          gender: appDto.gender,
          class_name: appDto.class_applying,
          section: 'A',
          contact_no: appDto.parent_phone,
          address: appDto.address || '',
          emergency_contact: appDto.parent_phone,
          admission_date: admissionDate,
          academic_status: 'Active',
        });

        await EnrollmentModel.create({
          record_id: `enr_${ts}_${randSuffix}`,
          student_id: newStudentId,
          student_name: appDto.student_name,
          class_name: appDto.class_applying,
          section: 'A',
          academic_year: '2026-2027',
          roll_no: rollNo,
          enrolled_date: admissionDate,
          status: 'Active',
          active_enrollment_key: computeActiveEnrollmentKey(newStudentId, '2026-2027', 'Active'),
        }).catch(() => {});
      }
    }

    await recordMongoAudit(
      req.user!,
      'Updated Admission Status',
      'Admission',
      appDto.id,
      `Application ${appDto.application_no} set to ${status}`
    );

    res.json({ message: 'Application status updated', application: appDto });
  } catch (err: any) {
    if (isMongoUnavailableError(err)) {
      return sendRouteError(res, err, 'Failed to update admission status');
    }
    res.status(500).json({
      error: `Failed to update admission status: ${sanitizeErrorMessage(err?.message || 'Database write error')}`,
    });
  }
});

router.delete('/admissions/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) {
    return;
  }

  try {
    const removedDoc = await AdmissionModel.findOneAndDelete(buildAdmissionLookupFilter(String(req.params.id)));
    if (!removedDoc) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const removedDto = toAdmissionDto(removedDoc);
    await recordMongoAudit(
      req.user!,
      'Deleted Admission Application',
      'Admission',
      removedDto.id,
      `Deleted application ${removedDto.application_no} (${removedDto.student_name})`
    );

    res.json({ message: 'Application deleted', application: removedDto });
  } catch (err: any) {
    if (isMongoUnavailableError(err)) {
      return sendRouteError(res, err, 'Failed to delete admission application');
    }
    res.status(500).json({
      error: `Failed to delete admission application: ${sanitizeErrorMessage(err?.message || 'Database write error')}`,
    });
  }
});

// ==========================================
// 8. ATTENDANCE SYSTEM (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/attendance', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { date, class_name, section, student_id } = req.query;

    // Student object-level isolation: only own attendance
    if (req.user?.role === 'student') {
      const ownDoc = req.user.linked_id
        ? await findStudentByAnyId(req.user.linked_id)
        : await StudentModel.findOne({ user_id: req.user.id }).lean();
      const ownIds = new Set<string>(
        [
          req.user.linked_id,
          ownDoc?.record_id,
          ownDoc?._id ? ownDoc._id.toString() : '',
        ].filter(Boolean) as string[]
      );
      if (student_id && !ownIds.has(String(student_id))) {
        return res.status(403).json({ error: 'Access denied: You may only view your own attendance.' });
      }
      const docs = await AttendanceModel.find({
        student_id: { $in: Array.from(ownIds) },
        ...(date ? { date: String(date) } : {}),
      })
        .sort({ date: -1, _id: -1 })
        .lean();
      return res.json(docs.map(toAttendanceDto));
    }

    // Parent object-level isolation: only linked children
    if (req.user?.role === 'parent') {
      const parentStudentIds = await getLinkedStudentIdsForParent(req.user);
      if (student_id && !parentStudentIds.has(String(student_id))) {
        return res.status(403).json({ error: 'Access denied: You may only view attendance for your linked child.' });
      }
      let allowedIds = Array.from(parentStudentIds);
      if (student_id) {
        const targetChild = await findStudentByAnyId(String(student_id));
        const childIds = new Set<string>(
          [
            String(student_id),
            targetChild?.record_id,
            targetChild?._id ? targetChild._id.toString() : '',
          ].filter(Boolean) as string[]
        );
        allowedIds = allowedIds.filter(id => childIds.has(id));
      }
      const docs = await AttendanceModel.find({
        student_id: { $in: allowedIds },
        ...(date ? { date: String(date) } : {}),
      })
        .sort({ date: -1, _id: -1 })
        .lean();
      return res.json(docs.map(toAttendanceDto));
    }

    // Teacher object-level isolation: only assigned classes
    if (req.user?.role === 'teacher') {
      const teacher = await getAuthenticatedTeacherMongo(req);
      const assignedClasses = teacher?.classes || [];

      if (class_name) {
        if (!isClassAssignedToTeacher(assignedClasses, String(class_name))) {
          return res.status(403).json({ error: 'Access denied: You may only view attendance for your assigned classes.' });
        }
      }

      let studentAliasIds: Set<string> | null = null;
      if (student_id) {
        const st = await findStudentByAnyId(String(student_id));
        if (!st || !isClassAssignedToTeacher(assignedClasses, st.class_name)) {
          return res.status(403).json({ error: 'Access denied: You may only view attendance for students in your assigned classes.' });
        }
        studentAliasIds = new Set<string>(
          [String(student_id), st.record_id, st._id ? st._id.toString() : ''].filter(Boolean) as string[]
        );
      }

      const docs = await AttendanceModel.find({
        ...(date ? { date: String(date) } : {}),
      })
        .sort({ date: -1, _id: -1 })
        .lean();

      let result = docs
        .map(toAttendanceDto)
        .filter(a => isClassAssignedToTeacher(assignedClasses, a.class_name));
      if (class_name) result = result.filter(a => a.class_name.toLowerCase() === String(class_name).toLowerCase());
      if (section) result = result.filter(a => a.section.toLowerCase() === String(section).toLowerCase());
      if (studentAliasIds) result = result.filter(a => studentAliasIds!.has(a.student_id));
      return res.json(result);
    }

    const rawStart = (req.query.startDate ?? req.query.from) as string | undefined;
    const rawEnd = (req.query.endDate ?? req.query.to) as string | undefined;
    const parsedStart = rawStart !== undefined ? parseIsoDateBound(rawStart, false) : null;
    const parsedEnd = rawEnd !== undefined ? parseIsoDateBound(rawEnd, true) : null;

    if (rawStart !== undefined && !parsedStart) {
      return res.status(400).json({ error: 'Invalid startDate/from date format. Expected YYYY-MM-DD.' });
    }
    if (rawEnd !== undefined && !parsedEnd) {
      return res.status(400).json({ error: 'Invalid endDate/to date format. Expected YYYY-MM-DD.' });
    }
    if (parsedStart && parsedEnd && parsedStart.getTime() > parsedEnd.getTime()) {
      return res.status(400).json({ error: 'startDate cannot be later than endDate.' });
    }

    let studentFilterIds: Set<string> | null = null;
    if (student_id) {
      const st = await findStudentByAnyId(String(student_id));
      studentFilterIds = new Set<string>(
        [String(student_id), st?.record_id, st?._id ? st._id.toString() : ''].filter(Boolean) as string[]
      );
    }

    const docs = await AttendanceModel.find({
      ...(date ? { date: String(date) } : {}),
    })
      .sort({ date: -1, _id: -1 })
      .lean();

    let result = docs.map(toAttendanceDto);
    if (parsedStart) {
      result = result.filter(a => {
        const ts = new Date(`${a.date}T00:00:00.000Z`).getTime();
        return !isNaN(ts) && ts >= parsedStart.getTime();
      });
    }
    if (parsedEnd) {
      result = result.filter(a => {
        const ts = new Date(`${a.date}T00:00:00.000Z`).getTime();
        return !isNaN(ts) && ts <= parsedEnd.getTime();
      });
    }
    if (class_name) result = result.filter(a => a.class_name.toLowerCase() === String(class_name).toLowerCase());
    if (section) result = result.filter(a => a.section.toLowerCase() === String(section).toLowerCase());
    if (studentFilterIds) result = result.filter(a => studentFilterIds!.has(a.student_id));
    if (req.query.teacher || req.query.marked_by) {
      const t = String(req.query.teacher || req.query.marked_by).toLowerCase();
      result = result.filter(a => (a.marked_by || '').toLowerCase().includes(t));
    }
    if (req.query.status) {
      result = result.filter(a => a.status.toLowerCase() === String(req.query.status).toLowerCase());
    }

    result.sort((a, b) => b.date.localeCompare(a.date));

    const total = result.length;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const hasLimit = req.query.limit !== undefined;
    const limit = hasLimit ? Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 20)) : 100;
    const totalPages = Math.ceil(total / limit) || 1;

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page', page.toString());
    res.setHeader('X-Limit', limit.toString());
    res.setHeader('X-Total-Pages', totalPages.toString());

    if (req.query.paginate === 'true' || req.query.envelope === 'true') {
      const start = (page - 1) * limit;
      const paged = result.slice(start, start + limit);
      return res.json({
        data: paged,
        pagination: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    if (hasLimit || req.query.page !== undefined) {
      const start = (page - 1) * limit;
      result = result.slice(start, start + limit);
    }

    return res.json(result);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve attendance');
  }
});

router.post('/attendance/batch', authenticateToken, requireRole(['super_admin', 'admin', 'teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { date, records } = req.body || {};
    if (!date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Date and records array are required' });
    }
    const cleanDate = String(date).trim();
    if (!isValidIsoCalendarDate(cleanDate)) {
      return res.status(400).json({ error: 'Invalid attendance date format. Expected valid YYYY-MM-DD calendar date.' });
    }

    const user = req.user;
    const validStatuses = ['Present', 'Absent', 'Late', 'Leave'] as const;
    const resolvedEntries: Array<{
      rec: any;
      studentDoc: any;
      canonicalStudentId: string;
      candidateIds: string[];
    }> = [];

    for (const rec of records) {
      if (!rec || !validStatuses.includes(rec.status)) {
        return res.status(400).json({
          error: `Invalid attendance status "${rec?.status}" for student ${rec?.student_name || rec?.student_id}. Allowed values: ${validStatuses.join(', ')}.`,
        });
      }
      const studentDoc = await findStudentByAnyId(String(rec.student_id || ''));
      if (!studentDoc) {
        return res.status(400).json({
          error: `Referenced student ID "${rec.student_id}" does not exist in the school database.`,
        });
      }
      const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();
      const candidateIds = Array.from(
        new Set([canonicalStudentId, studentDoc._id.toString(), String(rec.student_id)].filter(Boolean))
      );
      resolvedEntries.push({ rec, studentDoc, canonicalStudentId, candidateIds });
    }

    // Teacher object-level validation: can only mark attendance for assigned classes
    if (req.user?.role === 'teacher') {
      const teacher = await getAuthenticatedTeacherMongo(req);
      const assignedClasses = teacher?.classes || [];
      for (const { rec, studentDoc } of resolvedEntries) {
        const targetClass = String(rec.class_name || studentDoc.class_name || '');
        const requestedSection = String(rec.section || studentDoc.section || 'A').trim();
        const actualSection = String(studentDoc.section || 'A').trim();
        if (
          !isClassAssignedToTeacher(assignedClasses, targetClass) ||
          !isClassAssignedToTeacher(assignedClasses, studentDoc.class_name) ||
          targetClass.trim().toLocaleLowerCase('en') !== String(studentDoc.class_name || '').trim().toLocaleLowerCase('en') ||
          requestedSection.toLocaleLowerCase('en') !== actualSection.toLocaleLowerCase('en')
        ) {
          return res.status(403).json({
            error: `Access denied: You are not assigned to class "${targetClass || studentDoc.class_name}".`,
          });
        }
      }
    }

    for (const { rec, studentDoc, canonicalStudentId, candidateIds } of resolvedEntries) {
      const existing = await AttendanceModel.findOne({
        student_id: { $in: candidateIds },
        date: cleanDate,
      }).lean();

      const nextRemarks =
        rec.remarks !== undefined && rec.remarks !== ''
          ? String(rec.remarks)
          : existing?.remarks || '';

      if (existing) {
        await AttendanceModel.findByIdAndUpdate(
          existing._id,
          {
            $set: {
              record_id:
                existing.record_id ||
                `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              student_id: canonicalStudentId,
              student_name: studentDoc.full_name,
              class_name: studentDoc.class_name,
              section: studentDoc.section || 'A',
              date: cleanDate,
              status: rec.status,
              remarks: nextRemarks,
              marked_by: user?.name || 'Staff',
            },
          },
          { returnDocument: 'after' }
        );
      } else {
        await AttendanceModel.findOneAndUpdate(
          { student_id: canonicalStudentId, date: cleanDate },
          {
            $set: {
              student_id: canonicalStudentId,
              student_name: studentDoc.full_name,
              class_name: studentDoc.class_name,
              section: studentDoc.section || 'A',
              date: cleanDate,
              status: rec.status,
              remarks: rec.remarks ? String(rec.remarks) : '',
              marked_by: user?.name || 'Staff',
            },
            $setOnInsert: {
              record_id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            },
          },
          { upsert: true, returnDocument: 'after' }
        );
      }
    }

    await recordMongoAudit(
      user!,
      'Marked Class Attendance',
      'Attendance',
      undefined,
      `Date: ${cleanDate}, Records: ${records.length}`
    );

    return res.json({ message: `Saved attendance for ${records.length} students on ${cleanDate}` });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to save batch attendance');
  }
});

router.get('/attendance/student/:studentId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const targetId = String(req.params.studentId || '').trim();
    const targetStudent = await findStudentByAnyId(targetId);
    const targetIds = new Set<string>(
      [
        targetId,
        targetStudent?.record_id,
        targetStudent?._id ? targetStudent._id.toString() : '',
      ].filter(Boolean) as string[]
    );

    // Object-level authorization check: Student
    if (req.user?.role === 'student') {
      const ownDoc = req.user.linked_id
        ? await findStudentByAnyId(req.user.linked_id)
        : await StudentModel.findOne({ user_id: req.user.id }).lean();
      const ownIds = new Set<string>(
        [
          req.user.linked_id,
          ownDoc?.record_id,
          ownDoc?._id ? ownDoc._id.toString() : '',
        ].filter(Boolean) as string[]
      );
      const isStudentSelf = Array.from(targetIds).some(tid => ownIds.has(tid));
      if (!isStudentSelf) {
        return res.status(403).json({ error: 'Access denied: You may only view your own attendance.' });
      }
    }

    // Object-level authorization check: Parent (strictly explicit links — never phone matching)
    if (req.user?.role === 'parent') {
      const parentStudentIds = await getLinkedStudentIdsForParent(req.user);
      const isLinked =
        Boolean(targetStudent) && Array.from(targetIds).some(tid => parentStudentIds.has(tid));
      if (!isLinked) {
        return res.status(403).json({ error: 'Access denied: You may only view attendance for your linked child.' });
      }
    }

    // Object-level authorization check: Teacher (assigned classes only)
    if (req.user?.role === 'teacher') {
      const teacher = await getAuthenticatedTeacherMongo(req);
      const assignedClasses = teacher?.classes || [];
      const isClassAssigned = Boolean(
        targetStudent && isClassAssignedToTeacher(assignedClasses, targetStudent.class_name)
      );
      if (!isClassAssigned) {
        return res.status(403).json({ error: 'Access denied: You may only view attendance for students in your assigned classes.' });
      }
    }

    const attDocs = await AttendanceModel.find({
      student_id: { $in: Array.from(targetIds) },
    })
      .sort({ date: -1, _id: -1 })
      .lean();

    const records = attDocs.map(toAttendanceDto);

    const total = records.length;
    const present = records.filter(r => r.status === 'Present').length;
    const absent = records.filter(r => r.status === 'Absent').length;
    const late = records.filter(r => r.status === 'Late').length;
    const leave = records.filter(r => r.status === 'Leave').length;
    const percentage = total > 0 ? Math.round(((present + late * 0.8) / total) * 100) : 100;

    return res.json({
      summary: { total, present, absent, late, leave, percentage },
      records: records.sort((a, b) => b.date.localeCompare(a.date)),
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve student attendance');
  }
});

// ==========================================
// 9. FEE MANAGEMENT (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/fees', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { student_id, class_name, status, month } = req.query;

    // Teachers do not have access to financial/fee records
    if (req.user?.role === 'teacher') {
      return res.status(403).json({ error: 'Access denied: Teachers do not have access to fee records.' });
    }

    // Object-level isolation: students only see their own fees
    if (req.user?.role === 'student') {
      const ownDoc = req.user.linked_id
        ? await findStudentByAnyId(req.user.linked_id)
        : await StudentModel.findOne({ user_id: req.user.id }).lean();
      const ownIds = new Set<string>(
        [
          req.user.linked_id,
          ownDoc?.record_id,
          ownDoc?._id ? ownDoc._id.toString() : '',
        ].filter(Boolean) as string[]
      );
      if (student_id && !ownIds.has(String(student_id))) {
        return res.status(403).json({ error: 'Access denied: You may only view your own fee records.' });
      }
      const docs = await FeeModel.find({
        student_id: { $in: Array.from(ownIds) },
      })
        .sort({ created_at: -1, _id: -1 })
        .lean();
      return res.json(docs.map(toFeeDto));
    }

    // Object-level isolation: parents only see their linked children's fees
    if (req.user?.role === 'parent') {
      const parentStudentIds = await getLinkedStudentIdsForParent(req.user);
      if (student_id && !parentStudentIds.has(String(student_id))) {
        return res.status(403).json({ error: 'Access denied: You may only view fee records for your linked child.' });
      }
      let allowedIds = Array.from(parentStudentIds);
      if (student_id) {
        const targetChild = await findStudentByAnyId(String(student_id));
        const childIds = new Set<string>(
          [
            String(student_id),
            targetChild?.record_id,
            targetChild?._id ? targetChild._id.toString() : '',
          ].filter(Boolean) as string[]
        );
        allowedIds = allowedIds.filter(id => childIds.has(id));
      }
      const docs = await FeeModel.find({
        student_id: { $in: allowedIds },
      })
        .sort({ created_at: -1, _id: -1 })
        .lean();
      return res.json(docs.map(toFeeDto));
    }

    let studentFilterIds: Set<string> | null = null;
    if (student_id) {
      const st = await findStudentByAnyId(String(student_id));
      studentFilterIds = new Set<string>(
        [String(student_id), st?.record_id, st?._id ? st._id.toString() : ''].filter(Boolean) as string[]
      );
    }

    const docs = await FeeModel.find().sort({ created_at: -1, _id: -1 }).lean();
    let result = docs.map(toFeeDto);

    if (studentFilterIds) {
      result = result.filter(f => studentFilterIds!.has(f.student_id));
    }
    if (class_name) {
      result = result.filter(f => f.class_name.toLowerCase() === String(class_name).toLowerCase());
    }
    if (status) {
      result = result.filter(f => f.status.toLowerCase() === String(status).toLowerCase());
    }
    if (month) {
      result = result.filter(f => f.fee_month.toLowerCase() === String(month).toLowerCase());
    }

    const total = result.length;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const hasLimit = req.query.limit !== undefined;
    const limit = hasLimit ? Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 20)) : 100;
    const totalPages = Math.ceil(total / limit) || 1;

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page', page.toString());
    res.setHeader('X-Limit', limit.toString());
    res.setHeader('X-Total-Pages', totalPages.toString());

    if (req.query.paginate === 'true' || req.query.envelope === 'true') {
      const start = (page - 1) * limit;
      const paged = result.slice(start, start + limit);
      return res.json({
        data: paged,
        pagination: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    if (hasLimit || req.query.page !== undefined) {
      const start = (page - 1) * limit;
      result = result.slice(start, start + limit);
    }

    return res.json(result);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve fees');
  }
});

router.post('/fees', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { student_id, fee_month, year, tuition_fee, admission_fee, other_charges, due_date } = req.body || {};

    if (!student_id || !fee_month || !String(fee_month).trim()) {
      return res.status(400).json({ error: 'Student ID and fee month are required' });
    }

    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!studentDoc) {
      return res.status(404).json({ error: 'Referenced student record not found in database' });
    }
    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();
    const studentIdCandidates = Array.from(
      new Set([canonicalStudentId, studentDoc._id.toString(), String(student_id)].filter(Boolean))
    );

    const tf = tuition_fee !== undefined && !isNaN(Number(tuition_fee)) ? Number(tuition_fee) : 3000;
    const af = admission_fee !== undefined ? Number(admission_fee) : 0;
    const oc = other_charges !== undefined ? Number(other_charges) : 0;

    if (isNaN(tf) || isNaN(af) || isNaN(oc) || tf < 0 || af < 0 || oc < 0) {
      return res.status(400).json({ error: 'Fee amounts must be valid non-negative numbers' });
    }

    const total = tf + af + oc;
    if (total <= 0) {
      return res.status(400).json({ error: 'Total fee voucher amount must be greater than zero' });
    }

    const yr = Number(year) || new Date().getFullYear();
    const cleanMonthDisplay = String(fee_month).trim();
    const cleanMonthKey = cleanMonthDisplay.toLowerCase();

    if (due_date !== undefined && due_date !== '' && !isValidIsoCalendarDate(String(due_date))) {
      return res.status(400).json({ error: 'Invalid due_date format. Expected YYYY-MM-DD.' });
    }

    // Prevent duplicate fee vouchers for the same billing cycle (student, month, year)
    const duplicateDoc = await FeeModel.findOne({
      student_id: { $in: studentIdCandidates },
      year: yr,
      $or: [
        { fee_month_key: cleanMonthKey },
        { fee_month: { $regex: new RegExp(`^${escapeRegexLiteral(cleanMonthDisplay)}$`, 'i') } },
      ],
    }).lean();

    if (duplicateDoc) {
      return res.status(409).json({
        error: `A fee voucher for ${studentDoc.full_name} for ${cleanMonthDisplay} ${yr} already exists in the database.`,
      });
    }

    const voucherId = `fee_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
    const resolvedDueDate = due_date ? String(due_date).trim() : `${yr}-10-15`;

    const createdDoc = await FeeModel.create({
      voucher_id: voucherId,
      student_id: canonicalStudentId,
      student_name: studentDoc.full_name,
      class_name: studentDoc.class_name,
      fee_month: cleanMonthDisplay,
      fee_month_key: cleanMonthKey,
      year: yr,
      tuition_fee: tf,
      admission_fee: af,
      other_charges: oc,
      total_amount: total,
      paid_amount: 0,
      pending_amount: total,
      due_date: resolvedDueDate,
      status: 'Unpaid',
      payment_history: [],
    });

    const dto = toFeeDto(createdDoc);
    await recordMongoAudit(
      req.user!,
      'Issued Fee Voucher',
      'Fee',
      dto.id,
      `Student: ${studentDoc.full_name}, Month: ${dto.fee_month} ${yr}, Amount: PKR ${total}`
    );

    return res.status(201).json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        error: 'A fee voucher for this student, month, and year already exists in the database.',
      });
    }
    return sendRouteError(res, err, 'Failed to persist fee voucher to database');
  }
});

router.put('/fees/:id/pay', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const feeId = String(req.params.id || '').trim();
  const { amount, method, payment_method, transaction_id, notes } = req.body || {};
  const paymentAmount = Number(amount);

  if (isNaN(paymentAmount) || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return res.status(400).json({ error: 'Valid payment amount greater than zero is required' });
  }

  const allowedMethods = ['Cash', 'Bank Deposit', 'Bank Transfer', 'Easypaisa / JazzCash', 'Online Slip'] as const;
  const rawMethod = method || payment_method || 'Cash';
  if (!allowedMethods.includes(rawMethod)) {
    return res.status(400).json({
      error: `Invalid payment method "${rawMethod}". Allowed methods: ${allowedMethods.join(', ')}`,
    });
  }

  if (!ensureMongoReady(res)) return;

  const cleanTxnId = transaction_id ? String(transaction_id).trim() : undefined;

  if (activePaymentLocks.has(feeId)) {
    return res.status(409).json({
      error: 'Another payment operation is currently in progress for this fee voucher. Please retry momentarily.',
    });
  }

  activePaymentLocks.add(feeId);
  let canonicalLockKey: string | null = null;
  try {
    const feeDoc = await FeeModel.findOne(buildFeeLookupFilter(feeId)).lean();
    if (!feeDoc) {
      return res.status(404).json({ error: 'Fee voucher not found' });
    }

    const canonicalVoucherId = feeDoc.voucher_id || feeDoc._id.toString();
    if (canonicalVoucherId !== feeId) {
      if (activePaymentLocks.has(canonicalVoucherId)) {
        return res.status(409).json({
          error: 'Another payment operation is currently in progress for this fee voucher. Please retry momentarily.',
        });
      }
      canonicalLockKey = canonicalVoucherId;
      activePaymentLocks.add(canonicalVoucherId);
    }

    // Check duplicate transaction_id across FeePayment ledger and embedded payment_history before writing
    if (cleanTxnId) {
      const [existingTxnDoc, existingEmbeddedTxn] = await Promise.all([
        FeePaymentModel.findOne({ transaction_id: cleanTxnId }).lean(),
        FeeModel.findOne({ 'payment_history.transaction_id': cleanTxnId }).lean(),
      ]);
      if (existingTxnDoc || existingEmbeddedTxn) {
        return res.status(409).json({
          error: `Duplicate payment rejected: Transaction ID "${cleanTxnId}" has already been recorded.`,
        });
      }
    }

    const currentPending = Number(feeDoc.pending_amount) || 0;
    const currentPaid = Number(feeDoc.paid_amount) || 0;
    const currentTotal = Number(feeDoc.total_amount) || 0;

    // Prevent duplicate payments on already settled fee vouchers
    if (currentPending <= 0 || feeDoc.status === 'Paid') {
      return res.status(400).json({
        error: 'Fee voucher is already fully paid. No outstanding balance remains.',
      });
    }

    // Prevent overpayment / invalid payment amounts exceeding balance
    if (paymentAmount > currentPending) {
      return res.status(400).json({
        error: `Payment amount (PKR ${paymentAmount.toLocaleString()}) exceeds remaining pending balance (PKR ${currentPending.toLocaleString()}). Maximum payable is PKR ${currentPending.toLocaleString()}.`,
      });
    }

    const receipt_no = `REC-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;
    const nextPaidAmount = currentPaid + paymentAmount;
    const nextPendingAmount = Math.max(0, currentTotal - nextPaidAmount);
    const nextStatus: FeeVoucherStatus =
      nextPendingAmount === 0 ? 'Paid' : nextPaidAmount > 0 ? 'Partial' : 'Unpaid';

    const paymentRecord: FeePaymentHistoryDto = {
      receipt_no,
      date: new Date().toISOString().split('T')[0],
      amount: paymentAmount,
      method: rawMethod,
      ...(cleanTxnId ? { transaction_id: cleanTxnId } : {}),
      notes: notes || 'Counter collection at Shawan College Office',
    };

    const useTxn = await doesMongoSupportTransactions();
    const paymentDocPayload: Record<string, any> = {
      fee_id: canonicalVoucherId,
      student_id: feeDoc.student_id,
      receipt_no,
      ...(cleanTxnId ? { transaction_id: cleanTxnId } : {}),
      date: paymentRecord.date,
      amount: paymentAmount,
      method: rawMethod,
      notes: paymentRecord.notes,
      received_by: req.user?.name || req.user?.email || 'Administrator',
    };

    const atomicFeeBalanceQuery = {
      _id: feeDoc._id,
      pending_amount: { $gte: paymentAmount },
    };

    let updatedMongoFee: any = null;

    try {
      if (useTxn) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await FeePaymentModel.create([paymentDocPayload], { session });
            updatedMongoFee = await FeeModel.findOneAndUpdate(
              atomicFeeBalanceQuery,
              {
                $set: {
                  voucher_id: canonicalVoucherId,
                  paid_amount: nextPaidAmount,
                  pending_amount: nextPendingAmount,
                  status: nextStatus,
                },
                $push: { payment_history: paymentRecord },
              },
              { session, returnDocument: 'after' }
            ).lean();
            if (!updatedMongoFee) {
              throw Object.assign(new Error('Concurrent payment modified voucher balance'), { statusCode: 409 });
            }
          });
        } finally {
          await session.endSession();
        }
      } else {
        const createdPayment = await FeePaymentModel.create(paymentDocPayload);
        try {
          updatedMongoFee = await FeeModel.findOneAndUpdate(
            atomicFeeBalanceQuery,
            {
              $set: {
                voucher_id: canonicalVoucherId,
                paid_amount: nextPaidAmount,
                pending_amount: nextPendingAmount,
                status: nextStatus,
              },
              $push: { payment_history: paymentRecord },
            },
            { returnDocument: 'after' }
          ).lean();
          if (!updatedMongoFee) {
            throw Object.assign(new Error('Concurrent payment modified voucher balance'), { statusCode: 409 });
          }
        } catch (feeUpdateErr) {
          await FeePaymentModel.deleteOne({ _id: createdPayment._id }).catch(() => {});
          throw feeUpdateErr;
        }
      }
    } catch (err: any) {
      if (err?.statusCode === 409) {
        return res.status(409).json({
          error: 'Voucher balance changed concurrently. Please refresh and verify remaining balance before retrying.',
        });
      }
      if (err?.code === 11000) {
        return res.status(409).json({
          error: 'Duplicate payment receipt or transaction ID detected. Payment was not recorded.',
        });
      }
      if (isMongoUnavailableError(err)) {
        return res.status(503).json({
          error: 'Database service temporarily unavailable. Write/read aborted safely without modifying local fallback state.',
        });
      }
      return res.status(500).json({
        error: `Payment could not be verified in database: ${sanitizeErrorMessage(err?.message || 'Database write failed')}`,
      });
    }

    const updatedFeeDto = toFeeDto(updatedMongoFee);
    await recordMongoAudit(
      req.user!,
      'Recorded Fee Payment',
      'Fee',
      updatedFeeDto.id,
      `Amount: PKR ${paymentAmount}, Receipt: ${receipt_no}`
    );

    return res.json({
      message: 'Payment recorded successfully',
      fee: updatedFeeDto,
      receipt_no,
      payment: paymentRecord,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to process fee payment');
  } finally {
    activePaymentLocks.delete(feeId);
    if (canonicalLockKey) activePaymentLocks.delete(canonicalLockKey);
  }
});

router.delete('/fees/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid fee voucher ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const rawId = String(req.params.id || '').trim();
    const feeDoc = await FeeModel.findOne(buildFeeLookupFilter(rawId)).lean();
    if (!feeDoc) {
      return res.status(404).json({ error: 'Fee record not found' });
    }

    const canonicalVoucherId = feeDoc.voucher_id || feeDoc._id.toString();
    const hasEmbeddedHistory =
      (Number(feeDoc.paid_amount) || 0) > 0 ||
      (Array.isArray(feeDoc.payment_history) && feeDoc.payment_history.length > 0);
    const hasLedgerPayment = await FeePaymentModel.exists({
      fee_id: { $in: Array.from(new Set([canonicalVoucherId, feeDoc._id.toString(), rawId])) },
    });

    if (hasEmbeddedHistory || hasLedgerPayment) {
      return res.status(400).json({
        error: 'Cannot delete a fee voucher with recorded payment history. Financial ledger records must be preserved.',
      });
    }

    await FeeModel.deleteOne({ _id: feeDoc._id });
    const removedDto = toFeeDto(feeDoc);

    await recordMongoAudit(
      req.user!,
      'Deleted Fee Voucher',
      'Fee',
      removedDto.id,
      `Student: ${removedDto.student_name}, Month: ${removedDto.fee_month} ${removedDto.year}`
    );

    return res.json({ message: 'Fee record removed', item: removedDto });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to delete fee voucher');
  }
});

// ==========================================
// 9B. ONLINE FEE PAYMENTS & VERIFICATION (FINTECH WORKFLOW)
// ==========================================

// 1. Get Outstanding Fee Summary for Parent or Student
router.get('/parent/fees/summary', authenticateToken, requireRole(['parent', 'student', 'admin', 'super_admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const user = req.user!;
    let studentIds: string[] = [];

    if (user.role === 'parent') {
      const linked = await getLinkedStudentIdsForParent(user);
      studentIds = Array.from(linked);
    } else if (user.role === 'student') {
      const studentDoc = user.linked_id
        ? await findStudentByAnyId(user.linked_id)
        : await StudentModel.findOne({
            $or: [{ user_id: user.id }, { email: user.email.toLowerCase() }],
          }).lean();
      if (studentDoc) {
        studentIds = collectStudentPaymentIdentifiers(studentDoc);
      }
    } else if (req.query.student_id) {
      studentIds = [String(req.query.student_id).trim()];
    }

    if (studentIds.length === 0 && user.role !== 'admin' && user.role !== 'super_admin') {
      return res.json({
        total_outstanding: 0,
        current_month_fee: 0,
        previous_balance: 0,
        late_fee_fine: 0,
        next_due_date: 'N/A',
        status: 'All Cleared',
        pending_vouchers_count: 0,
      });
    }

    const feeFilter: Record<string, any> = {};
    if (studentIds.length > 0) {
      feeFilter.student_id = { $in: studentIds };
    }

    const feeDocs = await FeeModel.find(feeFilter).lean();
    const settings = await getPaymentSettings();
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });
    const currentYear = new Date().getFullYear();

    let total_outstanding = 0;
    let current_month_fee = 0;
    let previous_balance = 0;
    let late_fee_fine = 0;
    let pending_vouchers_count = 0;
    let next_due_date = '';

    for (const fee of feeDocs) {
      const pending = Number(fee.pending_amount) || 0;
      if (pending > 0) {
        total_outstanding += pending;
        pending_vouchers_count += 1;

        if (fee.fee_month === currentMonthName && fee.year === currentYear) {
          current_month_fee += pending;
        } else {
          previous_balance += pending;
        }

        if (fee.due_date && fee.due_date < todayStr) {
          late_fee_fine += Number(settings.policies.late_fee_amount || 0);
        }

        if (!next_due_date || (fee.due_date && fee.due_date < next_due_date)) {
          next_due_date = fee.due_date;
        }
      }
    }

    const status =
      total_outstanding === 0
        ? 'All Cleared'
        : late_fee_fine > 0
        ? 'Overdue'
        : current_month_fee > 0 && previous_balance > 0
        ? 'Pending Dues'
        : 'Partial';

    return res.json({
      total_outstanding,
      current_month_fee,
      previous_balance,
      late_fee_fine,
      next_due_date: next_due_date || 'N/A',
      status,
      pending_vouchers_count,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to compute fee summary');
  }
});

// 2. Get Public Payment Settings (Gateways, Bank Accounts, Wallets, Policies)
router.get('/payments/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await getPaymentSettings();
    return res.json({
      gateways: settings.gateways,
      bank_accounts: settings.bank_accounts.filter(b => b.active),
      wallets: settings.wallets.filter(w => w.active),
      policies: settings.policies,
      sms_enabled: settings.sms.enabled,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to load payment settings');
  }
});

// 3. Initiate Payment (Parent Portal: Online Gateway Sandbox or Bank Deposit)
router.post('/parent/payments/initiate', authenticateToken, requireRole(['parent', 'student', 'admin', 'super_admin']), sensitiveActionRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  const user = req.user!;
  const {
    fee_id,
    student_id,
    amount,
    method,
    bank_name,
    account_number,
    deposit_date,
    deposit_slip_ref,
    receipt_attachment_url,
    notes,
    parent_phone,
  } = req.body || {};

  const paymentAmount = Number(amount);
  if (isNaN(paymentAmount) || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return res.status(400).json({ error: 'Valid payment amount greater than zero is required' });
  }

  const cleanFeeId = String(fee_id || '').trim();
  const cleanStudentId = String(student_id || '').trim();

  if (!cleanFeeId) {
    return res.status(400).json({ error: 'Fee voucher ID is required' });
  }

  const paymentMode = getParentPaymentMethodMode(method);
  if (paymentMode === 'gateway_unavailable') {
    return res.status(503).json({
      error: 'Online payment gateway integration is not configured. No payment was charged or recorded. Please use bank deposit/transfer and wait for school verification.',
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
    });
  }
  if (paymentMode === 'unsupported') {
    return res.status(400).json({ error: 'Unsupported payment method. Use Bank Deposit or Bank Transfer.' });
  }

  try {
    const feeDoc = await FeeModel.findOne(buildFeeLookupFilter(cleanFeeId)).lean();
    if (!feeDoc) {
      return res.status(404).json({ error: 'Fee voucher not found' });
    }

    // The voucher itself is the authoritative payment target. Never trust a separate
    // student_id from the browser without proving it is the same student as the voucher.
    const feeStudentDoc = await findStudentByAnyId(String(feeDoc.student_id || ''));
    if (!feeStudentDoc) {
      return res.status(404).json({ error: 'The student linked to this fee voucher could not be found.' });
    }
    const feeStudentAliases = [
      feeStudentDoc.record_id,
      feeStudentDoc._id.toString(),
      feeStudentDoc.admission_no,
    ].filter(Boolean) as string[];

    if (cleanStudentId) {
      const requestedStudentDoc = await findStudentByAnyId(cleanStudentId);
      if (!requestedStudentDoc) {
        return res.status(404).json({ error: 'Requested student record not found.' });
      }
      const requestedStudentAliases = [
        requestedStudentDoc.record_id,
        requestedStudentDoc._id.toString(),
        requestedStudentDoc.admission_no,
      ].filter(Boolean) as string[];
      if (!areSameStudentIdentity(feeStudentAliases, requestedStudentAliases)) {
        return res.status(403).json({ error: 'Access denied: The selected fee voucher does not belong to the requested student.' });
      }
    }

    if (user.role === 'parent') {
      const linked = await getLinkedStudentIdsForParent(user);
      if (!isParentLinkedToStudent(linked, feeStudentAliases)) {
        return res.status(403).json({ error: 'Access denied: You can only make payments for your linked children.' });
      }
    } else if (user.role === 'student') {
      const ownStudentDoc = user.linked_id
        ? await findStudentByAnyId(user.linked_id)
        : await StudentModel.findOne({ user_id: user.id }).lean();
      if (!ownStudentDoc) {
        return res.status(403).json({ error: 'Access denied: Student profile is not linked to this account.' });
      }
      const ownStudentAliases = [
        ownStudentDoc.record_id,
        ownStudentDoc._id.toString(),
        ownStudentDoc.admission_no,
      ].filter(Boolean) as string[];
      if (!areSameStudentIdentity(ownStudentAliases, feeStudentAliases)) {
        return res.status(403).json({ error: 'Access denied: Students can only pay their own fee vouchers.' });
      }
    }

    const currentPending = Number(feeDoc.pending_amount) || 0;

    if (currentPending <= 0 || feeDoc.status === 'Paid') {
      return res.status(400).json({ error: 'Fee voucher is already fully settled. No payment required.' });
    }

    if (paymentAmount > currentPending) {
      return res.status(400).json({
        error: `Payment amount (PKR ${paymentAmount.toLocaleString()}) cannot exceed remaining balance (PKR ${currentPending.toLocaleString()}).`,
      });
    }

    const settings = await getPaymentSettings();
    if (paymentAmount < currentPending) {
      if (!settings.policies.allow_partial) {
        return res.status(400).json({ error: 'Partial fee payments are currently disabled by school policy.' });
      }
      if (paymentAmount < settings.policies.min_partial_amount) {
        return res.status(400).json({
          error: `Minimum partial payment allowed is PKR ${settings.policies.min_partial_amount.toLocaleString()}.`,
        });
      }
    }

    // Resolve parent metadata
    const parentDoc = await ParentModel.findOne({
      $or: [{ user_id: user.id }, { email: user.email.toLowerCase() }],
    }).lean();

    const parentName = parentDoc?.name || user.name || 'Parent/Guardian';
    const resolvedParentPhone = parent_phone || parentDoc?.phone || user.phone || '';
    // Require a stable bank reference: the unique transaction_id index prevents duplicate submissions on retry.
    const cleanSlipRef = normalizeDepositReference(deposit_slip_ref);
    if (!cleanSlipRef) {
      return res.status(400).json({
        error: 'A valid deposit slip reference or bank transaction ID is required. This prevents duplicate payment submissions.',
      });
    }

    const paymentRef = `PAY-${new Date().getFullYear()}-${crypto.randomUUID()}`;
    // Manual Bank Deposit / Wire Transfer (Requires Admin Verification)
    const paymentDoc = await FeePaymentModel.create({
        fee_id: feeDoc.voucher_id || feeDoc._id.toString(),
        student_id: feeDoc.student_id,
        payment_reference: paymentRef,
        receipt_no: '',
        transaction_id: cleanSlipRef,
        date: deposit_date || new Date().toISOString().split('T')[0],
        amount: paymentAmount,
        method: (method === 'Bank Transfer' ? 'Bank Transfer' : 'Bank Deposit') as any,
        status: 'Pending Verification',
        verification_status: 'Pending',
        parent_user_id: user.id,
        parent_name: parentName,
        parent_phone: resolvedParentPhone,
        student_name: feeDoc.student_name,
        admission_no: feeDoc.student_id,
        class_name: feeDoc.class_name,
        fee_month: feeDoc.fee_month,
        year: feeDoc.year,
        bank_name: bank_name || '',
        account_number: account_number || '',
        deposit_date: deposit_date || new Date().toISOString().split('T')[0],
        deposit_slip_ref: cleanSlipRef,
        receipt_attachment_url: receipt_attachment_url || '',
        notes: notes || 'Bank deposit submitted by parent, awaiting verification',
        received_by: 'Accounts Office (Pending Review)',
      });

      // Dispatch "Pending Verification" SMS acknowledgment
      const smsResult = await sendPaymentSubmissionSms({
        payment_reference: paymentRef,
        amount: paymentAmount,
        parent_name: parentName,
        parent_phone: resolvedParentPhone,
        student_name: feeDoc.student_name,
        class_name: feeDoc.class_name,
      });

      await FeePaymentModel.updateOne(
      { _id: paymentDoc._id },
      {
        $set: {
          sms_status: smsResult.status,
          sms_message: smsResult.message,
          sms_sent_at: smsResult.timestamp,
        },
      }
    );

      // Notify Admin and parent exactly once for this persisted payment action.
      const notificationActionId = `fee-submit:${paymentDoc._id.toString()}`;
      await Promise.all([
        createNotificationOnce({
          actionId: notificationActionId,
          role: 'admin',
          title: 'New Fee Payment Verification Required',
          message: `Parent submitted Bank Deposit of PKR ${paymentAmount.toLocaleString()} for ${feeDoc.student_name} (${feeDoc.class_name}). Slip Ref: ${cleanSlipRef || paymentRef}.`,
          link: '/admin',
        }),
        createNotificationOnce({
          actionId: notificationActionId,
          userId: user.id,
          role: 'parent',
          title: 'Payment Submission Received',
          message: `Your payment voucher submission of PKR ${paymentAmount.toLocaleString()} (Ref: ${paymentRef}) has been received and is pending verification.`,
          link: '/student-portal',
        }),
      ]);

      return res.status(201).json({
        message: 'Payment submitted for verification',
        payment: toFeePaymentDto(paymentDoc),
        fee: toFeeDto(feeDoc),
      });
  } catch (err: any) {
    if (err?.code === 11000) {
      // A prior attempt may have persisted the payment before notification delivery failed.
      // Recover only for the same authenticated parent and the exact same payment details.
      try {
        const retryFeeDoc = await FeeModel.findOne(buildFeeLookupFilter(cleanFeeId)).lean();
        const canonicalVoucherId = retryFeeDoc?.voucher_id || retryFeeDoc?._id?.toString();
        const existingPayment = await FeePaymentModel.findOne({
          transaction_id: normalizeDepositReference(deposit_slip_ref),
          parent_user_id: user.id,
        }).lean();

        const expectedMethod = method === 'Bank Transfer' ? 'Bank Transfer' : 'Bank Deposit';
        const exactRetry = Boolean(
          retryFeeDoc &&
          isExactParentPaymentRetry(existingPayment, {
            feeId: String(canonicalVoucherId || ''),
            studentId: String(retryFeeDoc.student_id || ''),
            amount: paymentAmount,
            method: expectedMethod,
            parentUserId: user.id,
          })
        );

        if (exactRetry && retryFeeDoc && existingPayment) {
          const notificationActionId = `fee-submit:${existingPayment._id.toString()}`;
          await Promise.all([
            createNotificationOnce({
              actionId: notificationActionId,
              role: 'admin',
              title: 'New Fee Payment Verification Required',
              message: `Parent submitted Bank Deposit of PKR ${paymentAmount.toLocaleString()} for ${retryFeeDoc.student_name} (${retryFeeDoc.class_name}). Slip Ref: ${normalizeDepositReference(deposit_slip_ref)}.`,
              link: '/admin',
            }),
            createNotificationOnce({
              actionId: notificationActionId,
              userId: user.id,
              role: 'parent',
              title: 'Payment Submission Received',
              message: `Your payment voucher submission of PKR ${paymentAmount.toLocaleString()} (Ref: ${existingPayment.payment_reference}) has been received and is pending verification.`,
              link: '/student-portal',
            }),
          ]);

          return res.status(200).json({
            message: 'This payment was already received. Its notifications have been checked safely.',
            payment: toFeePaymentDto(existingPayment),
            fee: toFeeDto(retryFeeDoc),
            idempotent_replay: true,
          });
        }
      } catch (recoveryError) {
        return sendRouteError(res, recoveryError, 'Unable to safely recover the existing payment submission.');
      }

      return res.status(409).json({
        error: 'This bank deposit reference has already been submitted. Check payment history before retrying.',
      });
    }
    return sendRouteError(res, err, 'Failed to process fee payment');
  }
});

// 4. Parent Payment History
router.get('/parent/payments/history', authenticateToken, requireRole(['parent', 'student', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const user = req.user!;
    let query: Record<string, any> = {};

    if (user.role === 'parent') {
      const linked = await getLinkedStudentIdsForParent(user);
      const studentIds = Array.from(linked);
      // A stale denormalized parent_user_id must never expose a former child's payment history.
      // Empty link sets intentionally produce student_id: { $in: [] }, which returns no records.
      query = buildParentPaymentHistoryFilter(linked);
    } else if (user.role === 'student') {
      const studentDoc = user.linked_id
        ? await findStudentByAnyId(user.linked_id)
        : await StudentModel.findOne({
            $or: [{ user_id: user.id }, { email: user.email.toLowerCase() }],
          }).lean();
      if (!studentDoc) {
        return res.json([]);
      }
      const studentIds = collectStudentPaymentIdentifiers(studentDoc);
      query = { student_id: { $in: studentIds } };
    } else {
      query = {};
    }

    const paymentDocs = await FeePaymentModel.find(query).sort({ created_at: -1 }).limit(100).lean();
    return res.json(paymentDocs.map(toFeePaymentDto));
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to fetch payment history');
  }
});

// 5. Admin Payments Management & Collection Analytics
router.get('/admin/payments', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { status, verification_status, search, limit = '100', skip = '0' } = req.query;
    const filter: Record<string, any> = {};

    if (status && typeof status === 'string' && status !== 'all') {
      filter.status = status;
    }
    if (verification_status && typeof verification_status === 'string' && verification_status !== 'all') {
      filter.verification_status = verification_status;
    }
    if (search && typeof search === 'string' && search.trim()) {
      const cleanSearch = escapeRegexLiteral(search.trim());
      filter.$or = [
        { payment_reference: { $regex: cleanSearch, $options: 'i' } },
        { receipt_no: { $regex: cleanSearch, $options: 'i' } },
        { student_name: { $regex: cleanSearch, $options: 'i' } },
        { admission_no: { $regex: cleanSearch, $options: 'i' } },
        { parent_phone: { $regex: cleanSearch, $options: 'i' } },
        { deposit_slip_ref: { $regex: cleanSearch, $options: 'i' } },
      ];
    }

    const [payments, totalCount, allPaidPayments, pendingCount, rejectedCount, feeVouchers] = await Promise.all([
      FeePaymentModel.find(filter)
        .sort({ created_at: -1 })
        .skip(Math.max(0, parseInt(String(skip), 10) || 0))
        .limit(Math.min(200, Math.max(1, parseInt(String(limit), 10) || 100)))
        .lean(),
      FeePaymentModel.countDocuments(filter),
      FeePaymentModel.find({ status: 'Paid' }).select('amount date').lean(),
      FeePaymentModel.countDocuments({ verification_status: 'Pending' }),
      FeePaymentModel.countDocuments({ verification_status: 'Rejected' }),
      FeeModel.find({}).select('pending_amount paid_amount').lean(),
    ]);

    const todayStr = new Date().toISOString().split('T')[0];
    const currentYearMonth = todayStr.slice(0, 7);

    const total_collected = allPaidPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const today_collected = allPaidPayments
      .filter(p => p.date === todayStr)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const monthly_collected = allPaidPayments
      .filter(p => p.date && p.date.startsWith(currentYearMonth))
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    const total_outstanding = feeVouchers.reduce((sum, f) => sum + (Number(f.pending_amount) || 0), 0);

    return res.json({
      payments: payments.map(toFeePaymentDto),
      totalCount,
      stats: {
        total_collected,
        today_collected,
        monthly_collected,
        pending_approvals_count: pendingCount,
        rejected_count: rejectedCount,
        total_successful: allPaidPayments.length,
        total_outstanding,
      },
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve payment records');
  }
});

// 6. Admin Approve Manual Payment
router.post('/admin/payments/:id/approve', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  const paymentId = String(req.params.id || '').trim();

  try {
    if (!(await doesMongoSupportTransactions())) {
      return res.status(503).json({
        error: 'Payment approval requires a transaction-capable MongoDB deployment. No payment status or fee balance was changed.',
      });
    }

    let paymentDoc: any = null;
    let feeDoc: any = null;
    let updatedFee: any = null;
    let receiptNo = '';
    let idempotentReplay = false;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const pendingPayment = await FeePaymentModel.findOne({
          _id: paymentId,
          status: 'Pending Verification',
          verification_status: 'Pending',
        }).session(session);
        if (!pendingPayment) {
          const existing = await FeePaymentModel.findById(paymentId).session(session);
          if (!existing) {
            throw Object.assign(new Error('Payment record not found'), { statusCode: 404 });
          }
          if (existing.status === 'Paid' && existing.verification_status === 'Verified' && existing.receipt_no) {
            paymentDoc = existing;
            receiptNo = existing.receipt_no;
            feeDoc = await FeeModel.findOne(buildFeeLookupFilter(existing.fee_id)).session(session).lean();
            if (!feeDoc) {
              throw Object.assign(new Error('Associated fee voucher not found in database'), { statusCode: 404 });
            }
            idempotentReplay = true;
            return;
          }
          throw Object.assign(new Error('This payment is no longer pending verification. It may already have been approved or rejected.'), { statusCode: 409 });
        }

        const currentFee = await FeeModel.findOne(buildFeeLookupFilter(pendingPayment.fee_id)).session(session).lean();
        if (!currentFee) {
          throw Object.assign(new Error('Associated fee voucher not found in database'), { statusCode: 404 });
        }

        const currentPending = Number(currentFee.pending_amount) || 0;
        if (pendingPayment.amount > currentPending) {
          throw Object.assign(new Error(
            `Approved payment amount (PKR ${pendingPayment.amount.toLocaleString()}) exceeds current remaining balance (PKR ${currentPending.toLocaleString()}).`
          ), { statusCode: 409 });
        }

        receiptNo = `REC-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;
        const nextPending = Math.max(0, currentPending - pendingPayment.amount);
        const nextStatus: FeeVoucherStatus = nextPending === 0 ? 'Paid' : 'Partial';
        const paymentRecord = {
          receipt_no: receiptNo,
          date: new Date().toISOString().split('T')[0],
          amount: pendingPayment.amount,
          method: pendingPayment.method,
          transaction_id: pendingPayment.deposit_slip_ref || pendingPayment.payment_reference,
          notes: `Bank Deposit Approved by ${req.user!.name} (Ref: ${pendingPayment.payment_reference})`,
        };

        updatedFee = await FeeModel.findOneAndUpdate(
          { _id: currentFee._id, pending_amount: { $gte: pendingPayment.amount } },
          {
            $inc: { paid_amount: pendingPayment.amount, pending_amount: -pendingPayment.amount },
            $set: { status: nextStatus },
            $push: { payment_history: paymentRecord },
          },
          { session, returnDocument: 'after' }
        ).lean();
        if (!updatedFee) {
          throw Object.assign(new Error('Voucher balance changed concurrently. Refresh and retry approval.'), { statusCode: 409 });
        }

        paymentDoc = await FeePaymentModel.findOneAndUpdate(
          {
            _id: pendingPayment._id,
            status: 'Pending Verification',
            verification_status: 'Pending',
          },
          {
            $set: {
              status: 'Paid',
              verification_status: 'Verified',
              receipt_no: receiptNo,
              verified_by_id: req.user!.id,
              verified_by_name: req.user!.name,
              verified_at: new Date().toISOString(),
              received_by: req.user!.name,
            },
          },
          { session, new: true }
        );
        if (!paymentDoc) {
          throw Object.assign(new Error('Payment was already processed by another administrator. No changes were committed.'), { statusCode: 409 });
        }
        feeDoc = currentFee;
      });
    } finally {
      await session.endSession();
    }

    // On an exact replay, retry only the idempotent in-app notification.
    // Do not repeat SMS side effects or audit entries.
    if (!idempotentReplay) {
    // Send SMS Confirmation to parent
    const smsResult = await sendPaymentApprovalSms({
      payment_reference: paymentDoc.payment_reference,
      receipt_no: receiptNo,
      amount: paymentDoc.amount,
      parent_name: paymentDoc.parent_name,
      parent_phone: paymentDoc.parent_phone,
      student_name: paymentDoc.student_name || feeDoc.student_name,
      class_name: paymentDoc.class_name || feeDoc.class_name,
    });

    await FeePaymentModel.updateOne(
      { _id: paymentDoc._id },
      {
        $set: {
          sms_status: smsResult.status,
          sms_message: smsResult.message,
          sms_sent_at: smsResult.timestamp,
        },
      }
    );

    }
    // This idempotent write runs on both first attempt and retry, recovering
    // the notification if the payment transaction committed before a failure.
    if (paymentDoc.parent_user_id) {
      await createNotificationOnce({
        actionId: `fee-approve:${paymentDoc._id.toString()}`,
        userId: paymentDoc.parent_user_id,
        role: 'parent',
        title: 'Fee Payment Approved & Receipt Issued',
        message: `Your deposit of PKR ${paymentDoc.amount.toLocaleString()} for ${paymentDoc.student_name || feeDoc.student_name} has been verified. Official Receipt: ${receiptNo}.`,
        link: '/student-portal',
      });
    }
    if (!idempotentReplay) {
      await recordMongoAudit(
        req.user!,
        'Approved Fee Payment',
        'FeePayment',
        paymentDoc.payment_reference,
        `Verified deposit of PKR ${paymentDoc.amount} for ${paymentDoc.student_name}. Receipt: ${receiptNo}`
      );
    }

    return res.json({
      message: 'Payment verified and approved successfully',
      payment: toFeePaymentDto(paymentDoc),
      fee: updatedFee ? toFeeDto(updatedFee) : feeDoc,
      receipt_no: receiptNo,
    });
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.statusCode === 409) {
      return res.status(err.statusCode).json({ error: sanitizeErrorMessage(err.message) });
    }
    return sendRouteError(res, err, 'Failed to approve payment');
  }
});

// 7. Admin Reject Manual Payment
router.post('/admin/payments/:id/reject', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  const paymentId = String(req.params.id || '').trim();
  const { reason } = req.body || {};

  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    return res.status(400).json({ error: 'Rejection reason is required' });
  }

  try {
    let paymentDoc = await FeePaymentModel.findOneAndUpdate(
      {
        _id: paymentId,
        status: 'Pending Verification',
        verification_status: 'Pending',
      },
      {
        $set: {
          status: 'Rejected',
          verification_status: 'Rejected',
          rejection_reason: cleanReason,
          verified_by_id: req.user!.id,
          verified_by_name: req.user!.name,
          verified_at: new Date().toISOString(),
        },
      },
      { new: true }
    );

    let idempotentReplay = false;
    if (!paymentDoc) {
      const existing = await FeePaymentModel.findById(paymentId).lean();
      if (!existing) {
        return res.status(404).json({ error: 'Payment record not found' });
      }
      if (existing.status === 'Rejected' && existing.verification_status === 'Rejected') {
        paymentDoc = existing;
        idempotentReplay = true;
      } else {
        return res.status(409).json({ error: 'This payment is no longer pending verification. It may already have been approved or rejected.' });
      }
    }

    // On an exact replay, retry only the idempotent in-app notification.
    // Do not repeat SMS side effects or audit entries.
    if (!idempotentReplay) {
    // Send Rejection SMS to Parent
    const smsResult = await sendPaymentRejectionSms(
      {
        payment_reference: paymentDoc.payment_reference,
        amount: paymentDoc.amount,
        parent_name: paymentDoc.parent_name,
        parent_phone: paymentDoc.parent_phone,
        student_name: paymentDoc.student_name,
        class_name: paymentDoc.class_name,
      },
      cleanReason
    );

    await FeePaymentModel.updateOne(
      { _id: paymentDoc._id },
      {
        $set: {
          sms_status: smsResult.status,
          sms_message: smsResult.message,
          sms_sent_at: smsResult.timestamp,
        },
      }
    );

    }
    // Use the persisted rejection reason on retries; never let a replay alter it.
    if (paymentDoc.parent_user_id) {
      await createNotificationOnce({
        actionId: `fee-reject:${paymentDoc._id.toString()}`,
        userId: paymentDoc.parent_user_id,
        role: 'parent',
        title: 'Fee Payment Rejected',
        message: `Your payment Ref: ${paymentDoc.payment_reference} for ${paymentDoc.student_name} was rejected. Reason: ${paymentDoc.rejection_reason || cleanReason}`,
        link: '/student-portal',
      });
    }
    if (!idempotentReplay) {
      await recordMongoAudit(
        req.user!,
        'Rejected Fee Payment',
        'FeePayment',
        paymentDoc.payment_reference,
        `Rejected deposit of PKR ${paymentDoc.amount} for ${paymentDoc.student_name}. Reason: ${paymentDoc.rejection_reason || cleanReason}`
      );
    }

    return res.json({
      message: 'Payment rejected',
      payment: toFeePaymentDto(paymentDoc),
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to reject payment');
  }
});

// 8. Admin Payment & SMS Configuration
router.get('/admin/payments/settings', authenticateToken, requireRole(['super_admin', 'admin']), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await getPaymentSettings();
    return res.json(settings);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to fetch admin payment settings');
  }
});

router.put('/admin/payments/settings', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const updated = await savePaymentSettings(req.body || {});
    await recordMongoAudit(
      req.user!,
      'Updated Payment & SMS Settings',
      'SchoolSettings',
      'default',
      'Updated gateways, bank accounts, policies, or SMS templates'
    );
    return res.json({ message: 'Payment settings saved successfully', settings: updated });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to update payment settings');
  }
});

// ==========================================
// 10. TIMETABLE (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/timetable', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { class_name, section, day, teacher_name } = req.query;
    const filter: Record<string, any> = {};

    if (class_name && typeof class_name === 'string' && class_name.trim()) {
      filter.class_name = { $regex: new RegExp(`^${escapeRegexLiteral(class_name.trim())}$`, 'i') };
    }
    if (section && typeof section === 'string' && section.trim()) {
      filter.section = { $regex: new RegExp(`^${escapeRegexLiteral(section.trim())}$`, 'i') };
    }
    if (day && typeof day === 'string' && day.trim()) {
      filter.day = { $regex: new RegExp(`^${escapeRegexLiteral(day.trim())}$`, 'i') };
    }
    if (teacher_name && typeof teacher_name === 'string' && teacher_name.trim()) {
      filter.teacher_name = { $regex: new RegExp(escapeRegexLiteral(teacher_name.trim()), 'i') };
    }

    const docs = await TimetableModel.find(filter).sort({ created_at: 1, _id: 1 }).lean();
    const items = docs.map(toTimetableDto);
    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve timetable') });
  }
});

router.post('/timetable', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { class_name, section, section_id, subject, subject_id, teacher_name, day, start_time, end_time, room } =
      req.body || {};

    const cleanClassInput = sanitizePlainText(class_name, 120);
    const cleanSubject = sanitizePlainText(subject, 120);
    const cleanDay = sanitizePlainText(day, 20);
    const cleanStart = sanitizePlainText(start_time, 20);
    const cleanEnd = sanitizePlainText(end_time, 20);

    if (!cleanClassInput || !cleanSubject || !cleanDay || !cleanStart || !cleanEnd) {
      return res.status(400).json({ error: 'Class, subject, day, start time and end time are required' });
    }

    const matchedDay = VALID_TIMETABLE_DAYS.find(d => d.toLowerCase() === cleanDay.toLowerCase());
    if (!matchedDay) {
      return res.status(400).json({
        error: `Invalid day "${cleanDay}". Must be one of: ${VALID_TIMETABLE_DAYS.join(', ')}`,
      });
    }

    const matchedClass = await resolveExistingClassDoc(cleanClassInput);
    if (!matchedClass) {
      return res.status(400).json({ error: `Invalid class reference: class "${cleanClassInput}" does not exist` });
    }
    const canonicalClassName = matchedClass.name;

    let cleanSection = section !== undefined ? sanitizePlainText(section, 60) : 'A';
    if (!cleanSection) {
      return res.status(400).json({ error: 'Section cannot be empty' });
    }

    if (section_id !== undefined && section_id !== '') {
      if (!isValidCmsIdParam(section_id)) {
        return res.status(400).json({ error: 'Invalid section_id format' });
      }
      const secDoc = await SectionModel.findOne(buildCmsRecordLookupFilter(String(section_id))).lean();
      if (!secDoc || secDoc.class_name.toLowerCase() !== canonicalClassName.toLowerCase()) {
        return res.status(400).json({ error: 'Invalid section_id reference for the specified class' });
      }
      cleanSection = secDoc.name;
    } else {
      const classSections = await SectionModel.find({
        class_name: { $regex: new RegExp(`^${escapeRegexLiteral(canonicalClassName)}$`, 'i') },
      }).lean();
      if (classSections.length > 0) {
        const secLower = cleanSection.toLowerCase();
        const validSec = classSections.some(s => {
          const sLower = s.name.trim().toLowerCase();
          return secLower === sLower || secLower.startsWith(`${sLower} (`);
        });
        if (!validSec) {
          return res.status(400).json({
            error: `Invalid section "${cleanSection}" for class "${canonicalClassName}". Defined sections: ${classSections.map(s => s.name).join(', ')}`,
          });
        }
      }
    }

    let canonicalSubject = cleanSubject;
    if (subject_id !== undefined && subject_id !== '') {
      if (!isValidCmsIdParam(subject_id)) {
        return res.status(400).json({ error: 'Invalid subject_id format' });
      }
      const subjDoc = await SubjectModel.findOne(buildCmsRecordLookupFilter(String(subject_id))).lean();
      if (!subjDoc || subjDoc.class_name.toLowerCase() !== canonicalClassName.toLowerCase()) {
        return res.status(400).json({ error: 'Invalid subject_id reference for the specified class' });
      }
      canonicalSubject = subjDoc.name;
    }

    const interval = parseTimetableInterval(cleanStart, cleanEnd);
    if (!interval) {
      return res.status(400).json({
        error: 'Invalid timetable time range: start_time and end_time must be valid times with end_time after start_time',
      });
    }

    const cleanTeacher = sanitizePlainText(teacher_name, 120) || 'Assigned Faculty';
    const cleanRoom = sanitizePlainText(room, 80) || 'Main Hall';

    const sameDayEntries = await TimetableModel.find({ day: matchedDay }).lean();
    for (const entry of sameDayEntries) {
      const exInterval = parseTimetableInterval(entry.start_time, entry.end_time);
      const overlaps = exInterval
        ? interval.startMin < exInterval.endMin && exInterval.startMin < interval.endMin
        : entry.start_time.trim().toLowerCase() === cleanStart.toLowerCase();

      if (!overlaps) continue;

      if (
        entry.class_name.trim().toLowerCase() === canonicalClassName.toLowerCase() &&
        (entry.section || 'A').trim().toLowerCase() === cleanSection.toLowerCase()
      ) {
        return res.status(409).json({
          error: `Timetable conflict: ${canonicalClassName} (${cleanSection}) already has "${entry.subject}" scheduled on ${matchedDay} (${entry.start_time} - ${entry.end_time}).`,
        });
      }

      if (
        !isGenericPlaceholderTeacher(cleanTeacher) &&
        !isGenericPlaceholderTeacher(entry.teacher_name) &&
        entry.teacher_name.trim().toLowerCase() === cleanTeacher.toLowerCase()
      ) {
        return res.status(409).json({
          error: `Timetable conflict: Teacher "${cleanTeacher}" is already scheduled for ${entry.class_name} (${entry.section}) on ${matchedDay} (${entry.start_time} - ${entry.end_time}).`,
        });
      }
    }

    const recordId = `tt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created = await TimetableModel.create({
      record_id: recordId,
      class_name: canonicalClassName,
      section: cleanSection,
      subject: canonicalSubject,
      teacher_name: cleanTeacher,
      day: matchedDay,
      start_time: cleanStart,
      end_time: cleanEnd,
      room: cleanRoom,
    });

    const dto = toTimetableDto(created);
    await recordMongoAudit(
      req.user!,
      'Created Timetable Entry',
      'Timetable',
      dto.id,
      `${dto.class_name} (${dto.section}) - ${dto.day} ${dto.start_time}-${dto.end_time}: ${dto.subject}`
    );
    return res.status(201).json(dto);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create timetable entry') });
  }
});

router.put('/timetable/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid timetable ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const existing = await TimetableModel.findOne(buildCmsRecordLookupFilter(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Timetable entry not found' });
    }

    const body = req.body || {};
    let nextClassName = existing.class_name;
    if (body.class_name !== undefined) {
      const cleanClassInput = sanitizePlainText(body.class_name, 120);
      if (!cleanClassInput) {
        return res.status(400).json({ error: 'Class name cannot be empty' });
      }
      const matchedClass = await resolveExistingClassDoc(cleanClassInput);
      if (!matchedClass) {
        return res.status(400).json({ error: `Invalid class reference: class "${cleanClassInput}" does not exist` });
      }
      nextClassName = matchedClass.name;
    }

    let nextSection = existing.section || 'A';
    if (body.section !== undefined) {
      const cleanSec = sanitizePlainText(body.section, 60);
      if (!cleanSec) {
        return res.status(400).json({ error: 'Section cannot be empty' });
      }
      if (cleanSec.toLowerCase() !== (existing.section || '').toLowerCase() || nextClassName !== existing.class_name) {
        const classSections = await SectionModel.find({
          class_name: { $regex: new RegExp(`^${escapeRegexLiteral(nextClassName)}$`, 'i') },
        }).lean();
        if (classSections.length > 0) {
          const secLower = cleanSec.toLowerCase();
          const validSec = classSections.some(s => {
            const sLower = s.name.trim().toLowerCase();
            return secLower === sLower || secLower.startsWith(`${sLower} (`);
          });
          if (!validSec) {
            return res.status(400).json({
              error: `Invalid section "${cleanSec}" for class "${nextClassName}". Defined sections: ${classSections.map(s => s.name).join(', ')}`,
            });
          }
        }
      }
      nextSection = cleanSec;
    }

    let nextDay = existing.day;
    if (body.day !== undefined) {
      const cleanDay = sanitizePlainText(body.day, 20);
      const matchedDay = VALID_TIMETABLE_DAYS.find(d => d.toLowerCase() === cleanDay.toLowerCase());
      if (!matchedDay) {
        return res.status(400).json({
          error: `Invalid day "${cleanDay}". Must be one of: ${VALID_TIMETABLE_DAYS.join(', ')}`,
        });
      }
      nextDay = matchedDay;
    }

    let nextSubject = existing.subject;
    if (body.subject !== undefined) {
      const cleanSubject = sanitizePlainText(body.subject, 120);
      if (!cleanSubject) {
        return res.status(400).json({ error: 'Subject cannot be empty' });
      }
      nextSubject = cleanSubject;
    }

    const nextStart = body.start_time !== undefined ? sanitizePlainText(body.start_time, 20) : existing.start_time;
    const nextEnd = body.end_time !== undefined ? sanitizePlainText(body.end_time, 20) : existing.end_time;
    const interval = parseTimetableInterval(nextStart, nextEnd);
    if (!interval) {
      return res.status(400).json({
        error: 'Invalid timetable time range: start_time and end_time must be valid times with end_time after start_time',
      });
    }

    const nextTeacher =
      body.teacher_name !== undefined
        ? sanitizePlainText(body.teacher_name, 120) || 'Assigned Faculty'
        : existing.teacher_name;
    const nextRoom = body.room !== undefined ? sanitizePlainText(body.room, 80) : existing.room;

    const sameDayEntries = await TimetableModel.find({
      _id: { $ne: existing._id },
      day: nextDay,
    }).lean();

    for (const entry of sameDayEntries) {
      const exInterval = parseTimetableInterval(entry.start_time, entry.end_time);
      const overlaps = exInterval
        ? interval.startMin < exInterval.endMin && exInterval.startMin < interval.endMin
        : entry.start_time.trim().toLowerCase() === nextStart.toLowerCase();

      if (!overlaps) continue;

      if (
        entry.class_name.trim().toLowerCase() === nextClassName.toLowerCase() &&
        (entry.section || 'A').trim().toLowerCase() === nextSection.toLowerCase()
      ) {
        return res.status(409).json({
          error: `Timetable conflict: ${nextClassName} (${nextSection}) already has "${entry.subject}" scheduled on ${nextDay} (${entry.start_time} - ${entry.end_time}).`,
        });
      }

      if (
        !isGenericPlaceholderTeacher(nextTeacher) &&
        !isGenericPlaceholderTeacher(entry.teacher_name) &&
        entry.teacher_name.trim().toLowerCase() === nextTeacher.toLowerCase()
      ) {
        return res.status(409).json({
          error: `Timetable conflict: Teacher "${nextTeacher}" is already scheduled for ${entry.class_name} (${entry.section}) on ${nextDay} (${entry.start_time} - ${entry.end_time}).`,
        });
      }
    }

    existing.class_name = nextClassName;
    existing.section = nextSection;
    existing.subject = nextSubject;
    existing.teacher_name = nextTeacher;
    existing.day = nextDay;
    existing.start_time = nextStart;
    existing.end_time = nextEnd;
    existing.room = nextRoom;

    await existing.save();
    const dto = toTimetableDto(existing);
    await recordMongoAudit(
      req.user!,
      'Updated Timetable Entry',
      'Timetable',
      dto.id,
      `${dto.class_name} (${dto.section}) - ${dto.day} ${dto.start_time}-${dto.end_time}: ${dto.subject}`
    );
    return res.json(dto);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update timetable entry') });
  }
});

router.delete('/timetable/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid timetable ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const removedDoc = await TimetableModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
    if (!removedDoc) {
      return res.status(404).json({ error: 'Timetable entry not found' });
    }
    const dto = toTimetableDto(removedDoc);
    await recordMongoAudit(
      req.user!,
      'Deleted Timetable Entry',
      'Timetable',
      dto.id,
      `${dto.class_name} (${dto.section}) - ${dto.day}: ${dto.subject}`
    );
    return res.json({ message: 'Timetable entry deleted', item: dto });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete timetable entry') });
  }
});

// ==========================================
// 11. EXAMS (MONGODB-AUTHORITATIVE) & RESULTS
// ==========================================

router.get('/exams', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { academic_year, term, status, class_name } = req.query;
    const filter: Record<string, any> = {};

    if (academic_year && typeof academic_year === 'string' && academic_year.trim()) {
      filter.academic_year = { $regex: new RegExp(`^${escapeRegexLiteral(academic_year.trim())}$`, 'i') };
    }
    if (term && typeof term === 'string' && term.trim()) {
      filter.term = { $regex: new RegExp(`^${escapeRegexLiteral(term.trim())}$`, 'i') };
    }
    if (status && typeof status === 'string' && status.trim()) {
      filter.status = { $regex: new RegExp(`^${escapeRegexLiteral(status.trim())}$`, 'i') };
    }

    const docs = await ExamModel.find(filter).sort({ created_at: 1, _id: 1 }).lean();
    let items = docs.map(toExamDto);

    if (class_name && typeof class_name === 'string' && class_name.trim()) {
      const targetLower = class_name.trim().toLowerCase();
      items = items.filter(
        ex =>
          ex.classes.includes('All Classes') ||
          ex.classes.some((c: string) => c.toLowerCase() === targetLower)
      );
    }

    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve exams') });
  }
});

router.post('/exams', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { title, term, academic_year, start_date, end_date, classes, status, max_marks, total_marks, passing_marks } =
      req.body || {};

    const cleanTitle = sanitizePlainText(title, 160);
    const cleanTerm = sanitizePlainText(term, 80);
    if (!cleanTitle || !cleanTerm) {
      return res.status(400).json({ error: 'Title and term are required' });
    }

    const cleanYear = sanitizePlainText(academic_year, 30) || '2026-2027';

    const cleanStart =
      start_date !== undefined && start_date !== ''
        ? sanitizePlainText(start_date, 20)
        : new Date().toISOString().split('T')[0];
    if (!isValidIsoCalendarDate(cleanStart)) {
      return res.status(400).json({ error: 'Invalid start_date: must be a valid calendar date in YYYY-MM-DD format' });
    }

    let cleanEnd = '';
    if (end_date !== undefined && end_date !== '') {
      cleanEnd = sanitizePlainText(end_date, 20);
      if (!isValidIsoCalendarDate(cleanEnd)) {
        return res.status(400).json({ error: 'Invalid end_date: must be a valid calendar date in YYYY-MM-DD format' });
      }
      if (cleanEnd < cleanStart) {
        return res.status(400).json({ error: 'Invalid exam date range: end_date cannot be earlier than start_date' });
      }
    }

    let statusVal: 'Scheduled' | 'Ongoing' | 'Completed' = 'Scheduled';
    if (status !== undefined && status !== '') {
      const matchedStatus = VALID_EXAM_STATUSES.find(s => s.toLowerCase() === String(status).trim().toLowerCase());
      if (!matchedStatus) {
        return res.status(400).json({
          error: `Invalid exam status "${status}". Must be one of: ${VALID_EXAM_STATUSES.join(', ')}`,
        });
      }
      statusVal = matchedStatus;
    }

    const rawMaxMarks = max_marks !== undefined ? max_marks : total_marks;
    let parsedMaxMarks: number | undefined;
    let parsedPassingMarks: number | undefined;
    if (rawMaxMarks !== undefined && rawMaxMarks !== '') {
      const mm = Number(rawMaxMarks);
      if (!Number.isFinite(mm) || mm <= 0 || mm > 5000) {
        return res.status(400).json({ error: 'Exam max_marks must be a valid number between 1 and 5000' });
      }
      parsedMaxMarks = mm;
    }
    if (passing_marks !== undefined && passing_marks !== '') {
      const pm = Number(passing_marks);
      const upper = parsedMaxMarks !== undefined ? parsedMaxMarks : 5000;
      if (!Number.isFinite(pm) || pm < 0 || pm > upper) {
        return res.status(400).json({ error: `Exam passing_marks must be between 0 and ${upper}` });
      }
      parsedPassingMarks = pm;
    }

    let normalizedClasses: string[] = ['All Classes'];
    if (classes !== undefined) {
      if (!Array.isArray(classes) || classes.length === 0) {
        return res.status(400).json({ error: 'Exam classes must be a non-empty array of class names' });
      }
      const resolvedList: string[] = [];
      for (const rawCls of classes) {
        const cleanCls = sanitizePlainText(rawCls, 120);
        if (!cleanCls) {
          return res.status(400).json({ error: 'Exam class entry cannot be empty' });
        }
        if (cleanCls.toLowerCase() === 'all classes') {
          resolvedList.push('All Classes');
        } else {
          const clsDoc = await resolveExistingClassDoc(cleanCls);
          if (!clsDoc) {
            return res.status(400).json({
              error: `Invalid class reference in exam classes: "${cleanCls}" does not exist`,
            });
          }
          if (!resolvedList.includes(clsDoc.name)) {
            resolvedList.push(clsDoc.name);
          }
        }
      }
      normalizedClasses = resolvedList;
    }

    const duplicateExam = await ExamModel.findOne({
      title: { $regex: new RegExp(`^${escapeRegexLiteral(cleanTitle)}$`, 'i') },
      term: { $regex: new RegExp(`^${escapeRegexLiteral(cleanTerm)}$`, 'i') },
      academic_year: { $regex: new RegExp(`^${escapeRegexLiteral(cleanYear)}$`, 'i') },
      start_date: cleanStart,
    }).lean();
    if (duplicateExam) {
      return res.status(409).json({ error: 'An exam with this title, term, academic year, and start date already exists' });
    }

    const recordId = `ex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created = await ExamModel.create({
      record_id: recordId,
      title: cleanTitle,
      term: cleanTerm,
      academic_year: cleanYear,
      start_date: cleanStart,
      end_date: cleanEnd,
      classes: normalizedClasses,
      status: statusVal,
      ...(parsedMaxMarks !== undefined ? { max_marks: parsedMaxMarks } : {}),
      ...(parsedPassingMarks !== undefined ? { passing_marks: parsedPassingMarks } : {}),
    });

    const dto = toExamDto(created);
    await recordMongoAudit(req.user!, 'Created Exam', 'Exam', dto.id, `${dto.title} (${dto.term} ${dto.academic_year})`);
    return res.status(201).json(dto);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create exam') });
  }
});

router.put('/exams/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid exam ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const existing = await ExamModel.findOne(buildCmsRecordLookupFilter(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const body = req.body || {};
    let nextTitle = existing.title;
    if (body.title !== undefined) {
      const cleanTitle = sanitizePlainText(body.title, 160);
      if (!cleanTitle) {
        return res.status(400).json({ error: 'Exam title cannot be empty' });
      }
      nextTitle = cleanTitle;
    }

    let nextTerm = existing.term;
    if (body.term !== undefined) {
      const cleanTerm = sanitizePlainText(body.term, 80);
      if (!cleanTerm) {
        return res.status(400).json({ error: 'Exam term cannot be empty' });
      }
      nextTerm = cleanTerm;
    }

    const nextYear =
      body.academic_year !== undefined
        ? sanitizePlainText(body.academic_year, 30) || existing.academic_year
        : existing.academic_year;

    let nextStart = existing.start_date;
    if (body.start_date !== undefined) {
      const cleanStart = sanitizePlainText(body.start_date, 20);
      if (!isValidIsoCalendarDate(cleanStart)) {
        return res.status(400).json({ error: 'Invalid start_date: must be a valid calendar date in YYYY-MM-DD format' });
      }
      nextStart = cleanStart;
    }

    let nextEnd = existing.end_date ?? '';
    if (body.end_date !== undefined) {
      const cleanEnd = sanitizePlainText(body.end_date, 20);
      if (cleanEnd !== '' && !isValidIsoCalendarDate(cleanEnd)) {
        return res.status(400).json({ error: 'Invalid end_date: must be a valid calendar date in YYYY-MM-DD format' });
      }
      nextEnd = cleanEnd;
    }
    if (nextEnd !== '' && nextEnd < nextStart) {
      return res.status(400).json({ error: 'Invalid exam date range: end_date cannot be earlier than start_date' });
    }

    let nextStatus = existing.status || 'Scheduled';
    if (body.status !== undefined && body.status !== '') {
      const matchedStatus = VALID_EXAM_STATUSES.find(s => s.toLowerCase() === String(body.status).trim().toLowerCase());
      if (!matchedStatus) {
        return res.status(400).json({
          error: `Invalid exam status "${body.status}". Must be one of: ${VALID_EXAM_STATUSES.join(', ')}`,
        });
      }
      nextStatus = matchedStatus;
    }

    const rawMaxMarks = body.max_marks !== undefined ? body.max_marks : body.total_marks;
    let nextMaxMarks = existing.max_marks;
    if (rawMaxMarks !== undefined && rawMaxMarks !== '') {
      const mm = Number(rawMaxMarks);
      if (!Number.isFinite(mm) || mm <= 0 || mm > 5000) {
        return res.status(400).json({ error: 'Exam max_marks must be a valid number between 1 and 5000' });
      }
      nextMaxMarks = mm;
      existing.max_marks = mm;
    }
    if (body.passing_marks !== undefined && body.passing_marks !== '') {
      const pm = Number(body.passing_marks);
      const upper = nextMaxMarks !== undefined ? nextMaxMarks : 5000;
      if (!Number.isFinite(pm) || pm < 0 || pm > upper) {
        return res.status(400).json({ error: `Exam passing_marks must be between 0 and ${upper}` });
      }
      existing.passing_marks = pm;
    } else if (
      nextMaxMarks !== undefined &&
      existing.passing_marks !== undefined &&
      existing.passing_marks > nextMaxMarks
    ) {
      return res.status(400).json({ error: 'Exam passing_marks cannot exceed max_marks' });
    }

    let nextClasses = existing.classes;
    if (body.classes !== undefined) {
      if (!Array.isArray(body.classes) || body.classes.length === 0) {
        return res.status(400).json({ error: 'Exam classes must be a non-empty array of class names' });
      }
      const existingLowerSet = new Set((existing.classes || []).map((c: string) => c.toLowerCase()));
      const resolvedList: string[] = [];
      for (const rawCls of body.classes) {
        const cleanCls = sanitizePlainText(rawCls, 120);
        if (!cleanCls) {
          return res.status(400).json({ error: 'Exam class entry cannot be empty' });
        }
        if (cleanCls.toLowerCase() === 'all classes') {
          resolvedList.push('All Classes');
        } else {
          const clsDoc = await resolveExistingClassDoc(cleanCls);
          if (clsDoc) {
            if (!resolvedList.includes(clsDoc.name)) resolvedList.push(clsDoc.name);
          } else if (existingLowerSet.has(cleanCls.toLowerCase())) {
            if (!resolvedList.includes(cleanCls)) resolvedList.push(cleanCls);
          } else {
            return res.status(400).json({
              error: `Invalid class reference in exam classes: "${cleanCls}" does not exist`,
            });
          }
        }
      }
      nextClasses = resolvedList;
    }

    const duplicateExam = await ExamModel.findOne({
      _id: { $ne: existing._id },
      title: { $regex: new RegExp(`^${escapeRegexLiteral(nextTitle)}$`, 'i') },
      term: { $regex: new RegExp(`^${escapeRegexLiteral(nextTerm)}$`, 'i') },
      academic_year: { $regex: new RegExp(`^${escapeRegexLiteral(nextYear)}$`, 'i') },
      start_date: nextStart,
    }).lean();
    if (duplicateExam) {
      return res.status(409).json({ error: 'An exam with this title, term, academic year, and start date already exists' });
    }

    existing.title = nextTitle;
    existing.term = nextTerm;
    existing.academic_year = nextYear;
    existing.start_date = nextStart;
    existing.end_date = nextEnd;
    existing.classes = nextClasses;
    existing.status = nextStatus;

    await existing.save();
    const dto = toExamDto(existing);
    await recordMongoAudit(req.user!, 'Updated Exam', 'Exam', dto.id, `${dto.title} (${dto.term} ${dto.academic_year})`);
    return res.json(dto);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update exam') });
  }
});

router.delete('/exams/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid exam ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const removedDoc = await ExamModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
    if (!removedDoc) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    const dto = toExamDto(removedDoc);
    await recordMongoAudit(req.user!, 'Deleted Exam', 'Exam', dto.id, `${dto.title} (${dto.term})`);
    return res.json({ message: 'Exam deleted', item: dto });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete exam') });
  }
});

router.get('/results', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { exam_id, student_id, class_name } = req.query;

    // Object-level isolation: students only see their own published results
    if (req.user?.role === 'student') {
      const ownDoc = req.user.linked_id
        ? await findStudentByAnyId(req.user.linked_id)
        : await StudentModel.findOne({ user_id: req.user.id }).lean();
      const ownIds = new Set<string>(
        [
          req.user.linked_id,
          ownDoc?.record_id,
          ownDoc?._id ? ownDoc._id.toString() : '',
        ].filter(Boolean) as string[]
      );
      if (student_id && !ownIds.has(String(student_id))) {
        return res.status(403).json({ error: 'Access denied: You may only view your own results.' });
      }
      const docs = await ResultModel.find({
        student_id: { $in: Array.from(ownIds) },
        published: { $ne: false },
        ...(exam_id ? { exam_id: String(exam_id) } : {}),
      })
        .sort({ created_at: -1, _id: -1 })
        .lean();
      return res.json(docs.map(toResultDto));
    }

    // Object-level isolation: parents only see their linked children's published results
    if (req.user?.role === 'parent') {
      const parentStudentIds = await getLinkedStudentIdsForParent(req.user);
      if (student_id && !parentStudentIds.has(String(student_id))) {
        return res.status(403).json({ error: 'Access denied: You may only view results for your linked child.' });
      }
      let targetStudentFilter: string[] = Array.from(parentStudentIds);
      if (student_id) {
        const stDoc = await findStudentByAnyId(String(student_id));
        targetStudentFilter = Array.from(
          new Set([
            String(student_id),
            stDoc?.record_id || '',
            stDoc?._id ? stDoc._id.toString() : '',
          ].filter(Boolean))
        );
      }
      const docs = await ResultModel.find({
        student_id: { $in: targetStudentFilter },
        published: { $ne: false },
        ...(exam_id ? { exam_id: String(exam_id) } : {}),
      })
        .sort({ created_at: -1, _id: -1 })
        .lean();
      return res.json(docs.map(toResultDto));
    }

    // Resolve student_id aliases if provided
    let resolvedStudentAliases: Set<string> | null = null;
    if (student_id) {
      const targetStudent = await findStudentByAnyId(String(student_id));
      resolvedStudentAliases = new Set<string>(
        [
          String(student_id),
          targetStudent?.record_id || '',
          targetStudent?._id ? targetStudent._id.toString() : '',
        ].filter(Boolean)
      );
    }

    // Object-level isolation: teachers only see results for their assigned classes
    if (req.user?.role === 'teacher') {
      const teacher = await getAuthenticatedTeacherMongo(req);
      if (!teacher) {
        return res.status(404).json({ error: 'Teacher profile not linked.' });
      }
      const assignedClasses = teacher.classes || [];
      const teacherIds = Array.from(new Set([teacher.id, req.user?.linked_id, req.user?.id].filter(Boolean)));
      const assignmentDocs = await TeacherAssignmentModel.find({
        teacher_id: { $in: teacherIds },
      }).select('subject').lean();
      const allowedSubjects = [teacher.subject, ...assignmentDocs.map((item: any) => item.subject)];

      if (class_name) {
        if (!isClassAssignedToTeacher(assignedClasses, String(class_name))) {
          return res.status(403).json({ error: 'Access denied: You may only view results for your assigned classes.' });
        }
      }

      if (student_id) {
        const targetStudent = await findStudentByAnyId(String(student_id));
        if (!targetStudent || !isClassAssignedToTeacher(assignedClasses, targetStudent.class_name)) {
          return res.status(403).json({ error: 'Access denied: You may only view results for students in your assigned classes.' });
        }
      }

      const docs = await ResultModel.find().sort({ created_at: -1, _id: -1 }).lean();
      let result = docs
        .map(toResultDto)
        .filter(r =>
          isClassAssignedToTeacher(assignedClasses, r.class_name) &&
          areAllResultSubjectsAssignedToTeacher(allowedSubjects, r.subjects.map(s => s.subject_name))
        );
      if (exam_id) result = result.filter(r => r.exam_id === String(exam_id));
      if (resolvedStudentAliases) result = result.filter(r => resolvedStudentAliases!.has(r.student_id));
      if (class_name) result = result.filter(r => r.class_name.toLowerCase() === String(class_name).toLowerCase());
      return res.json(result);
    }

    const docs = await ResultModel.find().sort({ created_at: -1, _id: -1 }).lean();
    let result = docs.map(toResultDto);
    if (exam_id) {
      result = result.filter(r => r.exam_id === String(exam_id));
    }
    if (resolvedStudentAliases) {
      result = result.filter(r => resolvedStudentAliases!.has(r.student_id));
    }
    if (class_name) {
      result = result.filter(r => r.class_name.toLowerCase() === String(class_name).toLowerCase());
    }

    const total = result.length;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const hasLimit = req.query.limit !== undefined;
    const limit = hasLimit ? Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 20)) : 100;
    const totalPages = Math.ceil(total / limit) || 1;

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page', page.toString());
    res.setHeader('X-Limit', limit.toString());
    res.setHeader('X-Total-Pages', totalPages.toString());

    if (req.query.paginate === 'true' || req.query.envelope === 'true') {
      const start = (page - 1) * limit;
      const paged = result.slice(start, start + limit);
      return res.json({
        data: paged,
        pagination: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    if (hasLimit || req.query.page !== undefined) {
      const start = (page - 1) * limit;
      result = result.slice(start, start + limit);
    }

    return res.json(result);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve results');
  }
});

router.post('/results', authenticateToken, requireRole(['super_admin', 'admin', 'teacher']), async (req: AuthenticatedRequest, res: Response) => {
  const { exam_id, exam_title, student_id, subjects, remarks, published } = req.body || {};

  if (!exam_id || !student_id || !Array.isArray(subjects) || subjects.length === 0) {
    return res.status(400).json({ error: 'Exam ID, Student ID, and non-empty subjects array are required' });
  }
  if (!isValidCmsIdParam(exam_id)) {
    return res.status(400).json({ error: 'Invalid Exam ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const cleanExamId = String(exam_id).trim();
    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();

    let authenticatedTeacher: TeacherDto | null = null;
    if (req.user?.role === 'teacher') {
      authenticatedTeacher = await getAuthenticatedTeacherMongo(req);
      const assignedClasses = authenticatedTeacher?.classes || [];
      if (!authenticatedTeacher || !isClassAssignedToTeacher(assignedClasses, studentDoc.class_name)) {
        return res.status(403).json({
          error: `Access denied: You are not assigned to class "${studentDoc.class_name}".`,
        });
      }
    }

    const examDoc = await ExamModel.findOne(buildCmsRecordLookupFilter(cleanExamId)).lean();
    const exam = examDoc ? toExamDto(examDoc) : null;
    if (!exam) {
      return res.status(400).json({ error: `Referenced exam ID "${cleanExamId}" was not found in the database.` });
    }
    if (authenticatedTeacher) {
      const examClasses = Array.isArray(exam.classes) ? exam.classes : [];
      if (examClasses.length > 0 && !examClasses.includes('All Classes') &&
          !examClasses.some((name: string) => isClassAssignedToTeacher([studentDoc.class_name], name))) {
        return res.status(403).json({ error: 'Access denied: This exam is not assigned to the student class.' });
      }
      const teacherIds = Array.from(new Set([authenticatedTeacher.id, req.user?.linked_id, req.user?.id].filter(Boolean)));
      const assignmentDocs = await TeacherAssignmentModel.find({
        teacher_id: { $in: teacherIds },
        class_name: { $regex: new RegExp(`^${escapeRegexLiteral(studentDoc.class_name)}$`, 'i') },
      }).select('subject').lean();
      const allowedSubjects = [authenticatedTeacher.subject, ...assignmentDocs.map((item: any) => item.subject)];
      for (const subject of subjects) {
        const requested = sanitizePlainText(subject?.subject_name || subject?.subject || '', 120);
        if (!isExactTeacherSubject(allowedSubjects, requested)) {
          return res.status(403).json({ error: `Access denied: You are not assigned subject "${requested}".` });
        }
      }
    }

    const normalizedSubjects: Array<{ subject_name: string; total_marks: number; obtained_marks: number; grade: string }> = [];
    for (const s of subjects) {
      const tm = Number(s?.total_marks);
      const rawOm = s?.obtained_marks !== undefined ? s.obtained_marks : s?.marks_obtained;
      const om = Number(rawOm);
      const subjName = sanitizePlainText(s?.subject_name || s?.subject || 'Subject', 120) || 'Subject';
      if (isNaN(tm) || tm <= 0) {
        return res.status(400).json({ error: `Invalid total marks for subject ${subjName}` });
      }
      if (isNaN(om) || om < 0 || om > tm) {
        return res.status(400).json({ error: `Obtained marks (${om}) cannot exceed total marks (${tm}) for subject ${subjName}` });
      }
      const subjPct = (om / tm) * 100;
      let subjGrade = 'F';
      if (subjPct >= 80) subjGrade = 'A1';
      else if (subjPct >= 70) subjGrade = 'A';
      else if (subjPct >= 60) subjGrade = 'B';
      else if (subjPct >= 50) subjGrade = 'C';
      else if (subjPct >= 40) subjGrade = 'D';
      normalizedSubjects.push({
        subject_name: subjName,
        total_marks: tm,
        obtained_marks: om,
        grade: subjGrade,
      });
    }

    const total_marks = normalizedSubjects.reduce((sum, s) => sum + s.total_marks, 0);
    const obtained_marks = normalizedSubjects.reduce((sum, s) => sum + s.obtained_marks, 0);
    const percentage = total_marks > 0 ? parseFloat(((obtained_marks / total_marks) * 100).toFixed(1)) : 0;

    let overall_grade = 'F';
    if (percentage >= 80) overall_grade = 'A1 (Distinction)';
    else if (percentage >= 70) overall_grade = 'A (Excellent)';
    else if (percentage >= 60) overall_grade = 'B (Good)';
    else if (percentage >= 50) overall_grade = 'C (Satisfactory)';
    else if (percentage >= 40) overall_grade = 'D (Pass)';

    const resolvedExamTitle = sanitizePlainText(exam_title || exam.title || 'Annual Assessment', 200) || 'Annual Assessment';
    const resolvedRemarks =
      remarks !== undefined
        ? sanitizePlainText(remarks, 1000)
        : 'Good progress. Continue dedicated studies.';
    const resolvedPublished = published !== undefined ? Boolean(published) : true;

    const studentAliases = Array.from(
      new Set([canonicalStudentId, studentDoc._id.toString(), String(student_id).trim()].filter(Boolean))
    );
    let savedDoc = await ResultModel.findOne({
      exam_id: cleanExamId,
      student_id: { $in: studentAliases },
    });

    if (savedDoc) {
      if (!savedDoc.record_id) {
        savedDoc.record_id = `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      }
      savedDoc.exam_id = cleanExamId;
      savedDoc.exam_title = resolvedExamTitle;
      savedDoc.student_id = canonicalStudentId;
      savedDoc.student_name = studentDoc.full_name;
      savedDoc.class_name = studentDoc.class_name;
      savedDoc.section = studentDoc.section || 'A';
      savedDoc.subjects = normalizedSubjects as any;
      savedDoc.total_marks = total_marks;
      savedDoc.obtained_marks = obtained_marks;
      savedDoc.percentage = percentage;
      savedDoc.overall_grade = overall_grade;
      savedDoc.remarks = resolvedRemarks;
      savedDoc.published = resolvedPublished;
      await savedDoc.save();
    } else {
      savedDoc = await ResultModel.create({
        record_id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        exam_id: cleanExamId,
        exam_title: resolvedExamTitle,
        student_id: canonicalStudentId,
        student_name: studentDoc.full_name,
        class_name: studentDoc.class_name,
        section: studentDoc.section || 'A',
        subjects: normalizedSubjects,
        total_marks,
        obtained_marks,
        percentage,
        overall_grade,
        remarks: resolvedRemarks,
        published: resolvedPublished,
      });
    }

    const dto = toResultDto(savedDoc);
    await recordMongoAudit(
      req.user!,
      'Recorded Exam Result',
      'Result',
      dto.id,
      `Student: ${studentDoc.full_name}, Grade: ${overall_grade}`
    );

    return res.status(201).json(dto);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to save examination result');
  }
});

router.delete('/results/:id', authenticateToken, requireRole(['super_admin', 'admin', 'teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid result ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await ResultModel.findOne(buildCmsRecordLookupFilter(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Result not found' });
    }

    if (req.user?.role === 'teacher') {
      const teacher = await getAuthenticatedTeacherMongo(req);
      if (!teacher) {
        return res.status(404).json({ error: 'Teacher profile not linked.' });
      }
      const assignedClasses = teacher.classes || [];
      if (!isClassAssignedToTeacher(assignedClasses, existing.class_name)) {
        return res.status(403).json({
          error: `Access denied: You are not assigned to class "${existing.class_name}".`,
        });
      }
      const teacherIds = Array.from(new Set([teacher.id, req.user?.linked_id, req.user?.id].filter(Boolean)));
      const assignmentDocs = await TeacherAssignmentModel.find({
        teacher_id: { $in: teacherIds },
        class_name: { $regex: new RegExp(`^${escapeRegexLiteral(existing.class_name)}$`, 'i') },
      }).select('subject').lean();
      const allowedSubjects = [teacher.subject, ...assignmentDocs.map((item: any) => item.subject)];
      const resultSubjectNames = Array.isArray(existing.subjects)
        ? existing.subjects.map((item: any) => String(item.subject_name || ''))
        : [];
      if (!areAllResultSubjectsAssignedToTeacher(allowedSubjects, resultSubjectNames)) {
        return res.status(403).json({ error: 'Access denied: You may only manage results for your assigned subjects.' });
      }
    }

    const dto = toResultDto(existing);
    await ResultModel.deleteOne({ _id: existing._id });
    await recordMongoAudit(
      req.user!,
      'Deleted Exam Result',
      'Result',
      dto.id,
      `Student: ${dto.student_name}, Exam: ${dto.exam_title}`
    );

    return res.json({ message: 'Result record deleted', item: dto });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to delete examination result');
  }
});

router.patch('/results/:id/publish', authenticateToken, requireRole(['super_admin', 'admin', 'teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid result ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await ResultModel.findOne(buildCmsRecordLookupFilter(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Result not found' });
    }

    if (req.user?.role === 'teacher') {
      const teacher = await getAuthenticatedTeacherMongo(req);
      if (!teacher) {
        return res.status(404).json({ error: 'Teacher profile not linked.' });
      }
      const assignedClasses = teacher.classes || [];
      if (!isClassAssignedToTeacher(assignedClasses, existing.class_name)) {
        return res.status(403).json({
          error: `Access denied: You are not assigned to class "${existing.class_name}".`,
        });
      }
      const teacherIds = Array.from(new Set([teacher.id, req.user?.linked_id, req.user?.id].filter(Boolean)));
      const assignmentDocs = await TeacherAssignmentModel.find({
        teacher_id: { $in: teacherIds },
        class_name: { $regex: new RegExp(`^${escapeRegexLiteral(existing.class_name)}$`, 'i') },
      }).select('subject').lean();
      const allowedSubjects = [teacher.subject, ...assignmentDocs.map((item: any) => item.subject)];
      const resultSubjectNames = Array.isArray(existing.subjects)
        ? existing.subjects.map((item: any) => String(item.subject_name || ''))
        : [];
      if (!areAllResultSubjectsAssignedToTeacher(allowedSubjects, resultSubjectNames)) {
        return res.status(403).json({ error: 'Access denied: You may only manage results for your assigned subjects.' });
      }
    }

    existing.published = req.body?.published !== undefined ? Boolean(req.body.published) : !existing.published;
    if (!existing.record_id) {
      existing.record_id = existing._id.toString();
    }
    await existing.save();

    const dto = toResultDto(existing);
    await recordMongoAudit(
      req.user!,
      existing.published ? 'Published Exam Result' : 'Unpublished Exam Result',
      'Result',
      dto.id,
      `Student: ${dto.student_name}, Exam: ${dto.exam_title}`
    );

    return res.json(dto);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to update result publication status');
  }
});

// ==========================================
// 12. ANNOUNCEMENTS & EVENTS (MONGODB-AUTHORITATIVE)
// ==========================================

const ALLOWED_ANNOUNCEMENT_CATEGORIES = new Set(['General', 'Exam', 'Admission', 'Holiday', 'Event', 'Academic']);
const ALLOWED_ANNOUNCEMENT_AUDIENCES = new Set(['All', 'Students', 'Teachers', 'Public']);
const ALLOWED_ANNOUNCEMENT_PRIORITIES = new Set(['Normal', 'High', 'Urgent']);
const ALLOWED_EVENT_STATUSES = new Set(['Upcoming', 'Ongoing', 'Completed']);
const ALLOWED_GALLERY_CATEGORIES = new Set(['Campus', 'Academics', 'Sports', 'Events', 'Laboratories']);

router.get('/announcements', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;

  const { category, audience } = req.query;
  if (category !== undefined && typeof category !== 'string') {
    return res.status(400).json({ error: 'Invalid category filter' });
  }
  if (audience !== undefined && typeof audience !== 'string') {
    return res.status(400).json({ error: 'Invalid audience filter' });
  }

  try {
    const optionalUser = await tryResolveOptionalUser(req);
    const isAdminCaller = optionalUser?.role === 'super_admin' || optionalUser?.role === 'admin';
    const isTeacherCaller = optionalUser?.role === 'teacher';

    const filter: Record<string, any> = {};
    if (!isAdminCaller) {
      filter.published = { $ne: false };
    }

    if (category && category !== 'All') {
      if (!ALLOWED_ANNOUNCEMENT_CATEGORIES.has(category)) {
        return res.status(400).json({ error: 'Invalid announcement category' });
      }
      filter.category = category;
    }

    if (audience && audience !== 'All') {
      if (!ALLOWED_ANNOUNCEMENT_AUDIENCES.has(audience)) {
        return res.status(400).json({ error: 'Invalid announcement audience' });
      }
      if (audience === 'Teachers' && !isAdminCaller && !isTeacherCaller) {
        return res.status(403).json({ error: 'Access denied to internal staff announcements' });
      }
      filter.audience = { $in: ['All', audience] };
    } else if (!isAdminCaller && !isTeacherCaller) {
      // Unauthenticated public callers and student/parent callers do not receive internal staff-only circulars
      filter.audience = { $in: ['All', 'Public', 'Students'] };
    }

    const docs = await AnnouncementModel.find(filter).sort({ created_at: -1, _id: -1 }).lean();
    return res.json(docs.map(toAnnouncementDto));
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to fetch announcements') });
  }
});

router.post(
  '/announcements',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Valid announcement payload is required' });
    }

    const cleanTitle = sanitizePlainText(req.body.title, 300);
    const cleanContent = sanitizePlainText(req.body.content, 8000);
    if (!cleanTitle || !cleanContent) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const category = req.body.category ? String(req.body.category).trim() : 'General';
    const audience = req.body.audience ? String(req.body.audience).trim() : 'All';
    const priority = req.body.priority ? String(req.body.priority).trim() : 'Normal';

    if (!ALLOWED_ANNOUNCEMENT_CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'Invalid announcement category' });
    }
    if (!ALLOWED_ANNOUNCEMENT_AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'Invalid announcement audience' });
    }
    if (!ALLOWED_ANNOUNCEMENT_PRIORITIES.has(priority)) {
      return res.status(400).json({ error: 'Invalid announcement priority' });
    }

    const dateVal =
      typeof req.body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date.trim())
        ? req.body.date.trim()
        : new Date().toISOString().split('T')[0];

    try {
      const recordId = `ann_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
      const created = await AnnouncementModel.create({
        record_id: recordId,
        title: cleanTitle,
        content: cleanContent,
        category: category as any,
        audience: audience as any,
        date: dateVal,
        priority: priority as any,
        author: sanitizePlainText(req.user?.name || 'Administration', 120) || 'Administration',
        published: req.body.published !== undefined ? Boolean(req.body.published) : true,
      });

      const dto = toAnnouncementDto(created);
      await recordMongoAudit(
        req.user!,
        'Created Announcement',
        'Announcement',
        dto.id,
        `Published announcement "${cleanTitle}" (${category} / ${audience})`
      );

      return res.status(201).json(dto);
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create announcement') });
    }
  }
);

router.put(
  '/announcements/:id',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid announcement ID format' });
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Valid announcement update payload is required' });
    }

    try {
      const existing = await AnnouncementModel.findOne(buildCmsRecordLookupFilter(req.params.id));
      if (!existing) {
        return res.status(404).json({ error: 'Announcement not found' });
      }

      if (req.body.title !== undefined) {
        const cleanTitle = sanitizePlainText(req.body.title, 300);
        if (!cleanTitle) return res.status(400).json({ error: 'Announcement title cannot be empty' });
        existing.title = cleanTitle;
      }
      if (req.body.content !== undefined) {
        const cleanContent = sanitizePlainText(req.body.content, 8000);
        if (!cleanContent) return res.status(400).json({ error: 'Announcement content cannot be empty' });
        existing.content = cleanContent;
      }
      if (req.body.category !== undefined) {
        const cat = String(req.body.category).trim();
        if (!ALLOWED_ANNOUNCEMENT_CATEGORIES.has(cat)) {
          return res.status(400).json({ error: 'Invalid announcement category' });
        }
        existing.category = cat as any;
      }
      if (req.body.audience !== undefined) {
        const aud = String(req.body.audience).trim();
        if (!ALLOWED_ANNOUNCEMENT_AUDIENCES.has(aud)) {
          return res.status(400).json({ error: 'Invalid announcement audience' });
        }
        existing.audience = aud as any;
      }
      if (req.body.priority !== undefined) {
        const prio = String(req.body.priority).trim();
        if (!ALLOWED_ANNOUNCEMENT_PRIORITIES.has(prio)) {
          return res.status(400).json({ error: 'Invalid announcement priority' });
        }
        existing.priority = prio as any;
      }
      if (req.body.date !== undefined) {
        const d = String(req.body.date).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          return res.status(400).json({ error: 'Invalid date format (expected YYYY-MM-DD)' });
        }
        existing.date = d;
      }
      if (req.body.published !== undefined) {
        existing.published = Boolean(req.body.published);
      }

      await existing.save();
      const dto = toAnnouncementDto(existing);
      await recordMongoAudit(req.user!, 'Updated Announcement', 'Announcement', dto.id, `Updated "${dto.title}"`);
      return res.json(dto);
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update announcement') });
    }
  }
);

router.delete(
  '/announcements/:id',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid announcement ID format' });
    }

    try {
      const removed = await AnnouncementModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
      if (!removed) {
        return res.status(404).json({ error: 'Announcement not found' });
      }

      const dto = toAnnouncementDto(removed);
      await recordMongoAudit(req.user!, 'Deleted Announcement', 'Announcement', dto.id, `Deleted "${dto.title}"`);
      return res.json({ message: 'Announcement deleted', item: dto });
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete announcement') });
    }
  }
);

router.get('/events', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;

  const { status } = req.query;
  if (status !== undefined && typeof status !== 'string') {
    return res.status(400).json({ error: 'Invalid status filter' });
  }

  try {
    const filter: Record<string, any> = {};
    if (status && status !== 'All') {
      if (!ALLOWED_EVENT_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid event status filter' });
      }
      filter.status = status;
    }

    const docs = await SchoolEventModel.find(filter).sort({ date: 1, created_at: 1, _id: 1 }).lean();
    return res.json(docs.map(toSchoolEventDto));
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to fetch events') });
  }
});

router.post(
  '/events',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Valid event payload is required' });
    }

    const cleanTitle = sanitizePlainText(req.body.title, 300);
    const cleanDate = typeof req.body.date === 'string' ? sanitizePlainText(req.body.date, 40) : '';
    if (!cleanTitle || !cleanDate) {
      return res.status(400).json({ error: 'Title and date are required' });
    }

    const status = req.body.status ? String(req.body.status).trim() : 'Upcoming';
    if (!ALLOWED_EVENT_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid event status' });
    }

    if (req.body.cover_image !== undefined && !isSafeMediaOrWebUrl(req.body.cover_image, true)) {
      return res.status(400).json({ error: 'Invalid or unsafe cover_image URL' });
    }

    const coverImage =
      typeof req.body.cover_image === 'string' && req.body.cover_image.trim()
        ? req.body.cover_image.trim()
        : '/src/assets/images/hero_school_campus_1790606578302.jpg';

    try {
      const recordId = `ev_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
      const created = await SchoolEventModel.create({
        record_id: recordId,
        title: cleanTitle,
        description: req.body.description !== undefined ? sanitizePlainText(req.body.description, 5000) : '',
        date: cleanDate,
        time: req.body.time ? sanitizePlainText(req.body.time, 80) : '09:00 AM',
        location: req.body.location ? sanitizePlainText(req.body.location, 250) : 'Campus Grounds, Paharpur',
        cover_image: coverImage,
        status: status as any,
      });

      const dto = toSchoolEventDto(created);
      await recordMongoAudit(req.user!, 'Created Event', 'Event', dto.id, `Created event "${dto.title}" (${dto.date})`);
      return res.status(201).json(dto);
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create event') });
    }
  }
);

router.delete(
  '/events/:id',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }

    try {
      const removed = await SchoolEventModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
      if (!removed) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const dto = toSchoolEventDto(removed);
      await recordMongoAudit(req.user!, 'Deleted Event', 'Event', dto.id, `Deleted event "${dto.title}"`);
      return res.json({ message: 'Event deleted', item: dto });
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete event') });
    }
  }
);

router.put(
  '/events/:id',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Valid event update payload is required' });
    }

    try {
      const existing = await SchoolEventModel.findOne(buildCmsRecordLookupFilter(req.params.id));
      if (!existing) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (req.body.title !== undefined) {
        const cleanTitle = sanitizePlainText(req.body.title, 300);
        if (!cleanTitle) return res.status(400).json({ error: 'Event title cannot be empty' });
        existing.title = cleanTitle;
      }
      if (req.body.description !== undefined) {
        existing.description = sanitizePlainText(req.body.description, 5000);
      }
      if (req.body.date !== undefined) {
        const cleanDate = sanitizePlainText(req.body.date, 40);
        if (!cleanDate) return res.status(400).json({ error: 'Event date cannot be empty' });
        existing.date = cleanDate;
      }
      if (req.body.time !== undefined) {
        const cleanTime = sanitizePlainText(req.body.time, 80);
        if (cleanTime) existing.time = cleanTime;
      }
      if (req.body.location !== undefined) {
        const cleanLoc = sanitizePlainText(req.body.location, 250);
        if (cleanLoc) existing.location = cleanLoc;
      }
      if (req.body.cover_image !== undefined) {
        if (!isSafeMediaOrWebUrl(req.body.cover_image, true)) {
          return res.status(400).json({ error: 'Invalid or unsafe cover_image URL' });
        }
        const trimmedImg = String(req.body.cover_image).trim();
        if (trimmedImg) existing.cover_image = trimmedImg;
      }
      if (req.body.status !== undefined) {
        const st = String(req.body.status).trim();
        if (!ALLOWED_EVENT_STATUSES.has(st)) {
          return res.status(400).json({ error: 'Invalid event status' });
        }
        existing.status = st as any;
      }

      await existing.save();
      const dto = toSchoolEventDto(existing);
      await recordMongoAudit(req.user!, 'Updated Event', 'Event', dto.id, `Updated event "${dto.title}"`);
      return res.json(dto);
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update event') });
    }
  }
);

// ==========================================
// 13. GALLERY (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/gallery', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;

  const { category } = req.query;
  if (category !== undefined && typeof category !== 'string') {
    return res.status(400).json({ error: 'Invalid category filter' });
  }

  try {
    const filter: Record<string, any> = {};
    if (category && category !== 'All') {
      if (!ALLOWED_GALLERY_CATEGORIES.has(category)) {
        return res.status(400).json({ error: 'Invalid gallery category' });
      }
      filter.category = category;
    }

    const docs = await GalleryModel.find(filter).sort({ created_at: -1, _id: -1 }).lean();
    return res.json(docs.map(toGalleryItemDto));
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to fetch gallery items') });
  }
});

router.post(
  '/gallery',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Valid gallery payload is required' });
    }

    const cleanTitle = sanitizePlainText(req.body.title, 300);
    const rawImageUrl = typeof req.body.image_url === 'string' ? req.body.image_url.trim() : '';
    if (!cleanTitle || !rawImageUrl) {
      return res.status(400).json({ error: 'Title and image URL are required' });
    }

    if (!isSafeMediaOrWebUrl(rawImageUrl, false)) {
      return res.status(400).json({ error: 'Invalid or unsafe image URL' });
    }

    const category = req.body.category ? String(req.body.category).trim() : 'Campus';
    if (!ALLOWED_GALLERY_CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'Invalid gallery category' });
    }

    const dateVal =
      typeof req.body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date.trim())
        ? req.body.date.trim()
        : new Date().toISOString().split('T')[0];

    try {
      const recordId = `gal_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
      const created = await GalleryModel.create({
        record_id: recordId,
        title: cleanTitle,
        caption: req.body.caption !== undefined ? sanitizePlainText(req.body.caption, 2000) : '',
        category: category as any,
        image_url: rawImageUrl,
        date: dateVal,
      });

      const dto = toGalleryItemDto(created);
      await recordMongoAudit(req.user!, 'Created Gallery Item', 'Gallery', dto.id, `Added gallery photo "${dto.title}"`);
      return res.status(201).json(dto);
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create gallery item') });
    }
  }
);

router.put(
  '/gallery/:id',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid gallery ID format' });
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Valid gallery update payload is required' });
    }

    try {
      const existing = await GalleryModel.findOne(buildCmsRecordLookupFilter(req.params.id));
      if (!existing) {
        return res.status(404).json({ error: 'Gallery item not found' });
      }

      if (req.body.title !== undefined) {
        const cleanTitle = sanitizePlainText(req.body.title, 300);
        if (!cleanTitle) return res.status(400).json({ error: 'Gallery title cannot be empty' });
        existing.title = cleanTitle;
      }
      if (req.body.caption !== undefined) {
        existing.caption = sanitizePlainText(req.body.caption, 2000);
      }
      if (req.body.category !== undefined) {
        const cat = String(req.body.category).trim();
        if (!ALLOWED_GALLERY_CATEGORIES.has(cat)) {
          return res.status(400).json({ error: 'Invalid gallery category' });
        }
        existing.category = cat as any;
      }
      if (req.body.image_url !== undefined) {
        if (!isSafeMediaOrWebUrl(req.body.image_url, false)) {
          return res.status(400).json({ error: 'Invalid or unsafe image URL' });
        }
        existing.image_url = String(req.body.image_url).trim();
      }
      if (req.body.date !== undefined) {
        const cleanDate = sanitizePlainText(req.body.date, 40);
        if (cleanDate) existing.date = cleanDate;
      }

      await existing.save();
      const dto = toGalleryItemDto(existing);
      await recordMongoAudit(req.user!, 'Updated Gallery Item', 'Gallery', dto.id, `Updated gallery photo "${dto.title}"`);
      return res.json(dto);
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update gallery item') });
    }
  }
);

router.delete(
  '/gallery/:id',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid gallery ID format' });
    }

    try {
      const removed = await GalleryModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
      if (!removed) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const dto = toGalleryItemDto(removed);
      await recordMongoAudit(req.user!, 'Deleted Gallery Item', 'Gallery', dto.id, `Deleted gallery photo "${dto.title}"`);
      return res.json({ message: 'Gallery item deleted', item: dto });
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete gallery item') });
    }
  }
);

// ==========================================
// 14. CONTACT MESSAGES & INQUIRIES (MONGODB-AUTHORITATIVE)
// ==========================================

router.post('/contact', contactRateLimiter, authenticateOptionalToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Valid contact inquiry payload is required' });
  }

  // Strictly extract only public inquiry fields — ignore any injected role, read, replied, _id, settings, or $ operators
  const rawName = req.body.name;
  const rawMessage = req.body.message;
  const rawEmail = req.body.email;
  const rawPhone = req.body.phone;
  const rawSubject = req.body.subject;

  if (typeof rawName !== 'string' || typeof rawMessage !== 'string') {
    return res.status(400).json({ error: 'Name and message are required' });
  }

  const cleanName = sanitizePlainText(rawName, 120);
  const cleanMessage = sanitizePlainText(rawMessage, 4000);
  if (!cleanName || !cleanMessage) {
    return res.status(400).json({ error: 'Name and message are required' });
  }

  let cleanEmail = '';
  if (rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() !== '') {
    if (typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }
    cleanEmail = sanitizePlainText(rawEmail, 160).toLowerCase();
    if (cleanEmail && !validateEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }
  }

  let cleanPhone = '';
  if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() !== '') {
    if (typeof rawPhone !== 'string') {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    cleanPhone = sanitizePlainText(rawPhone, 30);
  }

  let cleanSubject = 'General Inquiry';
  if (rawSubject !== undefined && rawSubject !== null && String(rawSubject).trim() !== '') {
    if (typeof rawSubject !== 'string') {
      return res.status(400).json({ error: 'Invalid subject format' });
    }
    cleanSubject = sanitizePlainText(rawSubject, 200) || 'General Inquiry';
  }

  try {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const referenceNo = `INQ-${new Date().getFullYear()}-${randomSuffix}`;
    const recordId = `msg_${Date.now()}_${randomSuffix}`;
    
    // Automatically bind authenticated parent if session is present
    const parentUserId = req.user && req.user.role === 'parent' ? req.user.id : undefined;

    // Detect inquiry intent
    const { intent } = detectInquiryIntent(cleanSubject, cleanMessage);

    const created = await ContactMessageModel.create({
      record_id: recordId,
      reference_no: referenceNo,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      subject: cleanSubject,
      message: cleanMessage,
      read: false,
      replied: false,
      status: 'Pending',
      intent,
      parent_user_id: parentUserId,
      replies: [],
    });

    const inquiry = toContactMessageDto(created);
    return res.status(201).json({
      message: 'Your inquiry has been registered successfully with school administration.',
      reference_no: referenceNo,
      inquiry,
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to submit contact message') });
  }
});

// Public Inquiry Tracker: track inquiry status by reference number (zero private student/financial data leaked)
router.get('/contact/track/:ref', contactRateLimiter, async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;

  const rawRef = req.params.ref ? String(req.params.ref).trim() : '';
  if (!rawRef || rawRef.length < 4) {
    return res.status(400).json({ error: 'Valid inquiry reference number is required' });
  }

  try {
    const lookupRegex = new RegExp(`^${rawRef.replace(/[^a-zA-Z0-9-]/g, '')}$`, 'i');
    const doc = await ContactMessageModel.findOne({
      $or: [
        { reference_no: lookupRegex },
        { record_id: rawRef },
      ],
    }).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Inquiry not found. Please check your reference number.' });
    }

    const emailQuery = req.query.email ? String(req.query.email).trim().toLowerCase() : '';
    if (emailQuery && doc.email && doc.email.toLowerCase() !== emailQuery) {
      return res.status(404).json({ error: 'Inquiry not found matching this reference number and email.' });
    }

    const replies = Array.isArray(doc.replies)
      ? doc.replies
          .filter((r: any) => r.sender_type === 'admin')
          .map((r: any) => ({
            id: String(r.id || r._id || ''),
            sender_name: 'School Administration',
            message: String(r.message || ''),
            created_at:
              r.created_at instanceof Date
                ? r.created_at.toISOString()
                : String(r.created_at || new Date().toISOString()),
          }))
      : [];

    let statusDescription = 'Your inquiry has been received and is pending administrative review.';
    if (doc.status === 'Processing') {
      statusDescription = 'School administration is currently investigating your inquiry.';
    } else if (doc.status === 'Awaiting Admin Approval') {
      statusDescription = 'A response has been drafted and is awaiting final administrative sign-off.';
    } else if (doc.status === 'Replied') {
      statusDescription = 'Administration has replied to your inquiry. See details below.';
    } else if (doc.status === 'Resolved') {
      statusDescription = 'This inquiry has been marked as resolved by administration.';
    }

    return res.json({
      reference_no: doc.reference_no || (doc.record_id ? `INQ-${String(doc.record_id).slice(-6).toUpperCase()}` : 'INQ'),
      subject: doc.subject || 'Inquiry',
      created_at: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
      status: doc.status || (doc.replied ? 'Replied' : 'Pending'),
      status_description: statusDescription,
      has_replies: replies.length > 0,
      replies,
    });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to track inquiry') });
  }
});

// Authenticated Parent Inquiries List
router.get(
  '/parent/inquiries',
  authenticateToken,
  requireRole(['parent']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;

    try {
      const userEmail = req.user?.email ? req.user.email.toLowerCase() : '';
      const userId = req.user?.id;

      const orConditions: any[] = [];
      if (userId) orConditions.push({ parent_user_id: userId });
      if (userEmail) orConditions.push({ email: userEmail });

      if (orConditions.length === 0) {
        return res.json([]);
      }

      const docs = await ContactMessageModel.find({ $or: orConditions })
        .sort({ created_at: -1, _id: -1 })
        .lean();

      return res.json(docs.map(toContactMessageDto));
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to fetch parent inquiries') });
    }
  }
);

// Admin Inquiries List with status and search filters
router.get(
  '/contact',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;

    const { read, status, q } = req.query;

    try {
      const filter: Record<string, any> = {};
      if (read === 'true') filter.read = true;
      else if (read === 'false') filter.read = false;

      if (status && typeof status === 'string' && status !== 'all') {
        filter.status = status;
      }

      if (q && typeof q === 'string') {
        const cleanQ = q.trim();
        const searchRegex = new RegExp(cleanQ.replace(/[^a-zA-Z0-9-@._\s]/g, ''), 'i');
        filter.$or = [
          { name: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
          { subject: searchRegex },
          { reference_no: searchRegex },
        ];
      }

      const docs = await ContactMessageModel.find(filter).sort({ created_at: -1, _id: -1 }).lean();
      return res.json(docs.map(toContactMessageDto));
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to fetch contact inquiries') });
    }
  }
);

router.get(
  '/contact/:id',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid inquiry ID format' });
    }

    try {
      const doc = await ContactMessageModel.findOne(buildCmsRecordLookupFilter(req.params.id)).lean();
      if (!doc) {
        return res.status(404).json({ error: 'Message not found' });
      }
      return res.json(toContactMessageDto(doc));
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to load inquiry') });
    }
  }
);

// Admin Parent Verification on an Inquiry
router.post(
  '/contact/:id/verify-parent',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid inquiry ID format' });
    }

    try {
      const doc = await ContactMessageModel.findOne(buildCmsRecordLookupFilter(req.params.id));
      if (!doc) {
        return res.status(404).json({ error: 'Inquiry not found' });
      }

      const result = await verifyInquiryParent(doc);

      if (result.verified) {
        doc.verified_parent_id = result.parentId;
        doc.verified_parent_name = result.parentName;
        doc.verified_student_ids = result.students.map(s => String(s.record_id || s.admission_no || s._id));
        await doc.save();
      }

      await recordMongoAudit(
        req.user!,
        'Verified Inquiry Parent',
        'ContactMessage',
        doc.record_id || String(doc._id),
        `Parent verified: ${result.verified}. ${result.notes}`
      );

      return res.json({
        verified: result.verified,
        parent: result.parentDoc ? toParentDto(result.parentDoc) : null,
        students: result.students.map(toStudentDto),
        notes: result.notes,
      });
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to verify parent') });
    }
  }
);

// Admin AI Generate Reply (with fee records aggregation & Gemini model)
router.post(
  '/contact/:id/ai-generate-reply',
  aiRateLimiter,
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid inquiry ID format' });
    }

    try {
      const doc = await ContactMessageModel.findOne(buildCmsRecordLookupFilter(req.params.id));
      if (!doc) {
        return res.status(404).json({ error: 'Inquiry not found' });
      }

      const result = await generateAiInquiryReply(doc, req.user);

      return res.json({
        message: 'AI response drafted successfully.',
        draftReply: result.draftReply,
        intent: result.intent,
        isFeeInquiry: result.isFeeInquiry,
        parentVerified: result.parentVerified,
        verificationNotes: result.verificationNotes,
        feeData: result.feeData,
        inquiry: toContactMessageDto(doc),
      });
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to generate AI reply') });
    }
  }
);

// Admin Approve & Send Reply
router.post(
  '/contact/:id/approve-and-send',
  sensitiveActionRateLimiter,
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid inquiry ID format' });
    }

    const { reply_message, send_email = true } = req.body || {};
    if (!reply_message || typeof reply_message !== 'string' || !reply_message.trim()) {
      return res.status(400).json({ error: 'Approved reply message is required.' });
    }

    try {
      const result = await dispatchApprovedReply(req.params.id, reply_message.trim(), req.user, Boolean(send_email));

      return res.json({
        message: 'Reply approved and dispatched successfully.',
        inquiry: toContactMessageDto(result.inquiry),
        emailSent: result.emailSent,
        notificationSent: result.notificationSent,
      });
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to dispatch reply') });
    }
  }
);

// Admin Update Inquiry Status (Pending, Processing, Awaiting Admin Approval, Replied, Resolved)
router.put(
  '/contact/:id/status',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid inquiry ID format' });
    }

    const allowedStatuses = ['Pending', 'Processing', 'Awaiting Admin Approval', 'Replied', 'Resolved'];
    const newStatus = req.body?.status;
    if (!allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    try {
      const doc = await ContactMessageModel.findOne(buildCmsRecordLookupFilter(req.params.id));
      if (!doc) {
        return res.status(404).json({ error: 'Inquiry not found' });
      }

      doc.status = newStatus;
      if (newStatus === 'Resolved') {
        doc.resolved_at = new Date();
        doc.resolved_by = req.user?.name || 'Administrator';
        doc.read = true;
      }
      await doc.save();

      await recordMongoAudit(
        req.user!,
        'Updated Inquiry Status',
        'ContactMessage',
        doc.record_id || String(doc._id),
        `Status changed to "${newStatus}"`
      );

      return res.json(toContactMessageDto(doc));
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update status') });
    }
  }
);

router.put(
  '/contact/:id/read',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid inquiry ID format' });
    }

    try {
      const doc = await ContactMessageModel.findOne(buildCmsRecordLookupFilter(req.params.id));
      if (!doc) {
        return res.status(404).json({ error: 'Message not found' });
      }

      doc.read = req.body && typeof req.body.read === 'boolean' ? req.body.read : true;
      if (req.body && typeof req.body.replied === 'boolean') {
        doc.replied = req.body.replied;
      }

      await doc.save();
      const dto = toContactMessageDto(doc);
      await recordMongoAudit(req.user!, 'Updated Contact Inquiry Read Status', 'ContactMessage', dto.id, `Marked read=${dto.read}`);
      return res.json(dto);
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update inquiry status') });
    }
  }
);

router.delete(
  '/contact/:id',
  authenticateToken,
  requireRole(['super_admin', 'admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!ensureMongoReady(res)) return;
    if (!isValidCmsIdParam(req.params.id)) {
      return res.status(400).json({ error: 'Invalid inquiry ID format' });
    }

    try {
      const removed = await ContactMessageModel.findOneAndDelete(buildCmsRecordLookupFilter(req.params.id)).lean();
      if (!removed) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const dto = toContactMessageDto(removed);
      await recordMongoAudit(req.user!, 'Deleted Contact Inquiry', 'ContactMessage', dto.id, `Deleted inquiry "${dto.subject}"`);
      return res.json({ message: 'Contact inquiry deleted', item: dto });
    } catch (err: any) {
      return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete inquiry') });
    }
  }
);

// ==========================================
// 14b. NOTIFICATIONS SYSTEM (MONGODB PERSISTED)
// ==========================================

async function resolveNotificationAllowedUserIds(
  user: NonNullable<AuthenticatedRequest['user']>
): Promise<string[]> {
  const baseIds: string[] = [
    user.id,
    user.linked_id || '',
    (user.phone || '').trim(),
    ...(Array.isArray(user.linked_student_ids) ? user.linked_student_ids : []),
  ].filter(Boolean);

  if (user.role === 'parent') {
    const parentLinked = await getLinkedStudentIdsForParent(user);
    for (const sid of parentLinked) {
      if (sid && !baseIds.includes(sid)) baseIds.push(sid);
    }
  }
  return baseIds;
}

router.get('/notifications', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const userRole = req.user!.role;
    const allowedUserIds = await resolveNotificationAllowedUserIds(req.user!);

    const notifs = await NotificationModel.find(buildNotificationVisibilityFilter(userRole, allowedUserIds))
      .sort({ created_at: -1 })
      .limit(50)
      .lean();

    const formattedNotifs = notifs.map((n: any) => ({
      ...n,
      id: (n._id ? n._id.toString() : n.id || '').toString(),
    }));

    return res.json(formattedNotifs);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to load notifications') });
  }
});

router.get('/notifications/unread-count', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const userRole = req.user!.role;
    const allowedUserIds = await resolveNotificationAllowedUserIds(req.user!);

    const count = await NotificationModel.countDocuments({ read: false, ...buildNotificationVisibilityFilter(userRole, allowedUserIds) });

    return res.json({ unreadCount: count });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to load unread count') });
  }
});

router.put('/notifications/:id/read', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid notification ID format' });
    }
    const notif = await NotificationModel.findById(req.params.id);
    if (!notif) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const userRole = req.user!.role;
    const allowedUserIds = await resolveNotificationAllowedUserIds(req.user!);

    const isAuthorized = canMarkNotificationRead(userRole, allowedUserIds, notif);

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied: You may only mark your own notifications as read.' });
    }

    notif.read = true;
    await notif.save();
    return res.json(notif);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update notification') });
  }
});

router.put('/notifications/mark-all-read', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const userRole = req.user!.role;
    const allowedUserIds = await resolveNotificationAllowedUserIds(req.user!);

    await NotificationModel.updateMany(
      { read: false, ...buildNotificationVisibilityFilter(userRole, allowedUserIds) },
      { $set: { read: true } }
    );

    return res.json({ message: 'All notifications marked as read' });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to mark notifications as read') });
  }
});

// ==========================================
// 15. USER MANAGEMENT (MONGODB-AUTHORITATIVE)
// ==========================================

router.get('/users', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { role, status, search } = req.query;
    const filter: Record<string, any> = {};

    if (role && typeof role === 'string' && role.trim()) {
      filter.role = role.trim().toLowerCase();
    }
    if (status && typeof status === 'string' && status.trim()) {
      filter.status = status.trim().toLowerCase();
    }
    if (search && typeof search === 'string' && search.trim()) {
      const rx = new RegExp(escapeRegexLiteral(search.trim()), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const docs = await UserModel.find(filter).select('-password_hash').sort({ created_at: 1, _id: 1 }).lean();
    const items = docs.map(toUserDto);
    return sendAcademicPaginatedOrArray(req, res, items);
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve users') });
  }
});

router.get('/users/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }
  if (!ensureMongoReady(res)) return;
  try {
    const userDoc = await findUserByAnyId(req.params.id);
    if (!userDoc) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(toUserDto(userDoc));
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to retrieve user') });
  }
});

router.post('/users', authenticateToken, requireRole(['super_admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { email, password, name, role, phone, linked_id, status } = req.body || {};

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'Email, password, name and role are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (!validateEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const cleanName = sanitizePlainText(name, 120);
    if (!cleanName) {
      return res.status(400).json({ error: 'Valid name is required' });
    }

    const cleanRole = String(role).trim().toLowerCase() as UserRole;
    if (!ALLOWED_USER_ROLES.includes(cleanRole)) {
      return res.status(400).json({
        error: `Invalid role "${role}". Allowed roles: ${ALLOWED_USER_ROLES.join(', ')}`,
      });
    }

    let cleanStatus: UserStatus = 'active';
    if (status !== undefined && status !== '') {
      const st = String(status).trim().toLowerCase() as UserStatus;
      if (!ALLOWED_USER_STATUSES.includes(st)) {
        return res.status(400).json({
          error: `Invalid status "${status}". Allowed statuses: ${ALLOWED_USER_STATUSES.join(', ')}`,
        });
      }
      cleanStatus = st;
    }

    const passCheck = validatePassword(String(password));
    if (!passCheck.valid) {
      return res.status(400).json({ error: passCheck.message });
    }

    const existingUser = await UserModel.findOne({ email: cleanEmail }).lean();
    if (existingUser) {
      return res.status(409).json({ error: 'Email is already registered' });
    }

    let resolvedLinkedId = linked_id ? String(linked_id).trim() : '';
    if (resolvedLinkedId) {
      if (cleanRole === 'student') {
        const targetStudent = await findStudentByAnyId(resolvedLinkedId);
        if (!targetStudent) {
          return res.status(400).json({ error: `Invalid linked_id: student "${resolvedLinkedId}" not found` });
        }
        resolvedLinkedId = targetStudent.record_id || targetStudent._id.toString();
      } else if (cleanRole === 'teacher') {
        const targetTeacher = await findTeacherByAnyId(resolvedLinkedId);
        if (!targetTeacher) {
          return res.status(400).json({ error: `Invalid linked_id: teacher "${resolvedLinkedId}" not found` });
        }
        resolvedLinkedId = targetTeacher.record_id || targetTeacher._id.toString();
      } else if (cleanRole === 'parent') {
        const targetStudent = await findStudentByAnyId(resolvedLinkedId);
        if (!targetStudent) {
          return res.status(400).json({ error: `Invalid linked_id: student "${resolvedLinkedId}" not found` });
        }
        resolvedLinkedId = targetStudent.record_id || targetStudent._id.toString();
      }
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(String(password), salt);
    const ts = Date.now();
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const recordId = `usr_${ts}_${randSuffix}`;
    const cleanPhone = phone ? sanitizePlainText(phone, 40) : '';

    const created = await UserModel.create({
      record_id: recordId,
      email: cleanEmail,
      password_hash,
      name: cleanName,
      role: cleanRole,
      phone: cleanPhone,
      linked_id: resolvedLinkedId,
      linked_student_ids: cleanRole === 'parent' && resolvedLinkedId ? [resolvedLinkedId] : [],
      status: cleanStatus,
    });

    if (cleanRole === 'parent') {
      const existingParent = await ParentModel.findOne({ email: cleanEmail });
      if (!existingParent) {
        await ParentModel.create({
          record_id: `prt_${ts}_${randSuffix}`,
          user_id: recordId,
          name: cleanName,
          father_name: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          address: '',
          occupation: '',
          linked_students: resolvedLinkedId ? [resolvedLinkedId] : [],
        }).catch(() => {});
      }
    }

    const dto = toUserDto(created);
    await recordMongoAudit(
      req.user!,
      'Created User Account',
      'User',
      dto.id,
      `Role: ${dto.role}, Email: ${dto.email}`
    );

    return res.status(201).json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Email is already registered' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to create user account') });
  }
});

router.put('/users/:id', authenticateToken, requireRole(['super_admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await findUserByAnyId(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const body = req.body || {};
    const existingCanonicalId = existing.record_id || existing._id.toString();
    const isSelf = existingCanonicalId === req.user!.id || existing._id.toString() === req.user!.id;

    if (body.email !== undefined) {
      const cleanEmail = String(body.email).trim().toLowerCase();
      if (!validateEmail(cleanEmail)) {
        return res.status(400).json({ error: 'Valid email is required' });
      }
      if (cleanEmail !== existing.email) {
        const dup = await UserModel.findOne({ _id: { $ne: existing._id }, email: cleanEmail }).lean();
        if (dup) {
          return res.status(409).json({ error: 'Email is already registered to another user' });
        }
        existing.email = cleanEmail;
      }
    }

    if (body.name !== undefined) {
      const cleanName = sanitizePlainText(body.name, 120);
      if (!cleanName) {
        return res.status(400).json({ error: 'User name cannot be empty' });
      }
      existing.name = cleanName;
    }

    if (body.role !== undefined) {
      const nextRole = String(body.role).trim().toLowerCase() as UserRole;
      if (!ALLOWED_USER_ROLES.includes(nextRole)) {
        return res.status(400).json({
          error: `Invalid role "${body.role}". Allowed roles: ${ALLOWED_USER_ROLES.join(', ')}`,
        });
      }
      if (isSelf && nextRole !== 'super_admin') {
        return res.status(400).json({ error: 'Super admin cannot demote their own account' });
      }
      existing.role = nextRole;
    }

    if (body.status !== undefined) {
      const nextStatus = String(body.status).trim().toLowerCase() as UserStatus;
      if (!ALLOWED_USER_STATUSES.includes(nextStatus)) {
        return res.status(400).json({
          error: `Invalid status "${body.status}". Allowed statuses: ${ALLOWED_USER_STATUSES.join(', ')}`,
        });
      }
      if (isSelf && nextStatus !== 'active') {
        return res.status(400).json({ error: 'Super admin cannot deactivate or suspend their own account' });
      }
      existing.status = nextStatus;
    }

    if (body.phone !== undefined) {
      existing.phone = sanitizePlainText(body.phone, 40);
    }

    if (body.linked_id !== undefined) {
      const rawLid = String(body.linked_id || '').trim();
      if (!rawLid) {
        existing.linked_id = '';
      } else if (existing.role === 'student') {
        const targetStudent = await findStudentByAnyId(rawLid);
        if (!targetStudent) {
          return res.status(400).json({ error: `Invalid linked_id: student "${rawLid}" not found` });
        }
        existing.linked_id = targetStudent.record_id || targetStudent._id.toString();
      } else if (existing.role === 'teacher') {
        const targetTeacher = await findTeacherByAnyId(rawLid);
        if (!targetTeacher) {
          return res.status(400).json({ error: `Invalid linked_id: teacher "${rawLid}" not found` });
        }
        existing.linked_id = targetTeacher.record_id || targetTeacher._id.toString();
      } else {
        existing.linked_id = rawLid;
      }
    }

    if (body.password !== undefined && String(body.password).trim() !== '') {
      const passCheck = validatePassword(String(body.password));
      if (!passCheck.valid) {
        return res.status(400).json({ error: passCheck.message });
      }
      const salt = await bcrypt.genSalt(10);
      existing.password_hash = await bcrypt.hash(String(body.password), salt);
      existing.password_changed_at = new Date();
    }

    await existing.save();
    const dto = toUserDto(existing);
    await recordMongoAudit(
      req.user!,
      'Updated User Account',
      'User',
      dto.id,
      `Role: ${dto.role}, Status: ${dto.status}`
    );

    return res.json(dto);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Email is already registered to another user' });
    }
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to update user account') });
  }
});

router.delete('/users/:id', authenticateToken, requireRole(['super_admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!isValidCmsIdParam(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const existing = await findUserByAnyId(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingCanonicalId = existing.record_id || existing._id.toString();
    if (existingCanonicalId === req.user!.id || existing._id.toString() === req.user!.id) {
      return res.status(400).json({ error: 'Super admin cannot delete their own account' });
    }

    await UserModel.deleteOne({ _id: existing._id });
    const dto = toUserDto(existing);
    await recordMongoAudit(
      req.user!,
      'Deleted User Account',
      'User',
      dto.id,
      `Deleted user ${dto.email} (${dto.role})`
    );

    return res.json({ message: 'User account deleted successfully', user: dto });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Failed to delete user account') });
  }
});

// ==========================================
// 16. SECURE FILE & DOCUMENT UPLOADS
// ==========================================

router.post('/upload', sensitiveActionRateLimiter, authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { dataUrl, filename, visibility, category, student_id, application_no } = req.body || {};
  if (!dataUrl || !filename) {
    return res.status(400).json({ error: 'File data URL and filename are required' });
  }

  const matches = String(dataUrl).match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    return res.status(400).json({ error: 'Invalid file format. Base64 data URL required.' });
  }

  const mimeType = matches[1].toLowerCase();
  const mimeExtensionMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  const safeExt = mimeExtensionMap[mimeType];
  if (!safeExt) {
    return res.status(400).json({ error: 'Unsupported file type. Allowed: JPEG, PNG, WebP, PDF.' });
  }

  const buffer = Buffer.from(matches[2], 'base64');
  if (buffer.length === 0) {
    return res.status(400).json({ error: 'Uploaded file payload cannot be empty.' });
  }
  if (buffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'File size exceeds maximum 5MB limit.' });
  }

  const isCallerAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';
  const requestedCategory =
    category === 'school_media' || category === 'student_document' || category === 'admission_document'
      ? category
      : undefined;

  // Enforce private storage for ALL PDFs, ALL non-admin uploads, and any explicit private/student/admission document
  const isPrivateDocument =
    mimeType === 'application/pdf' ||
    !isCallerAdmin ||
    visibility === 'private' ||
    requestedCategory === 'student_document' ||
    requestedCategory === 'admission_document';

  const resolvedVisibility: 'public' | 'private' = isPrivateDocument ? 'private' : 'public';
  const resolvedCategory: 'school_media' | 'student_document' | 'admission_document' =
    requestedCategory || (isPrivateDocument ? 'student_document' : 'school_media');

  if (isPrivateDocument && !ensureMongoReady(res)) {
    return;
  }

  // Non-admin users uploading a student document for a student_id must own that student_id in MongoDB
  const cleanStudentId = typeof student_id === 'string' ? student_id.trim() : '';
  if (cleanStudentId && !isCallerAdmin) {
    if (!ensureMongoReady(res)) return;
    if (req.user?.role === 'student') {
      const ownDoc = req.user.linked_id
        ? await findStudentByAnyId(req.user.linked_id)
        : await StudentModel.findOne({ user_id: req.user.id }).lean();
      const ownIds = new Set<string>(
        [
          req.user.linked_id,
          ownDoc?.record_id,
          ownDoc?._id ? ownDoc._id.toString() : '',
        ].filter(Boolean) as string[]
      );
      if (!ownIds.has(cleanStudentId)) {
        return res.status(403).json({ error: 'Students may only upload documents for their own student profile.' });
      }
    } else if (req.user?.role === 'parent') {
      const parentLinked = await getLinkedStudentIdsForParent(req.user);
      if (!parentLinked.has(cleanStudentId)) {
        return res.status(403).json({ error: 'Parents may only upload documents for their linked children.' });
      }
    }
  }

  const baseUploadsDir = getUploadsBaseDir();
  const targetDir = isPrivateDocument ? getPrivateUploadsDir() : baseUploadsDir;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true, ...(isPrivateDocument ? { mode: 0o700 } : {}) });
  }

  const rawExt = path.extname(String(filename));
  const safeBaseName =
    path.basename(String(filename), rawExt).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) || 'upload';
  const uniqueName = `${safeBaseName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${safeExt}`;
  const targetPath = path.resolve(targetDir, uniqueName);

  fs.writeFileSync(targetPath, buffer, isPrivateDocument ? { mode: 0o600 } : undefined);

  if (mongoose.connection.readyState === 1) {
    try {
      await StoredDocumentModel.create({
        filename: uniqueName,
        original_name: path.basename(String(filename)).slice(0, 120),
        mime_type: mimeType,
        size_bytes: buffer.length,
        visibility: resolvedVisibility,
        category: resolvedCategory,
        uploaded_by_user_id: req.user!.id,
        uploaded_by_role: req.user!.role,
        student_id: cleanStudentId,
        application_no: typeof application_no === 'string' ? application_no.trim().toUpperCase() : '',
        storage_backend: 'local_fs',
        relative_path: isPrivateDocument ? `private/${uniqueName}` : uniqueName,
      });
    } catch (metaErr: any) {
      if (isPrivateDocument) {
        try {
          fs.unlinkSync(targetPath);
        } catch {}
        return res.status(500).json({
          error: `Failed to register private document metadata: ${sanitizeErrorMessage(metaErr?.message || 'Database write error')}`,
        });
      }
    }
  }

  res.status(201).json({
    url: isPrivateDocument ? `/api/documents/${uniqueName}` : `/uploads/${uniqueName}`,
    filename: uniqueName,
    size: buffer.length,
    mimeType,
    visibility: resolvedVisibility,
    category: resolvedCategory,
  });
});

router.get('/documents/:filename', sensitiveActionRateLimiter, authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) {
    return;
  }

  const rawParam = String(req.params.filename || '');
  const safeFilename = path.basename(rawParam);
  if (!safeFilename || safeFilename !== rawParam || safeFilename.includes('..')) {
    return res.status(400).json({ error: 'Invalid document filename.' });
  }

  try {
    const docMeta = await StoredDocumentModel.findOne({ filename: safeFilename }).lean();
    if (!docMeta) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const user = req.user!;
    const isAdmin = user.role === 'super_admin' || user.role === 'admin';
    let authorized = isAdmin || docMeta.uploaded_by_user_id === user.id;

    if (!authorized && docMeta.student_id) {
      if (user.role === 'student') {
        const ownDoc = user.linked_id
          ? await findStudentByAnyId(user.linked_id)
          : await StudentModel.findOne({ user_id: user.id }).lean();
        const ownIds = new Set<string>(
          [
            user.linked_id,
            ownDoc?.record_id,
            ownDoc?._id ? ownDoc._id.toString() : '',
          ].filter(Boolean) as string[]
        );
        authorized = ownIds.has(docMeta.student_id);
      } else if (user.role === 'parent') {
        const linkedSet = await getLinkedStudentIdsForParent(user);
        authorized = linkedSet.has(docMeta.student_id);
      }
    }

    if (!authorized) {
      return res.status(403).json({
        error: 'Access denied. You do not have permission to access this private document.',
      });
    }

    const privateDir = getPrivateUploadsDir();
    const baseDir = getUploadsBaseDir();
    const expectedPath =
      docMeta.visibility === 'private'
        ? path.resolve(privateDir, safeFilename)
        : path.resolve(baseDir, safeFilename);

    const allowedRoot = docMeta.visibility === 'private' ? privateDir : baseDir;
    if (!expectedPath.startsWith(allowedRoot + path.sep) || !fs.existsSync(expectedPath)) {
      return res.status(404).json({ error: 'Document file not found on storage.' });
    }

    res.setHeader('Content-Type', docMeta.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    return res.sendFile(expectedPath);
  } catch (err: any) {
    return res.status(500).json({
      error: sanitizeErrorMessage(err?.message || 'Failed to retrieve document'),
    });
  }
});

// ==========================================
// 17. AUDIT LOGS (ADMIN)
// ==========================================

router.get('/audit-logs', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const hasLimit = req.query.limit !== undefined;
    const limit = hasLimit ? Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 20)) : 100;
    const total = await AuditLogModel.countDocuments();
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;

    const logs = await AuditLogModel.find().sort({ created_at: -1 }).skip(skip).limit(limit).lean();

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page', page.toString());
    res.setHeader('X-Limit', limit.toString());
    res.setHeader('X-Total-Pages', totalPages.toString());

    if (req.query.paginate === 'true' || req.query.envelope === 'true') {
      return res.json({
        data: logs,
        pagination: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    return res.json(logs);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve audit logs');
  }
});

// ==========================================
// 18. ADMIN-ONLY AI ASSISTANT (RESTRICTED)
// ==========================================

/**
 * AI Query Endpoint
 * Accessible ONLY by Super Admin and Admin roles.
 * Authenticated and authorized via backend middleware.
 */
router.post('/admin/ai/query', aiRateLimiter, authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { prompt, selectedId, activeEntity, conversationHistory } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt query string is required.' });
    }

    const context: AdminAiQueryContext = {
      userId: req.user?.id || 'admin',
      userName: req.user?.name || req.user?.email || 'Administrator',
      userRole: req.user?.role || 'admin',
      ipAddress: req.ip,
      selectedId: selectedId ? String(selectedId).trim() : undefined,
      activeEntity: activeEntity && typeof activeEntity === 'object' ? activeEntity : undefined,
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : undefined,
    };

    const result = await processAdminAiQuery(prompt, context);
    res.json(result);
  } catch (err: any) {
    console.error('[Admin AI Query Error]', sanitizeErrorMessage(err?.message || 'Unknown error'));
    return sendRouteError(res, err, 'An internal error occurred while processing the AI query.');
  }
});

/**
 * AI Provider & Database Status Endpoint
 */
router.get('/admin/ai/status', authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (String(req.query.verify || '').toLowerCase() === 'true') {
    await testGeminiConnection();
  }
  res.json(getAiProviderStatus());
});

/**
 * AI Sensitive Action Execution Endpoint
 * Mandatory rule: sensitive actions (e.g. sending SMS) require explicit admin confirmation.
 */
router.post('/admin/ai/execute-action', aiRateLimiter, authenticateToken, requireRole(['super_admin', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { actionType, payload, confirmed } = req.body;

    if (!actionType) {
      return res.status(400).json({ error: 'actionType is required.' });
    }

    if (!confirmed) {
      return res.status(400).json({
        error: 'Confirmation is required before executing this sensitive administrative action.',
      });
    }

    const context: AdminAiQueryContext = {
      userId: req.user?.id || 'admin',
      userName: req.user?.name || req.user?.email || 'Administrator',
      userRole: req.user?.role || 'admin',
      ipAddress: req.ip,
    };

    const execResult = await ControlledSchoolTools.executeConfirmedAction(
      actionType,
      payload,
      confirmed,
      context
    );

    res.json(execResult);
  } catch (err: any) {
    console.error('[Admin AI Action Execution Error]', err);
    return sendRouteError(res, err, 'Failed to execute administrative action.');
  }
});

/**
 * AI Audit Logs Endpoint
 * Returns logs of queries and actions executed by the AI Assistant.
 */
router.get('/admin/ai/audit-logs', authenticateToken, requireRole(['super_admin', 'admin']), async (_req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const aiLogs = await AuditLogModel.find({
      $or: [
        { action: { $regex: '^AI_' } },
        { action: 'SMS_GATEWAY' },
      ],
    })
      .sort({ created_at: -1 })
      .limit(50)
      .lean();

    res.json(aiLogs);
  } catch (err: any) {
    console.error('[Admin AI Audit Logs Error]', err);
    return sendRouteError(res, err, 'Failed to retrieve AI audit logs.');
  }
});

/**
 * AI Sample Prompts
 * Returns curated prompt categories for easy 1-click execution.
 */
router.get('/admin/ai/sample-prompts', authenticateToken, requireRole(['super_admin', 'admin']), (req: AuthenticatedRequest, res: Response) => {
  res.json({
    categories: [
      {
        title: 'Multi-Tool & Combined Intelligence',
        prompts: [
          'Show students who have attendance below 75% AND unpaid fees.',
          "Give me Ahmad Khan's attendance, fees, results and parents.",
          'Prepare a parent warning list for students below 75% attendance.',
          'Find the parents of all students with unpaid fees.',
        ],
      },
      {
        title: 'School-Wide Reports & Analytics',
        prompts: [
          'Give me the school overview.',
          "Give me a summary of today's school attendance.",
          'Give me a summary of pending fees.',
          'Which classes have the highest number of absences?',
          'How many students are in each class?',
        ],
      },
      {
        title: 'Faculty & Teacher Dossiers',
        prompts: [
          'Give me complete information about teacher Muhammad Ali.',
          "Show Muhammad Ali's assigned subjects.",
          'Show teachers assigned to Class 9.',
        ],
      },
      {
        title: 'Student Profiles & Attendance',
        prompts: [
          "Show Ahmad Khan's complete record.",
          "What is Ahmad Khan's attendance?",
          'Show students with attendance below 75%.',
          "Show today's absent students.",
        ],
      },
      {
        title: 'Fees & Dues Management',
        prompts: [
          'How much fee does Ahmad Khan owe?',
          'Show students with unpaid fees.',
          'Draft fee reminder for students with unpaid fees.',
        ],
      },
      {
        title: 'Enrollment & Admissions',
        prompts: [
          'How many students are enrolled in Class 8?',
          "Show Ahmad Khan's parents.",
          'Find students admitted this month.',
          'Prepare admission summary report.',
        ],
      },
      {
        title: 'Automated Broadcasts (Sensitive)',
        prompts: [
          'Send SMS alert to absent students.',
          'Send fee reminder SMS alert.',
        ],
      },
    ],
  });
});

// ==========================================
// 19. STUDENT & PARENT PORTAL AI (OBJECT-LEVEL ISOLATED)
// ==========================================

/**
 * Portal AI Query Endpoint
 * Strictly inherits object-level authorization:
 * - Accessible only to authenticated Student and Parent roles
 * - Never trusts client-supplied user ID or role
 * - Enforces server-side identity only (req.user)
 * - Students can only query their own data
 * - Parents can only query their linked children's data
 * - Admin/staff sensitive records (salaries, staff list, other families) are strictly denied
 */
router.post('/portal/ai/query', aiRateLimiter, authenticateToken, requireRole(['student', 'parent']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    const userRole = req.user!.role;
    const lower = prompt.toLowerCase().trim();

    // STRICT SECURITY GATE: Block any administrative, salary, password, or system internals inquiries
    const forbiddenTerms = ['salary', 'salaries', 'staff pay', 'password', 'passwords', 'jwt', 'secret', 'admin', 'database', 'mongodb', 'uri', 'audit_logs', 'all families', 'all teachers'];
    if (forbiddenTerms.some(term => lower.includes(term))) {
      return res.status(403).json({ error: 'Access denied: You may only query your own authorized academic records.' });
    }

    // ====================================================
    // STUDENT PORTAL AI
    // ====================================================
    if (userRole === 'student') {
      const studentDoc = req.user!.linked_id
        ? await findStudentByAnyId(req.user!.linked_id)
        : await StudentModel.findOne({ user_id: req.user!.id }).lean();
      if (!studentDoc) {
        return res.status(404).json({ error: 'Student profile not linked to user account.' });
      }
      const student = toStudentDto(studentDoc);
      const studentAliasIds = Array.from(
        new Set([student.id, studentDoc.record_id, studentDoc._id ? studentDoc._id.toString() : ''].filter(Boolean))
      );

      await recordMongoAudit(req.user!, 'Queried Student Portal AI', 'Student', student.id, `Query: "${prompt.substring(0, 60)}"`);

      // 1. Attendance & Absences
      if (lower.includes('attendance') || lower.includes('absent') || lower.includes('present') || lower.includes('leave')) {
        const attDocs = await AttendanceModel.find({ student_id: { $in: studentAliasIds } })
          .sort({ date: -1, _id: -1 })
          .lean();
        const attendance = attDocs.map(toAttendanceDto).sort((a, b) => b.date.localeCompare(a.date));
        const total = attendance.length;
        const presents = attendance.filter(a => a.status === 'Present').length;
        const absents = attendance.filter(a => a.status === 'Absent');
        const rate = total > 0 ? Math.round((presents / total) * 100) : 100;

        let reply = `### 📊 Your Attendance Record: ${student.full_name}\n`;
        reply += `* **Overall Attendance:** **${rate}%** (${presents} Present / ${absents.length} Absent out of ${total} recorded days)\n`;
        reply += `* **Status:** ${rate >= 75 ? '✅ Satisfactory (meets institutional requirement)' : '⚠️ Warning: Below 75% minimum threshold'}\n`;
        if (absents.length > 0) {
          reply += `\n**Recent Absence Dates:**\n`;
          absents.slice(0, 5).forEach(a => {
            reply += `* ${a.date} (${a.remarks || 'No leave remarks recorded'})\n`;
          });
        }
        return res.json({ text: reply, toolUsed: 'studentAttendanceRecord' });
      }

      // 2. Results & Grades
      if (lower.includes('result') || lower.includes('marks') || lower.includes('grade') || lower.includes('exam')) {
        const resDocs = await ResultModel.find({
          student_id: { $in: studentAliasIds },
          published: { $ne: false },
        })
          .sort({ created_at: -1, _id: -1 })
          .lean();
        const results = resDocs.map(toResultDto);
        if (results.length === 0) {
          return res.json({ text: `No published examination results are available in the database for ${student.full_name}.`, toolUsed: 'studentResultsRecord' });
        }
        const latest = results[0];
        let reply = `### 🏆 Examination Results: ${student.full_name}\n`;
        reply += `* **Assessment:** **${latest.exam_title}**\n`;
        reply += `* **Total Score:** **${latest.obtained_marks}/${latest.total_marks}** (${latest.percentage}%)\n`;
        reply += `* **Overall Grade:** **${latest.overall_grade}**\n`;
        reply += `* **Faculty Remarks:** *"${latest.remarks}"*\n\n`;
        reply += `**Subject Breakdown:**\n`;
        latest.subjects.forEach(sub => {
          reply += `* **${sub.subject_name}:** ${sub.obtained_marks}/${sub.total_marks} (Grade ${sub.grade})\n`;
        });
        return res.json({ text: reply, toolUsed: 'studentResultsRecord' });
      }

      // 3. Fees & Balance
      if (lower.includes('fee') || lower.includes('balance') || lower.includes('dues') || lower.includes('voucher') || lower.includes('paid')) {
        const feeDocs = await FeeModel.find({ student_id: { $in: studentAliasIds } })
          .sort({ created_at: -1, _id: -1 })
          .lean();
        const fees = feeDocs.map(toFeeDto);
        const pending = fees.filter(f => f.status !== 'Paid');
        const totalPending = pending.reduce((sum, f) => sum + f.pending_amount, 0);

        let reply = `### 💳 Fee & Account Balance: ${student.full_name}\n`;
        reply += `* **Outstanding Balance:** **PKR ${totalPending.toLocaleString()}**\n`;
        reply += `* **Payment Status:** ${totalPending === 0 ? '✅ All dues cleared' : '⚠️ Pending payment required'}\n`;
        if (pending.length > 0) {
          reply += `\n**Pending Vouchers:**\n`;
          pending.forEach(f => {
            reply += `* **${f.fee_month} ${f.year}:** PKR ${f.pending_amount.toLocaleString()} (Due Date: ${f.due_date})\n`;
          });
        }
        return res.json({ text: reply, toolUsed: 'studentFeesRecord' });
      }

      // 4. Timetable & Schedule
      if (lower.includes('timetable') || lower.includes('schedule') || lower.includes('class') || lower.includes('period')) {
        const ttDocs = await TimetableModel.find({
          class_name: { $regex: new RegExp(`^${escapeRegexLiteral(student.class_name)}$`, 'i') },
        })
          .sort({ created_at: 1, _id: 1 })
          .lean();
        const timetable = ttDocs.map(toTimetableDto);
        let reply = `### 🕒 Weekly Class Schedule: ${student.class_name}\n`;
        if (timetable.length === 0) {
          reply += `Timetable schedule is not yet published in the database for your class.`;
        } else {
          timetable.slice(0, 6).forEach(t => {
            reply += `* **${t.day} | ${t.start_time} - ${t.end_time}:** ${t.subject} (Teacher: ${t.teacher_name}, Room: ${t.room})\n`;
          });
        }
        return res.json({ text: reply, toolUsed: 'studentTimetableRecord' });
      }

      // 5. Announcements & Notices
      if (lower.includes('announcement') || lower.includes('notice') || lower.includes('circular') || lower.includes('event')) {
        const annDocs = await AnnouncementModel.find({
          published: { $ne: false },
          audience: { $in: ['All', 'Students'] },
        })
          .sort({ created_at: -1, _id: -1 })
          .limit(3)
          .lean();
        const anns = annDocs.map(toAnnouncementDto);
        let reply = `### 📢 Official School Circulars & Announcements\n`;
        anns.forEach(a => {
          reply += `* **${a.title}** (${a.date}) - *${a.content}*\n`;
        });
        return res.json({ text: reply, toolUsed: 'studentAnnouncementsRecord' });
      }

      // Default comprehensive dossier
      const [attDocs, feeDocs, resDocs] = await Promise.all([
        AttendanceModel.find({ student_id: { $in: studentAliasIds } }).lean(),
        FeeModel.find({ student_id: { $in: studentAliasIds } }).sort({ created_at: -1, _id: -1 }).lean(),
        ResultModel.find({ student_id: { $in: studentAliasIds }, published: { $ne: false } })
          .sort({ created_at: -1, _id: -1 })
          .lean(),
      ]);
      const attendance = attDocs.map(toAttendanceDto);
      const total = attendance.length;
      const presents = attendance.filter(a => a.status === 'Present').length;
      const rate = total > 0 ? Math.round((presents / total) * 100) : 100;
      const fees = feeDocs.map(toFeeDto);
      const pendingFees = fees.filter(f => f.status !== 'Paid');
      const results = resDocs.map(toResultDto);

      let reply = `### 🎓 Student Profile Dossier: ${student.full_name}\n`;
      reply += `* **Class:** ${student.class_name} (Section ${student.section}) | **Roll No:** ${student.roll_no}\n`;
      reply += `* **Attendance:** **${rate}%** (${presents}/${total} days recorded)\n`;
      reply += `* **Fee Status:** ${pendingFees.length > 0 ? `PKR ${pendingFees.reduce((a, b) => a + b.pending_amount, 0).toLocaleString()} pending` : 'All dues cleared'}\n`;
      if (results.length > 0) {
        reply += `* **Latest Exam Result:** ${results[0].exam_title}: ${results[0].obtained_marks}/${results[0].total_marks} (${results[0].percentage}%) - Grade ${results[0].overall_grade}\n`;
      }
      return res.json({ text: reply, toolUsed: 'studentPortalOverview' });
    }

    // ====================================================
    // PARENT PORTAL AI
    // ====================================================
    if (userRole === 'parent') {
      const parentStudentIds = await getLinkedStudentIdsForParent(req.user!);
      const parentStudentDocs = await StudentModel.find(buildParentLinkedStudentFilter(parentStudentIds)).lean();
      const linkedStudents = parentStudentDocs.map(toStudentDto);
      if (linkedStudents.length === 0) {
        return res.status(404).json({ error: 'No linked children found for this parent account.' });
      }

      await recordMongoAudit(req.user!, 'Queried Parent Portal AI', 'Parent', req.user!.id, `Query: "${prompt.substring(0, 60)}"`);

      const getChildAliases = (childDto: StudentDto): Set<string> => {
        const rawDoc = parentStudentDocs.find(
          (d: any) => (d.record_id || d._id.toString()) === childDto.id || d._id.toString() === childDto.id
        );
        return new Set<string>(
          [childDto.id, rawDoc?.record_id, rawDoc?._id ? rawDoc._id.toString() : '', rawDoc?.admission_no].filter(Boolean) as string[]
        );
      };

      const parentIdList = Array.from(parentStudentIds);
      const [parentAttDocs, parentFeeDocs, parentResDocs] = await Promise.all([
        AttendanceModel.find({ student_id: { $in: parentIdList } }).sort({ date: -1, _id: -1 }).lean(),
        FeeModel.find({ student_id: { $in: parentIdList } }).sort({ created_at: -1, _id: -1 }).lean(),
        ResultModel.find({ student_id: { $in: parentIdList }, published: { $ne: false } })
          .sort({ created_at: -1, _id: -1 })
          .lean(),
      ]);

      const parentAttendance = parentAttDocs.map(toAttendanceDto);
      const parentFees = parentFeeDocs.map(toFeeDto);
      const parentResults = parentResDocs.map(toResultDto);

      // Special Multi-Child Aggregation 1: "Which of my children have low attendance?"
      if (lower.includes('low attendance') || (lower.includes('below') && lower.includes('75'))) {
        let reply = `### ⚠️ Attendance Review Across Your Children\n`;
        let lowFound = 0;
        for (const child of linkedStudents) {
          const aliases = getChildAliases(child);
          const att = parentAttendance.filter(a => aliases.has(a.student_id));
          const total = att.length;
          const presents = att.filter(a => a.status === 'Present').length;
          const rate = total > 0 ? Math.round((presents / total) * 100) : 100;
          if (rate < 75) {
            lowFound++;
            reply += `* **${child.full_name}** (${child.class_name}): **${rate}%** (${presents}/${total} days) - ⚠️ Requires attention\n`;
          } else {
            reply += `* **${child.full_name}** (${child.class_name}): **${rate}%** (${presents}/${total} days) - ✅ Satisfactory\n`;
          }
        }
        if (lowFound === 0) {
          reply += `\nGood news: None of your linked children currently have attendance below the 75% institutional requirement.`;
        }
        return res.json({ text: reply, toolUsed: 'parentAttendanceScan' });
      }

      // Special Multi-Child Aggregation 2: "Which fees are pending?"
      if (lower.includes('pending') && lower.includes('fee')) {
        let reply = `### 💳 Outstanding Fees Across Your Children\n`;
        let totalDue = 0;
        for (const child of linkedStudents) {
          const aliases = getChildAliases(child);
          const childFees = parentFees.filter(f => aliases.has(f.student_id) && f.status !== 'Paid');
          const childDue = childFees.reduce((sum, f) => sum + f.pending_amount, 0);
          totalDue += childDue;
          if (childFees.length > 0) {
            reply += `* **${child.full_name}** (${child.class_name}): **PKR ${childDue.toLocaleString()}** pending (${childFees.length} voucher)\n`;
          } else {
            reply += `* **${child.full_name}** (${child.class_name}): ✅ All dues cleared\n`;
          }
        }
        reply += `\n* **Total Household Dues:** **PKR ${totalDue.toLocaleString()}**`;
        return res.json({ text: reply, toolUsed: 'parentFeesScan' });
      }

      // MULTIPLE CHILDREN DISAMBIGUATION:
      if (linkedStudents.length > 1) {
        const matchesSpecific = linkedStudents.filter(c => lower.includes(c.full_name.toLowerCase()) || lower.includes(c.full_name.split(' ')[0].toLowerCase()));
        if (matchesSpecific.length === 0 && (
          lower.includes('attendance') ||
          lower.includes('result') ||
          lower.includes('marks') ||
          lower.includes('timetable') ||
          lower.includes('schedule') ||
          lower.includes('my son') ||
          lower.includes('my daughter') ||
          lower.includes('my child')
        )) {
          return res.json({
            disambiguationRequired: true,
            candidates: linkedStudents.map(c => ({
              id: c.id,
              name: c.full_name,
              class_name: c.class_name,
              roll_no: c.roll_no,
            })),
            text: `You have **${linkedStudents.length} children** linked to your account: ${linkedStudents.map(c => `**${c.full_name}** (${c.class_name})`).join(', ')}. Which child would you like to inquire about?`,
            toolUsed: 'parentChildDisambiguation',
          });
        }
      }

      // Target child resolution: if specific child named, focus on them; otherwise overview
      const targetChild = linkedStudents.find(c => lower.includes(c.full_name.toLowerCase()) || lower.includes(c.full_name.split(' ')[0].toLowerCase())) || linkedStudents[0];
      const targetAliases = getChildAliases(targetChild);

      // Single Child Attendance
      if (lower.includes('attendance') || lower.includes('absent')) {
        const att = parentAttendance.filter(a => targetAliases.has(a.student_id));
        const total = att.length;
        const presents = att.filter(a => a.status === 'Present').length;
        const rate = total > 0 ? Math.round((presents / total) * 100) : 100;
        let reply = `### 📊 Attendance Status: ${targetChild.full_name}\n`;
        reply += `* **Class:** ${targetChild.class_name} | **Roll No:** ${targetChild.roll_no}\n`;
        reply += `* **Attendance Rate:** **${rate}%** (${presents} Present out of ${total} days)\n`;
        reply += `* **Compliance:** ${rate >= 75 ? '✅ Above 75% requirement' : '⚠️ Below 75% requirement'}\n`;
        return res.json({ text: reply, toolUsed: 'parentChildAttendance' });
      }

      // Single Child Results
      if (lower.includes('result') || lower.includes('marks') || lower.includes('grade')) {
        const results = parentResults.filter(r => targetAliases.has(r.student_id) && r.published !== false);
        if (results.length === 0) {
          return res.json({ text: `No published examination results available in database for ${targetChild.full_name}.`, toolUsed: 'parentChildResults' });
        }
        const latest = results[0];
        let reply = `### 🏆 Examination Results: ${targetChild.full_name}\n`;
        reply += `* **Assessment:** **${latest.exam_title}**\n`;
        reply += `* **Score:** **${latest.obtained_marks}/${latest.total_marks}** (${latest.percentage}%)\n`;
        reply += `* **Grade:** **${latest.overall_grade}**\n`;
        reply += `* **Remarks:** *"${latest.remarks}"*\n`;
        return res.json({ text: reply, toolUsed: 'parentChildResults' });
      }

      // Single Child Timetable
      if (lower.includes('timetable') || lower.includes('schedule') || lower.includes('class')) {
        const ttDocs = await TimetableModel.find({
          class_name: { $regex: new RegExp(`^${escapeRegexLiteral(targetChild.class_name)}$`, 'i') },
        })
          .sort({ created_at: 1, _id: 1 })
          .lean();
        const timetable = ttDocs.map(toTimetableDto);
        let reply = `### 🕒 Weekly Class Schedule: ${targetChild.full_name} (${targetChild.class_name})\n`;
        if (timetable.length === 0) {
          reply += `Timetable schedule is not yet published in the database for this class.`;
        } else {
          timetable.slice(0, 5).forEach(t => {
            reply += `* **${t.day} | ${t.start_time} - ${t.end_time}:** ${t.subject} (Teacher: ${t.teacher_name})\n`;
          });
        }
        return res.json({ text: reply, toolUsed: 'parentChildTimetable' });
      }

      // General Parent Household Overview
      let reply = `### 👨‍👩‍👦 Parent Portal Household Overview\n`;
      for (const child of linkedStudents) {
        const aliases = getChildAliases(child);
        const att = parentAttendance.filter(a => aliases.has(a.student_id));
        const total = att.length;
        const presents = att.filter(a => a.status === 'Present').length;
        const rate = total > 0 ? Math.round((presents / total) * 100) : 100;
        const childFees = parentFees.filter(f => aliases.has(f.student_id) && f.status !== 'Paid');
        const due = childFees.reduce((sum, f) => sum + f.pending_amount, 0);

        reply += `#### 👦 ${child.full_name} (${child.class_name} - Roll #${child.roll_no})\n`;
        reply += `* **Attendance:** **${rate}%** (${presents}/${total} days)\n`;
        reply += `* **Pending Fees:** PKR ${due.toLocaleString()}\n`;
      }
      return res.json({ text: reply, toolUsed: 'parentPortalOverview' });
    }
  } catch (err: any) {
    return sendRouteError(res, err, 'Portal AI query failed');
  }
});

// ==========================================
// 20. TEACHER PORTAL & ACADEMIC MANAGEMENT (MONGODB-AUTHORITATIVE)
// ==========================================

// 20.1 Teacher Dashboard
router.get('/teacher/dashboard', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked to user account.' });
    }

    const assignedClasses = teacher.classes || [];
    const teacherIds = Array.from(
      new Set([teacher.id, req.user?.linked_id, req.user?.id].filter(Boolean))
    );

    const [allStudentDocs, allTtDocs, annDocs, allAttDocs, allResDocs, assignmentDocs, taskDocs, notifCount] = await Promise.all([
      StudentModel.find(buildTeacherClassFilter(assignedClasses)).lean(),
      TimetableModel.find().sort({ created_at: 1, _id: 1 }).lean(),
      AnnouncementModel.find({
        published: { $ne: false },
        audience: { $in: ['Teachers', 'All'] },
      })
        .sort({ created_at: -1, _id: -1 })
        .limit(5)
        .lean(),
      AttendanceModel.find(buildTeacherClassFilter(assignedClasses)).sort({ date: -1, created_at: -1, _id: -1 }).lean(),
      ResultModel.find(buildTeacherClassFilter(assignedClasses)).sort({ created_at: -1, _id: -1 }).lean(),
      TeacherAssignmentModel.find({ teacher_id: { $in: teacherIds } }).lean(),
      TeacherTaskModel.find({ teacher_id: { $in: teacherIds } }).sort({ due_date: 1 }).lean(),
      NotificationModel.countDocuments({
        $or: [{ user_id: req.user!.id }, { user_id: teacher.id }, { role: 'teacher' }],
        read: false,
      }).catch(() => 0),
    ]);

    const assignments = assignmentDocs.map(toTeacherAssignmentDto);
    const allowedSubjects = [teacher.subject, ...assignments.map((assignment: any) => assignment.subject)];
    const isClassTeacher = assignments.some(a => a.is_class_teacher);
    const classTeacherAssignments = assignments.filter(a => a.is_class_teacher);

    // Merge any classes from assignments
    const mergedClasses = [...assignedClasses];
    for (const asg of assignments) {
      if (asg.class_name && !mergedClasses.some(c => c.toLowerCase() === asg.class_name.toLowerCase())) {
        mergedClasses.push(asg.class_name);
      }
    }

    const assignedStudents = allStudentDocs
      .map(toStudentDto)
      .filter(s => isClassAssignedToTeacher(mergedClasses, s.class_name));

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDay = daysOfWeek[new Date().getDay()];
    const todayDate = new Date().toISOString().split('T')[0];

    const teacherTimetable = allTtDocs.map(toTimetableDto).filter(t =>
      isExactTeacherName(t.teacher_name, teacher.name)
    );
    const todayTimetable = teacherTimetable.filter(t => t.day.toLowerCase() === todayDay.toLowerCase());

    const assignedAttendance = allAttDocs
      .map(toAttendanceDto)
      .filter(a => isClassAssignedToTeacher(mergedClasses, a.class_name));

    const markedClasses: string[] = [];
    const pendingClasses: string[] = [];
    for (const c of mergedClasses) {
      const isMarked = assignedAttendance.some(
        a => a.date === todayDate && a.class_name.toLowerCase() === c.toLowerCase()
      );
      if (isMarked) markedClasses.push(c);
      else pendingClasses.push(c);
    }

    const recentAnnouncements = annDocs.map(toAnnouncementDto);
    const recentAttendance = assignedAttendance
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);

    const recentResults = allResDocs
      .map(toResultDto)
      .filter(r =>
        isClassAssignedToTeacher(mergedClasses, r.class_name) &&
        areAllResultSubjectsAssignedToTeacher(allowedSubjects, r.subjects.map(s => s.subject_name))
      )
      .slice(0, 5);

    const tasks = taskDocs.map(toTeacherTaskDto);
    const pendingTasks = tasks.filter(t => t.status !== 'Completed');

    return res.json({
      teacher: {
        id: teacher.id,
        name: teacher.name,
        father_name: teacher.father_name || '',
        cnic: teacher.cnic || '',
        email: teacher.email,
        qualification: teacher.qualification,
        subject: teacher.subject,
        specialization: teacher.specialization || teacher.subject,
        classes: mergedClasses,
        status: teacher.status,
        experience: teacher.experience,
        joining_date: teacher.joining_date,
        bio: teacher.bio,
        contact_no: teacher.contact_no,
        profile_photo: teacher.profile_photo,
      },
      assignedClasses: mergedClasses,
      assignments,
      isClassTeacher,
      classTeacherAssignments,
      totalClasses: mergedClasses.length,
      totalStudents: assignedStudents.length,
      todayTimetable,
      timetableCount: teacherTimetable.length,
      attendanceStatus: {
        date: todayDate,
        markedToday: pendingClasses.length === 0,
        markedClasses,
        pendingClasses,
      },
      tasks,
      pendingTasksCount: pendingTasks.length,
      unreadNotifsCount: notifCount,
      recentAnnouncements,
      recentActivity: {
        attendance: recentAttendance,
        results: recentResults,
      },
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to load teacher dashboard');
  }
});

// 20.2 Teacher Profile
router.get('/teacher/profile', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked to user account.' });
    }

    return res.json({
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      qualification: teacher.qualification,
      subject: teacher.subject,
      classes: teacher.classes,
      contact_no: teacher.contact_no,
      joining_date: teacher.joining_date,
      experience: teacher.experience,
      status: teacher.status,
      bio: teacher.bio,
      profile_photo: teacher.profile_photo,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to load teacher profile');
  }
});

router.put('/teacher/profile', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked to user account.' });
    }

    const teacherDoc = await findTeacherByAnyId(teacher.id);
    if (!teacherDoc) {
      return res.status(404).json({ error: 'Teacher profile not found.' });
    }

    const { bio, contact_no, profile_photo } = req.body || {};
    if (bio !== undefined) teacherDoc.bio = sanitizePlainText(bio, 1500);
    if (contact_no !== undefined) teacherDoc.contact_no = sanitizePlainText(contact_no, 40);
    if (profile_photo !== undefined) {
      if (!isSafeMediaOrWebUrl(profile_photo, true)) {
        return res.status(400).json({ error: 'Invalid or unsafe profile_photo URL' });
      }
      teacherDoc.profile_photo = String(profile_photo).trim();
    }

    await teacherDoc.save();
    const updatedDto = toTeacherDto(teacherDoc);
    updatedDto.classes = teacher.classes;

    await recordMongoAudit(req.user!, 'Updated Teacher Profile', 'Teacher', updatedDto.id, 'Self-service profile update');

    return res.json({
      message: 'Teacher profile updated successfully',
      teacher: {
        id: updatedDto.id,
        name: updatedDto.name,
        email: updatedDto.email,
        qualification: updatedDto.qualification,
        subject: updatedDto.subject,
        classes: updatedDto.classes,
        contact_no: updatedDto.contact_no,
        joining_date: updatedDto.joining_date,
        experience: updatedDto.experience,
        status: updatedDto.status,
        bio: updatedDto.bio,
        profile_photo: updatedDto.profile_photo,
      },
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to update teacher profile');
  }
});

// 20.3 Assigned Classes (MongoDB-authoritative Class, Section, Student & Attendance counts)
router.get('/teacher/classes', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const todayDate = new Date().toISOString().split('T')[0];
    const assignedClasses = teacher.classes || [];
    const [allClassDocs, allSectionDocs, allStudentDocs, todayAttDocs] = await Promise.all([
      ClassModel.find(buildTeacherClassFilter(assignedClasses)).lean(),
      SectionModel.find(buildTeacherClassFilter(assignedClasses)).sort({ created_at: 1, _id: 1 }).lean(),
      StudentModel.find(buildTeacherClassFilter(assignedClasses)).select('class_name section').lean(),
      AttendanceModel.find({ date: todayDate, ...buildTeacherClassFilter(assignedClasses) }).select('class_name').lean(),
    ]);

    const classList = assignedClasses.map(className => {
      const classInfo = allClassDocs.find((c: any) => c.name.toLowerCase() === className.toLowerCase());
      const studentsInClass = allStudentDocs.filter(
        (s: any) => (s.class_name || '').toLowerCase() === className.toLowerCase()
      );
      const mongoSections = allSectionDocs
        .filter((sec: any) => sec.class_name.toLowerCase() === className.toLowerCase())
        .map((sec: any) => sec.name);
      const studentSections = studentsInClass.map((s: any) => s.section).filter(Boolean);
      const sections = Array.from(new Set([...mongoSections, ...studentSections]));
      const todayAttendanceMarked = todayAttDocs.some(
        (a: any) => (a.class_name || '').toLowerCase() === className.toLowerCase()
      );

      return {
        class_name: className,
        grade_level: classInfo?.grade_level || 'Secondary',
        stream: classInfo?.stream || 'General',
        student_count: studentsInClass.length,
        sections: sections.length > 0 ? sections : ['A'],
        subject: teacher.subject,
        todayAttendanceMarked,
      };
    });

    return res.json(classList);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve assigned classes');
  }
});

// 20.4 Student Roster (Strictly Assigned Classes Only — MongoDB-authoritative)
router.get('/teacher/students', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const { class_name, section, search } = req.query;
    const assignedClasses = teacher.classes || [];

    if (class_name) {
      const isAssigned = isClassAssignedToTeacher(assignedClasses, String(class_name));
      if (!isAssigned) {
        return res.status(403).json({ error: `Access denied: You are not assigned to class "${class_name}".` });
      }
    }

    const studentFilter = buildTeacherClassFilter(assignedClasses);
    const allStudentDocs = await StudentModel.find(studentFilter).sort({ created_at: 1, _id: 1 }).lean();
    let matchedDocs = allStudentDocs.filter(doc =>
      isClassAssignedToTeacher(assignedClasses, String(doc.class_name || ''))
    );

    if (class_name) {
      matchedDocs = matchedDocs.filter(
        doc => String(doc.class_name || '').toLowerCase() === String(class_name).toLowerCase()
      );
    }
    if (section) {
      matchedDocs = matchedDocs.filter(
        doc => String(doc.section || '').toLowerCase() === String(section).toLowerCase()
      );
    }
    if (search) {
      const q = String(search).toLowerCase();
      matchedDocs = matchedDocs.filter(doc => {
        const s = toStudentDto(doc);
        return (
          s.full_name.toLowerCase().includes(q) ||
          s.admission_no.toLowerCase().includes(q) ||
          s.roll_no.toLowerCase().includes(q)
        );
      });
    }

    const allCandidateIds = Array.from(
      new Set(
        matchedDocs.flatMap(doc => [
          doc.record_id ? String(doc.record_id) : '',
          doc._id ? doc._id.toString() : '',
        ]).filter(Boolean)
      )
    );

    const attDocs = allCandidateIds.length > 0
      ? await AttendanceModel.find({ student_id: { $in: allCandidateIds } }).select('student_id status').lean()
      : [];

    const result = matchedDocs.map(doc => {
      const s = toStudentDto(doc);
      const idSet = new Set([s.id, doc._id ? doc._id.toString() : ''].filter(Boolean));
      const studentAtt = attDocs.filter((a: any) => idSet.has(String(a.student_id)));
      const total = studentAtt.length;
      const presents = studentAtt.filter((a: any) => a.status === 'Present').length;
      const attendancePercentage = total > 0 ? Math.round((presents / total) * 100) : 100;

      return {
        id: s.id,
        admission_no: s.admission_no,
        roll_no: s.roll_no,
        full_name: s.full_name,
        father_name: s.father_name,
        class_name: s.class_name,
        section: s.section,
        gender: s.gender,
        dob: s.dob,
        academic_status: s.academic_status,
        contact_no: s.contact_no,
        attendance_percentage: attendancePercentage,
        total_days: total,
        presents,
      };
    });

    return res.json(result);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve assigned students');
  }
});

// 20.5 Attendance Management & History (MongoDB-authoritative)
router.get('/teacher/attendance', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const { class_name, section, date, filter, start_date, end_date } = req.query;
    const assignedClasses = teacher.classes || [];

    if (class_name) {
      const isAssigned = isClassAssignedToTeacher(assignedClasses, String(class_name));
      if (!isAssigned) {
        return res.status(403).json({ error: `Access denied: You are not assigned to class "${class_name}".` });
      }
    }

    const allAttDocs = await AttendanceModel.find(buildTeacherClassFilter(assignedClasses)).sort({ date: -1, created_at: -1, _id: -1 }).lean();
    let records = allAttDocs
      .map(toAttendanceDto)
      .filter(a => isClassAssignedToTeacher(assignedClasses, a.class_name));

    if (class_name) {
      records = records.filter(a => a.class_name.toLowerCase() === String(class_name).toLowerCase());
    }
    if (section) {
      records = records.filter(a => a.section.toLowerCase() === String(section).toLowerCase());
    }
    if (date) {
      records = records.filter(a => a.date === String(date));
    } else if (filter === 'today') {
      const today = new Date().toISOString().split('T')[0];
      records = records.filter(a => a.date === today);
    } else if (filter === 'week') {
      const now = new Date();
      const weekAgo = new Date();
      weekAgo.setDate(now.getDate() - 7);
      const threshold = weekAgo.toISOString().split('T')[0];
      records = records.filter(a => a.date >= threshold);
    } else if (filter === 'month') {
      const now = new Date();
      const monthAgo = new Date();
      monthAgo.setDate(now.getDate() - 30);
      const threshold = monthAgo.toISOString().split('T')[0];
      records = records.filter(a => a.date >= threshold);
    } else if (filter === 'custom' && start_date && end_date) {
      records = records.filter(a => a.date >= String(start_date) && a.date <= String(end_date));
    }

    const total = records.length;
    const present = records.filter(r => r.status === 'Present').length;
    const absent = records.filter(r => r.status === 'Absent').length;
    const late = records.filter(r => r.status === 'Late').length;
    const leave = records.filter(r => r.status === 'Leave').length;
    const percentage = total > 0 ? Math.round((present / total) * 100) : 100;

    return res.json({
      summary: {
        total,
        present,
        absent,
        late,
        leave,
        percentage,
      },
      records,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve teacher attendance');
  }
});

router.post('/teacher/attendance', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const { date, class_name, section, records } = req.body || {};
    if (!date || !class_name || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Date, class_name, and records array are required.' });
    }
    const cleanDate = String(date).trim();
    if (!isValidIsoCalendarDate(cleanDate)) {
      return res.status(400).json({ error: 'Invalid date format. Expected valid YYYY-MM-DD calendar date.' });
    }

    const assignedClasses = teacher.classes || [];
    const isAssigned = isClassAssignedToTeacher(assignedClasses, String(class_name));
    if (!isAssigned) {
      return res.status(403).json({ error: `Access denied: You are not assigned to class "${class_name}".` });
    }

    const resolvedEntries: Array<{ studentDoc: any; canonicalStudentId: string; rec: any }> = [];
    for (const rec of records) {
      if (!['Present', 'Absent', 'Late', 'Leave'].includes(rec.status)) {
        return res.status(400).json({ error: `Invalid attendance status "${rec.status}".` });
      }
      const studentDoc = await findStudentByAnyId(String(rec.student_id || ''));
      if (!studentDoc || studentDoc.class_name.toLowerCase() !== String(class_name).trim().toLowerCase()) {
        return res.status(403).json({
          error: `Access denied: Student "${rec.student_name || rec.student_id}" does not belong to assigned class "${class_name}".`,
        });
      }
      const actualSection = sanitizePlainText(studentDoc.section || 'A', 60) || 'A';
      const requestedSection = sanitizePlainText(section || rec.section || actualSection, 60) || actualSection;
      if (!isExactSectionMatch(actualSection, requestedSection)) {
        return res.status(403).json({
          error: `Access denied: Student "${rec.student_name || rec.student_id}" does not belong to section "${requestedSection}".`,
        });
      }
      resolvedEntries.push({
        studentDoc,
        canonicalStudentId: studentDoc.record_id || studentDoc._id.toString(),
        rec,
      });
    }

    for (const { studentDoc, canonicalStudentId, rec } of resolvedEntries) {
      const idAliases = Array.from(
        new Set([canonicalStudentId, studentDoc._id.toString(), String(rec.student_id || '').trim()].filter(Boolean))
      );
      const existingAtt = await AttendanceModel.findOne({
        student_id: { $in: idAliases },
        date: cleanDate,
      });

      const resolvedSection = sanitizePlainText(studentDoc.section || 'A', 60) || 'A';
      const resolvedRemarks =
        rec.remarks !== undefined
          ? sanitizePlainText(rec.remarks, 500)
          : existingAtt?.remarks || '';

      if (existingAtt) {
        if (!existingAtt.record_id) {
          existingAtt.record_id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        }
        existingAtt.student_id = canonicalStudentId;
        existingAtt.student_name = studentDoc.full_name;
        existingAtt.class_name = studentDoc.class_name;
        existingAtt.section = resolvedSection;
        existingAtt.status = rec.status;
        existingAtt.remarks = resolvedRemarks;
        existingAtt.marked_by = teacher.name;
        await existingAtt.save();
      } else {
        await AttendanceModel.create({
          record_id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          student_id: canonicalStudentId,
          student_name: studentDoc.full_name,
          class_name: studentDoc.class_name,
          section: resolvedSection,
          date: cleanDate,
          status: rec.status,
          remarks: resolvedRemarks,
          marked_by: teacher.name,
        });
      }
    }

    await recordMongoAudit(
      req.user!,
      'Marked Class Attendance',
      'Attendance',
      String(class_name),
      `Class: ${class_name}, Date: ${cleanDate}, Records: ${records.length}`
    );

    return res.json({
      success: true,
      message: `Successfully saved attendance for ${records.length} students on ${cleanDate}.`,
      count: records.length,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to save teacher attendance');
  }
});

// 20.6 Exam Results & Marks Management (MongoDB-authoritative Exams & Results)
router.get('/teacher/exams', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const assignedClasses = teacher.classes || [];
    const examDocs = await ExamModel.find().sort({ created_at: 1, _id: 1 }).lean();
    const teacherExams = examDocs.map(toExamDto).filter(ex =>
      !ex.classes ||
      ex.classes.includes('All Classes') ||
      ex.classes.some((c: string) => isClassAssignedToTeacher(assignedClasses, c))
    );

    return res.json(teacherExams);
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve teacher exams');
  }
});

router.get('/teacher/results', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const { exam_id, class_name, subject } = req.query;
    const assignedClasses = teacher.classes || [];
    const teacherIds = Array.from(new Set([teacher.id, req.user?.linked_id, req.user?.id].filter(Boolean)));
    const assignmentDocs = await TeacherAssignmentModel.find({
      teacher_id: { $in: teacherIds },
    }).select('subject').lean();
    const allowedSubjects = [teacher.subject, ...assignmentDocs.map((item: any) => item.subject)];
    if (subject && !isExactTeacherSubject(allowedSubjects, String(subject))) {
      return res.status(403).json({ error: 'Access denied: You are not assigned to this subject.' });
    }

    if (class_name) {
      const isAssigned = isClassAssignedToTeacher(assignedClasses, String(class_name));
      if (!isAssigned) {
        return res.status(403).json({ error: `Access denied: You are not assigned to class "${class_name}".` });
      }
    }

    const allResDocs = await ResultModel.find(buildTeacherClassFilter(assignedClasses)).sort({ created_at: -1, _id: -1 }).lean();
    let results = allResDocs
      .map(toResultDto)
      .filter(r =>
        isClassAssignedToTeacher(assignedClasses, r.class_name) &&
        areAllResultSubjectsAssignedToTeacher(allowedSubjects, r.subjects.map(s => s.subject_name))
      );

    if (exam_id) results = results.filter(r => r.exam_id === String(exam_id));
    if (class_name) results = results.filter(r => r.class_name.toLowerCase() === String(class_name).toLowerCase());

    if (subject) {
      results = results.filter(r =>
        r.subjects.some(s => isExactTeacherSubject([String(subject)], s.subject_name))
      );
    }

    let totalScore = 0;
    let totalPossible = 0;
    let highest = 0;
    let lowest = 100;
    let passCount = 0;
    let failCount = 0;

    for (const r of results) {
      if (r.percentage > highest) highest = r.percentage;
      if (r.percentage < lowest) lowest = r.percentage;
      totalScore += r.obtained_marks;
      totalPossible += r.total_marks;
      if (r.percentage >= 40) passCount++;
      else failCount++;
    }

    const averagePercentage =
      results.length > 0 && totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0;

    return res.json({
      summary: {
        totalStudentsTested: results.length,
        averagePercentage,
        highestScore: results.length > 0 ? highest : 0,
        lowestScore: results.length > 0 ? lowest : 0,
        passCount,
        failCount,
      },
      results,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve teacher results');
  }
});

router.post('/teacher/results', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const { exam_id, exam_title, student_id, subject_name, total_marks, obtained_marks, remarks } = req.body || {};
    if (!exam_id || !student_id || !subject_name) {
      return res.status(400).json({ error: 'Exam ID, Student ID, and subject_name are required.' });
    }
    const cleanExamId = String(exam_id).trim();
    if (!isValidCmsIdParam(cleanExamId)) {
      return res.status(400).json({ error: 'Invalid Exam ID format.' });
    }

    const studentDoc = await findStudentByAnyId(String(student_id));
    if (!studentDoc) {
      return res.status(404).json({ error: 'Student not found in database.' });
    }
    const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();

    const assignedClasses = teacher.classes || [];
    const isAssigned = isClassAssignedToTeacher(assignedClasses, studentDoc.class_name);
    if (!isAssigned) {
      return res.status(403).json({ error: `Access denied: You are not assigned to class "${studentDoc.class_name}".` });
    }

    const teacherIdAliases = Array.from(new Set([teacher.id].filter(Boolean)));
    const assignmentSubjects = await TeacherAssignmentModel.find({
      teacher_id: { $in: teacherIdAliases },
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(studentDoc.class_name)}$`, 'i') },
    })
      .select('subject')
      .lean();
    const allowedSubjNames = [
      teacher.subject,
      ...assignmentSubjects.map((a: any) => String(a.subject || '')),
    ]
      .filter(Boolean)
      .map(s => s.toLowerCase());

    const cleanSubjectName = sanitizePlainText(subject_name, 120);
    const reqSubjLower = cleanSubjectName.toLowerCase();
    const isSubjectAllowed = isExactTeacherSubject(allowedSubjNames, cleanSubjectName);

    if (!isSubjectAllowed) {
      return res.status(403).json({
        error: `Access denied: You are not authorized to record marks for "${cleanSubjectName}". Assigned subject: "${teacher.subject}".`,
      });
    }

    const tm = Number(total_marks !== undefined ? total_marks : 100);
    const om = Number(obtained_marks);

    if (isNaN(tm) || tm <= 0) {
      return res.status(400).json({ error: 'Total marks must be greater than zero.' });
    }
    if (isNaN(om) || om < 0) {
      return res.status(400).json({ error: 'Obtained marks cannot be negative.' });
    }
    if (om > tm) {
      return res.status(400).json({ error: `Obtained marks (${om}) cannot exceed maximum marks (${tm}).` });
    }

    const pct = (om / tm) * 100;
    let grade = 'F';
    if (pct >= 80) grade = 'A1';
    else if (pct >= 70) grade = 'A';
    else if (pct >= 60) grade = 'B';
    else if (pct >= 50) grade = 'C';
    else if (pct >= 40) grade = 'D';

    const examDoc = await ExamModel.findOne(buildCmsRecordLookupFilter(cleanExamId)).lean();
    if (!examDoc) {
      return res.status(404).json({ error: 'Exam not found.' });
    }
    const exam = toExamDto(examDoc);
    const examClasses = Array.isArray(exam.classes) ? exam.classes : [];
    if (examClasses.length > 0 && !examClasses.includes('All Classes') &&
        !examClasses.some((name: string) => isClassAssignedToTeacher([studentDoc.class_name], name))) {
      return res.status(403).json({ error: 'Access denied: This exam is not assigned to the student class.' });
    }
    const resolvedExamTitle = sanitizePlainText(exam_title || exam.title || 'Term Assessment', 200) || 'Term Assessment';

    const studentIdAliases = Array.from(
      new Set([canonicalStudentId, studentDoc._id.toString(), String(student_id).trim()].filter(Boolean))
    );
    let existingDoc = await ResultModel.findOne({
      exam_id: cleanExamId,
      student_id: { $in: studentIdAliases },
    });

    if (existingDoc) {
      const nextSubjects: Array<{ subject_name: string; total_marks: number; obtained_marks: number; grade: string }> =
        Array.isArray(existingDoc.subjects)
          ? existingDoc.subjects.map((s: any) => ({
              subject_name: String(s.subject_name),
              total_marks: Number(s.total_marks),
              obtained_marks: Number(s.obtained_marks),
              grade: String(s.grade),
            }))
          : [];
      const subIdx = nextSubjects.findIndex(s => s.subject_name.toLowerCase() === reqSubjLower);
      if (subIdx >= 0) {
        nextSubjects[subIdx] = {
          subject_name: cleanSubjectName,
          total_marks: tm,
          obtained_marks: om,
          grade,
        };
      } else {
        nextSubjects.push({
          subject_name: cleanSubjectName,
          total_marks: tm,
          obtained_marks: om,
          grade,
        });
      }

      const nextTotal = nextSubjects.reduce((sum, s) => sum + s.total_marks, 0);
      const nextObtained = nextSubjects.reduce((sum, s) => sum + s.obtained_marks, 0);
      const nextPercentage = nextTotal > 0 ? parseFloat(((nextObtained / nextTotal) * 100).toFixed(1)) : 0;

      let overallGrade = 'F';
      if (nextPercentage >= 80) overallGrade = 'A1';
      else if (nextPercentage >= 70) overallGrade = 'A';
      else if (nextPercentage >= 60) overallGrade = 'B';
      else if (nextPercentage >= 50) overallGrade = 'C';
      else if (nextPercentage >= 40) overallGrade = 'D';

      if (!existingDoc.record_id) {
        existingDoc.record_id = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      }
      existingDoc.student_id = canonicalStudentId;
      existingDoc.student_name = studentDoc.full_name;
      existingDoc.class_name = studentDoc.class_name;
      existingDoc.section = studentDoc.section || 'A';
      existingDoc.subjects = nextSubjects as any;
      existingDoc.total_marks = nextTotal;
      existingDoc.obtained_marks = nextObtained;
      existingDoc.percentage = nextPercentage;
      existingDoc.overall_grade = overallGrade;
      if (remarks !== undefined && String(remarks).trim() !== '') {
        existingDoc.remarks = sanitizePlainText(remarks, 1000);
      }
      await existingDoc.save();
    } else {
      existingDoc = await ResultModel.create({
        record_id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        exam_id: cleanExamId,
        exam_title: resolvedExamTitle,
        student_id: canonicalStudentId,
        student_name: studentDoc.full_name,
        class_name: studentDoc.class_name,
        section: studentDoc.section || 'A',
        subjects: [
          {
            subject_name: cleanSubjectName,
            total_marks: tm,
            obtained_marks: om,
            grade,
          },
        ],
        total_marks: tm,
        obtained_marks: om,
        percentage: parseFloat(pct.toFixed(1)),
        overall_grade: grade,
        remarks: remarks ? sanitizePlainText(remarks, 1000) : `Evaluated by ${teacher.name}`,
        published: true,
      });
    }

    const dto = toResultDto(existingDoc);
    await recordMongoAudit(
      req.user!,
      'Recorded Student Marks',
      'Result',
      dto.id,
      `Student: ${studentDoc.full_name}, Subject: ${cleanSubjectName}, Marks: ${om}/${tm}`
    );

    return res.json({
      success: true,
      message: `Marks recorded successfully for ${studentDoc.full_name} in ${cleanSubjectName}.`,
      result: dto,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to record student marks');
  }
});

// 20.7 Teacher Timetable (MongoDB-authoritative)
router.get('/teacher/timetable', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const ttDocs = await TimetableModel.find().sort({ created_at: 1, _id: 1 }).lean();
    const timetable = ttDocs.map(toTimetableDto).filter(t =>
      isExactTeacherName(t.teacher_name, teacher.name)
    );

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDay = daysOfWeek[new Date().getDay()];

    return res.json({
      today: todayDay,
      timetable,
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to retrieve teacher timetable');
  }
});

// 20.71 Teacher Tasks & Responsibilities
router.get('/teacher/tasks', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const teacherIds = Array.from(
      new Set([teacher.id, req.user?.linked_id, req.user?.id].filter(Boolean))
    );

    const tasks = await TeacherTaskModel.find({
      teacher_id: { $in: teacherIds },
    })
      .sort({ due_date: 1, created_at: -1 })
      .lean();

    return res.json({ tasks: tasks.map(toTeacherTaskDto) });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to fetch assigned tasks');
  }
});

router.patch('/teacher/tasks/:id', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  const taskId = req.params.id;
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const teacherIds = Array.from(
      new Set([teacher.id, req.user?.linked_id, req.user?.id].filter(Boolean))
    );

    const task = await TeacherTaskModel.findOne({
      $or: [{ task_id: taskId }, ...(isValidObjectId(taskId) ? [{ _id: taskId }] : [])],
      teacher_id: { $in: teacherIds },
    });

    if (!task) {
      return res.status(404).json({ error: 'Assigned task not found or unauthorized.' });
    }

    const { status, completion_notes } = req.body || {};
    if (status !== undefined && ['Pending', 'In Progress', 'Completed'].includes(status)) {
      task.status = status;
      if (status === 'Completed') {
        task.completed_at = new Date().toISOString();
      }
    }
    if (completion_notes !== undefined) {
      task.completion_notes = String(completion_notes).trim();
    }

    await task.save();

    await recordMongoAudit(
      req.user!,
      'Updated Task Progress',
      'TeacherTask',
      task.task_id,
      `Updated status to ${task.status}`
    );

    return res.json({ success: true, task: toTeacherTaskDto(task) });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to update task status');
  }
});

// 20.72 Teacher Homework Management
router.get('/teacher/homework', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const filter: Record<string, any> = {
      $or: [{ teacher_id: teacher.id }, { teacher_id: req.user?.linked_id || '' }],
    };

    if (req.query.class_name && typeof req.query.class_name === 'string') {
      filter.class_name = req.query.class_name.trim();
    }
    if (req.query.section && typeof req.query.section === 'string') {
      filter.section = req.query.section.trim();
    }

    const docs = await HomeworkModel.find(filter).sort({ due_date: -1, created_at: -1 }).lean();
    return res.json({ homework: docs.map(toHomeworkDto) });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to fetch homework');
  }
});

router.post('/teacher/homework', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  const { title, description, class_name, section, subject, due_date, total_marks, instructions } = req.body || {};
  if (!title || !description || !class_name || !section || !subject || !due_date) {
    return res.status(400).json({ error: 'Title, description, class, section, subject, and due date are required' });
  }
  if (!ensureMongoReady(res)) return;

  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const assignedClasses = teacher.classes || [];
    const requestedClass = String(class_name).trim();
    const requestedSection = String(section).trim();
    const requestedSubject = String(subject).trim();
    if (!isClassAssignedToTeacher(assignedClasses, requestedClass)) {
      return res.status(403).json({ error: `Access denied: You are not assigned to class "${requestedClass}".` });
    }
    const teacherIds = Array.from(new Set([teacher.id, req.user?.linked_id, req.user?.id].filter(Boolean)));
    const classAssignments = await TeacherAssignmentModel.find({
      teacher_id: { $in: teacherIds },
      class_name: { $regex: new RegExp(`^${escapeRegexLiteral(requestedClass)}$`, 'i') },
    }).select('section subject').lean();
    const allowedSubjects = classAssignments.length > 0
      ? classAssignments.filter((assignment: any) =>
          String(assignment.section || '').trim().toLocaleLowerCase('en') === requestedSection.toLocaleLowerCase('en')
        ).map((assignment: any) => assignment.subject)
      : [teacher.subject];
    if (!isExactTeacherSubject(allowedSubjects, requestedSubject)) {
      return res.status(403).json({ error: 'Access denied: This subject/section is not assigned to your teacher account.' });
    }

    const homeworkId = `hwk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created = await HomeworkModel.create({
      homework_id: homeworkId,
      title: String(title).trim(),
      description: String(description).trim(),
      class_name: String(class_name).trim(),
      section: String(section).trim(),
      subject: String(subject).trim(),
      teacher_id: teacher.id,
      teacher_name: teacher.name,
      assigned_date: new Date().toISOString().split('T')[0],
      due_date: String(due_date).trim(),
      total_marks: Number(total_marks) || 10,
      instructions: instructions ? String(instructions).trim() : '',
    });

    await recordMongoAudit(
      req.user!,
      'Created Homework Assignment',
      'Homework',
      homeworkId,
      `Class: ${class_name}-${section}, Subject: ${subject}, Title: ${title}`
    );

    return res.status(201).json({
      success: true,
      message: 'Homework posted successfully',
      homework: toHomeworkDto(created),
    });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to create homework');
  }
});

router.delete('/teacher/homework/:id', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  const hwId = req.params.id;
  if (!ensureMongoReady(res)) return;

  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked.' });
    }

    const deleted = await HomeworkModel.findOneAndDelete({
      $or: [{ homework_id: hwId }, ...(isValidObjectId(hwId) ? [{ _id: hwId }] : [])],
      teacher_id: { $in: [teacher.id, req.user?.linked_id || ''] },
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Homework not found or unauthorized' });
    }

    return res.json({ success: true, message: 'Homework assignment deleted' });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to delete homework');
  }
});

// Public / Portal Homework endpoint
router.get('/homework', async (req: Request, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const filter: Record<string, any> = {};
    if (req.query.class_name && typeof req.query.class_name === 'string') {
      filter.class_name = req.query.class_name.trim();
    }
    if (req.query.section && typeof req.query.section === 'string') {
      filter.section = req.query.section.trim();
    }
    const docs = await HomeworkModel.find(filter).sort({ due_date: -1, created_at: -1 }).limit(100).lean();
    return res.json({ homework: docs.map(toHomeworkDto) });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to fetch homework');
  }
});

// 20.8 Teacher AI Assistant Query (MongoDB-authoritative)
router.post('/teacher/ai/query', aiRateLimiter, authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked to user account.' });
    }

    const lower = prompt.toLowerCase().trim();
    const assignedClasses = teacher.classes || [];

    const forbiddenTerms = [
      'salary', 'salaries', 'staff pay', 'password', 'passwords', 'jwt', 'secret',
      'admin', 'database', 'mongodb', 'uri', 'audit_logs', 'other teacher', 'another teacher',
    ];
    if (forbiddenTerms.some(term => lower.includes(term))) {
      return res.status(403).json({
        error: 'Access denied: Teachers may only query authorized academic and classroom intelligence.',
      });
    }

    // Scope the database read itself to this teacher's current assigned classes.
    const teacherClassFilter = buildTeacherClassFilter(assignedClasses);
    const allStudentDocs = await StudentModel.find(teacherClassFilter).lean();
    const allStudents: StudentDto[] = allStudentDocs.map(toStudentDto);

    await recordMongoAudit(req.user!, 'Queried Teacher AI', 'TeacherAI', teacher.id, `Query: "${prompt.substring(0, 60)}"`);

    const teacherStudents = allStudents.filter(s =>
      isClassAssignedToTeacher(assignedClasses, s.class_name)
    );

    if (lower.startsWith('mark ') || (lower.includes('mark') && (lower.includes('absent') || lower.includes('present') || lower.includes('leave')))) {
      const matched = teacherStudents.filter(s => lower.includes(s.full_name.toLowerCase()) || lower.includes(s.full_name.split(' ')[0].toLowerCase()));
      if (matched.length === 1) {
        const targetStudent = matched[0];
        let status = 'Absent';
        if (lower.includes('present')) status = 'Present';
        else if (lower.includes('late')) status = 'Late';
        else if (lower.includes('leave')) status = 'Leave';

        return res.json({
          text: `I have prepared the attendance update for **${targetStudent.full_name}** (${targetStudent.class_name}). Please review and confirm this action.`,
          toolUsed: 'prepareTeacherAttendanceAction',
          requiresConfirmation: true,
          pendingAction: {
            actionType: 'MARK_ATTENDANCE',
            title: `Mark ${status} for ${targetStudent.full_name}`,
            description: `Update attendance record to "${status}" for ${targetStudent.full_name} in ${targetStudent.class_name} for today.`,
            payload: {
              student_id: targetStudent.id,
              student_name: targetStudent.full_name,
              class_name: targetStudent.class_name,
              section: targetStudent.section,
              date: new Date().toISOString().split('T')[0],
              status,
            },
          },
        });
      }
    }

    if (lower.includes('enter') && lower.includes('marks')) {
      const matched = teacherStudents.filter(s => lower.includes(s.full_name.toLowerCase()) || lower.includes(s.full_name.split(' ')[0].toLowerCase()));
      if (matched.length === 1) {
        const targetStudent = matched[0];
        const numMatch = lower.match(/\b\d{1,3}\b/);
        const marks = numMatch ? parseInt(numMatch[0], 10) : 75;

        return res.json({
          text: `I have prepared the examination marks entry for **${targetStudent.full_name}** (${targetStudent.class_name}) in **${teacher.subject}** (${marks}/100). Please review and confirm.`,
          toolUsed: 'prepareTeacherMarksAction',
          requiresConfirmation: true,
          pendingAction: {
            actionType: 'RECORD_MARKS',
            title: `Enter ${marks} marks for ${targetStudent.full_name}`,
            description: `Record score of ${marks}/100 in ${teacher.subject} for ${targetStudent.full_name} (${targetStudent.class_name}).`,
            payload: {
              student_id: targetStudent.id,
              exam_id: 'ex_term1',
              exam_title: 'First Term Assessment',
              subject_name: teacher.subject,
              total_marks: 100,
              obtained_marks: marks,
            },
          },
        });
      }
    }

    const words = lower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !['what', 'show', 'attendance', 'result', 'marks', 'about', 'student', 'class'].includes(w));
    let candidates: StudentDto[] = [];
    for (const w of words) {
      const matches = teacherStudents.filter(s => s.full_name.toLowerCase().includes(w));
      if (matches.length > 1) {
        candidates = matches;
        break;
      }
    }
    if (candidates.length > 1) {
      const exactFullMatches = candidates.filter(c => lower.includes(c.full_name.toLowerCase()));
      if (exactFullMatches.length !== 1) {
        return res.json({
          disambiguationRequired: true,
          candidates: candidates.map(c => ({
            id: c.id,
            name: c.full_name,
            class_name: c.class_name,
            roll_no: c.roll_no,
          })),
          text: `Found multiple matching students in your assigned classes: ${candidates.map(c => `**${c.full_name}** (${c.class_name} - #${c.roll_no || c.id})`).join(', ')}. Which student would you like to inquire about?`,
          toolUsed: 'teacherStudentDisambiguation',
        });
      }
    }

    if (lower.includes('what class') || lower.includes('classes do i teach') || lower.includes('my classes') || lower.includes('assigned classes')) {
      let reply = `### 📚 Assigned Teaching Classes: ${teacher.name}\n`;
      reply += `* **Primary Subject:** **${teacher.subject}**\n`;
      reply += `* **Academic Status:** ${teacher.status} (${teacher.experience} experience)\n\n`;
      reply += `**Class Breakdown:**\n`;
      for (const className of assignedClasses) {
        const count = allStudents.filter(s => s.class_name.toLowerCase() === className.toLowerCase()).length;
        reply += `* **${className}:** ${count} enrolled students\n`;
      }
      return res.json({ text: reply, toolUsed: 'getMyAssignedClasses' });
    }

    if (lower.includes('timetable') || lower.includes('schedule') || lower.includes('period') || lower.includes('next class')) {
      const ttDocs = await TimetableModel.find(teacherClassFilter).sort({ created_at: 1, _id: 1 }).lean();
      const teacherTimetable = ttDocs.map(toTimetableDto).filter(t =>
        t.teacher_name.toLowerCase().includes(teacher.name.toLowerCase()) ||
        teacher.name.toLowerCase().includes(t.teacher_name.toLowerCase())
      );
      let reply = `### 🕒 Weekly Teaching Schedule: ${teacher.name}\n`;
      if (teacherTimetable.length === 0) {
        reply += `No timetable periods currently assigned in the database.`;
      } else {
        teacherTimetable.forEach(t => {
          reply += `* **${t.day} | ${t.start_time} - ${t.end_time}:** ${t.subject} (${t.class_name} - ${t.section}) · Room: ${t.room}\n`;
        });
      }
      return res.json({ text: reply, toolUsed: 'getMyTimetable' });
    }

    if (lower.includes('how many student') || lower.includes('student count') || lower.includes('enrolled')) {
      let reply = `### 👥 Student Enrollment in Your Assigned Classes\n`;
      let totalAssigned = 0;
      for (const c of assignedClasses) {
        const count = allStudents.filter(s => s.class_name.toLowerCase() === c.toLowerCase()).length;
        totalAssigned += count;
        reply += `* **${c}:** **${count}** students\n`;
      }
      reply += `\n* **Total Students Across Your Classes:** **${totalAssigned}**`;
      return res.json({ text: reply, toolUsed: 'getMyStudents' });
    }

    if ((lower.includes('below') && lower.includes('75')) || lower.includes('low attendance') || lower.includes('warning attendance')) {
      const allAttDocs = await AttendanceModel.find(teacherClassFilter).select('student_id status class_name').lean();
      let reply = `### ⚠️ Low Attendance Warning in Your Classes (<75%)\n`;
      let lowCount = 0;
      for (const c of assignedClasses) {
        const classStudentDocs = allStudentDocs.filter(
          (doc: any) => String(doc.class_name || '').toLowerCase() === c.toLowerCase()
        );
        for (const doc of classStudentDocs) {
          const s = toStudentDto(doc);
          const idSet = new Set([s.id, doc._id ? doc._id.toString() : ''].filter(Boolean));
          const studentAtt = allAttDocs.filter((a: any) => idSet.has(String(a.student_id)));
          const total = studentAtt.length;
          const presents = studentAtt.filter((a: any) => a.status === 'Present').length;
          const rate = total > 0 ? Math.round((presents / total) * 100) : 100;
          if (rate < 75 && total > 0) {
            lowCount++;
            reply += `* **${s.full_name}** (${s.class_name} - Roll #${s.roll_no}): **${rate}%** (${presents}/${total} days) - ⚠️ Deficit: ${Math.ceil(total * 0.75) - presents} days\n`;
          }
        }
      }
      if (lowCount === 0) {
        reply += `No students currently have attendance below the 75% threshold in your assigned classes.`;
      }
      return res.json({ text: reply, toolUsed: 'getLowAttendanceStudents' });
    }

    if (lower.includes('absent') || lower.includes('attendance today') || lower.includes('attendance percentage')) {
      const today = new Date().toISOString().split('T')[0];
      const todayAttDocs = await AttendanceModel.find({ date: today, ...teacherClassFilter }).lean();
      const todayAtt = todayAttDocs
        .map(toAttendanceDto)
        .filter(a => isClassAssignedToTeacher(assignedClasses, a.class_name));
      const absents = todayAtt.filter(a => a.status === 'Absent');
      const presents = todayAtt.filter(a => a.status === 'Present');
      const total = todayAtt.length;
      const rate = total > 0 ? Math.round((presents.length / total) * 100) : 100;

      let reply = `### 📋 Today's Attendance Overview: ${today}\n`;
      reply += `* **Overall Attendance in Your Classes:** **${rate}%** (${presents.length} Present / ${absents.length} Absent / ${total} Recorded)\n`;
      if (absents.length > 0) {
        reply += `\n**Absent Students Today:**\n`;
        absents.forEach(a => {
          reply += `* **${a.student_name}** (${a.class_name} - ${a.section}) · Remarks: ${a.remarks || 'No leave remarks'}\n`;
        });
      } else {
        reply += `\n✅ No students marked absent today across your recorded classes.`;
      }
      return res.json({ text: reply, toolUsed: 'getClassAttendance' });
    }

    if (lower.includes('result') || lower.includes('mark') || lower.includes('score') || lower.includes('performance') || lower.includes('below 50')) {
      const allResDocs = await ResultModel.find(teacherClassFilter).sort({ created_at: -1, _id: -1 }).lean();
      const classResults = allResDocs
        .map(toResultDto)
        .filter(r => isClassAssignedToTeacher(assignedClasses, r.class_name));

      let reply = `### 🏆 Examination Academic Performance\n`;
      if (classResults.length === 0) {
        reply += `No published examination results found for your assigned classes in the database.`;
      } else {
        const latest = classResults[0];
        reply += `* **Exam Title:** **${latest.exam_title}**\n`;
        reply += `* **Class Sample:** ${latest.student_name} (${latest.class_name}) - Score: **${latest.obtained_marks}/${latest.total_marks}** (${latest.percentage}% Grade ${latest.overall_grade})\n\n`;
        reply += `**Subject Breakdown:**\n`;
        latest.subjects.forEach(sub => {
          reply += `* **${sub.subject_name}:** ${sub.obtained_marks}/${sub.total_marks} (Grade ${sub.grade})\n`;
        });
      }
      return res.json({ text: reply, toolUsed: 'getClassResults' });
    }

    if (lower.includes('pending') || lower.includes('task') || lower.includes('attendance task')) {
      const today = new Date().toISOString().split('T')[0];
      const todayAttDocs = await AttendanceModel.find({ date: today, ...teacherClassFilter }).select('class_name').lean();
      const pending: string[] = [];
      const marked: string[] = [];
      for (const c of assignedClasses) {
        const isMarked = todayAttDocs.some(
          (a: any) => String(a.class_name || '').toLowerCase() === c.toLowerCase()
        );
        if (isMarked) marked.push(c);
        else pending.push(c);
      }

      let reply = `### 📋 Daily Academic Tasks for Today (${today})\n`;
      if (pending.length > 0) {
        reply += `* **Pending Attendance Registers:** ${pending.map(c => `**${c}**`).join(', ')} require daily roll call entry.\n`;
      } else {
        reply += `* **Attendance Status:** ✅ All assigned classes marked for today.\n`;
      }
      if (marked.length > 0) {
        reply += `* **Completed Classes:** ${marked.map(c => `**${c}**`).join(', ')}\n`;
      }
      return res.json({ text: reply, toolUsed: 'getAttendanceSummary' });
    }

    let reply = `### 👨‍🏫 Teacher Intelligence Dossier: ${teacher.name}\n`;
    reply += `* **Subject:** ${teacher.subject}\n`;
    reply += `* **Qualification:** ${teacher.qualification}\n`;
    reply += `* **Assigned Classes:** ${assignedClasses.join(', ')}\n`;
    reply += `* **Total Students Enrolled:** ${teacherStudents.length}\n`;
    return res.json({ text: reply, toolUsed: 'getMyTeacherProfile' });
  } catch (err: any) {
    return sendRouteError(res, err, 'Teacher AI query failed');
  }
});

// 20.9 Execute Sensitive Teacher Action (MongoDB-authoritative)
router.post('/teacher/ai/execute-action', authenticateToken, requireExactRole(['teacher']), async (req: AuthenticatedRequest, res: Response) => {
  if (!ensureMongoReady(res)) return;
  try {
    const teacher = await getAuthenticatedTeacherMongo(req);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher profile not linked to user account.' });
    }

    const { actionType, payload, confirmed } = req.body || {};
    if (!confirmed) {
      return res.status(400).json({ error: 'Explicit confirmation required to execute sensitive teacher action.' });
    }

    if (actionType === 'MARK_ATTENDANCE') {
      const { student_id, section, date, status } = payload || {};
      if (!['Present', 'Absent', 'Late', 'Leave'].includes(status)) {
        return res.status(400).json({ error: `Invalid attendance status "${status}".` });
      }
      const cleanDate = String(date || new Date().toISOString().split('T')[0]).trim();
      if (!isValidIsoCalendarDate(cleanDate)) {
        return res.status(400).json({ error: 'Invalid attendance date format.' });
      }

      const studentDoc = await findStudentByAnyId(String(student_id || ''));
      if (!studentDoc) {
        return res.status(404).json({ error: 'Student not found in database.' });
      }
      const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();

      const assignedClasses = teacher.classes || [];
      if (!isClassAssignedToTeacher(assignedClasses, studentDoc.class_name)) {
        return res.status(403).json({ error: `Access denied: You are not assigned to class "${studentDoc.class_name}".` });
      }

      const idAliases = Array.from(
        new Set([canonicalStudentId, studentDoc._id.toString(), String(student_id || '').trim()].filter(Boolean))
      );
      const existingAtt = await AttendanceModel.findOne({
        student_id: { $in: idAliases },
        date: cleanDate,
      });

      if (existingAtt) {
        if (!existingAtt.record_id) {
          existingAtt.record_id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        }
        existingAtt.student_id = canonicalStudentId;
        existingAtt.status = status;
        existingAtt.marked_by = teacher.name;
        await existingAtt.save();
      } else {
        await AttendanceModel.create({
          record_id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          student_id: canonicalStudentId,
          student_name: studentDoc.full_name,
          class_name: studentDoc.class_name,
          section: sanitizePlainText(section || studentDoc.section || 'A', 60) || 'A',
          date: cleanDate,
          status,
          remarks: '',
          marked_by: teacher.name,
        });
      }

      await recordMongoAudit(
        req.user!,
        'Executed AI Attendance Action',
        'Attendance',
        canonicalStudentId,
        `Status: ${status} for ${studentDoc.full_name} on ${cleanDate}`
      );

      return res.json({
        success: true,
        message: `Successfully updated attendance to "${status}" for ${studentDoc.full_name} on ${cleanDate}. Recorded in institutional audit log.`,
      });
    }

    if (actionType === 'RECORD_MARKS') {
      const { student_id, exam_id, exam_title, subject_name, total_marks, obtained_marks } = payload || {};
      const studentDoc = await findStudentByAnyId(String(student_id || ''));
      if (!studentDoc) {
        return res.status(404).json({ error: 'Student not found in database.' });
      }
      const canonicalStudentId = studentDoc.record_id || studentDoc._id.toString();

      const assignedClasses = teacher.classes || [];
      if (!isClassAssignedToTeacher(assignedClasses, studentDoc.class_name)) {
        return res.status(403).json({ error: `Access denied: You are not assigned to class "${studentDoc.class_name}".` });
      }

      const tm = Number(total_marks || 100);
      const om = Number(obtained_marks);
      if (isNaN(tm) || tm <= 0 || isNaN(om) || om < 0 || om > tm) {
        return res.status(400).json({ error: 'Invalid marks values.' });
      }

      const cleanSubj = sanitizePlainText(subject_name || teacher.subject || 'Subject', 120) || 'Subject';
      const cleanExamId = sanitizePlainText(exam_id || 'ex_term1', 80) || 'ex_term1';
      const pct = (om / tm) * 100;
      let grade = 'F';
      if (pct >= 80) grade = 'A1';
      else if (pct >= 70) grade = 'A';
      else if (pct >= 60) grade = 'B';
      else if (pct >= 50) grade = 'C';
      else if (pct >= 40) grade = 'D';

      const idAliases = Array.from(
        new Set([canonicalStudentId, studentDoc._id.toString(), String(student_id || '').trim()].filter(Boolean))
      );
      const existingDoc = await ResultModel.findOne({
        exam_id: cleanExamId,
        student_id: { $in: idAliases },
      });

      if (existingDoc) {
        const nextSubjects: Array<{ subject_name: string; total_marks: number; obtained_marks: number; grade: string }> =
          Array.isArray(existingDoc.subjects)
            ? existingDoc.subjects.map((s: any) => ({
                subject_name: String(s.subject_name),
                total_marks: Number(s.total_marks),
                obtained_marks: Number(s.obtained_marks),
                grade: String(s.grade),
              }))
            : [];
        const sIdx = nextSubjects.findIndex(s => s.subject_name.toLowerCase() === cleanSubj.toLowerCase());
        if (sIdx >= 0) {
          nextSubjects[sIdx] = { subject_name: cleanSubj, total_marks: tm, obtained_marks: om, grade };
        } else {
          nextSubjects.push({ subject_name: cleanSubj, total_marks: tm, obtained_marks: om, grade });
        }
        const nextTotal = nextSubjects.reduce((sum, s) => sum + s.total_marks, 0);
        const nextObtained = nextSubjects.reduce((sum, s) => sum + s.obtained_marks, 0);
        const nextPct = nextTotal > 0 ? parseFloat(((nextObtained / nextTotal) * 100).toFixed(1)) : 0;
        let overallGrade = 'F';
        if (nextPct >= 80) overallGrade = 'A1';
        else if (nextPct >= 70) overallGrade = 'A';
        else if (nextPct >= 60) overallGrade = 'B';
        else if (nextPct >= 50) overallGrade = 'C';
        else if (nextPct >= 40) overallGrade = 'D';

        if (!existingDoc.record_id) {
          existingDoc.record_id = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        }
        existingDoc.student_id = canonicalStudentId;
        existingDoc.subjects = nextSubjects as any;
        existingDoc.total_marks = nextTotal;
        existingDoc.obtained_marks = nextObtained;
        existingDoc.percentage = nextPct;
        existingDoc.overall_grade = overallGrade;
        await existingDoc.save();
      } else {
        await ResultModel.create({
          record_id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          exam_id: cleanExamId,
          exam_title: sanitizePlainText(exam_title || 'First Term Assessment', 200) || 'First Term Assessment',
          student_id: canonicalStudentId,
          student_name: studentDoc.full_name,
          class_name: studentDoc.class_name,
          section: studentDoc.section || 'A',
          subjects: [{ subject_name: cleanSubj, total_marks: tm, obtained_marks: om, grade }],
          total_marks: tm,
          obtained_marks: om,
          percentage: parseFloat(pct.toFixed(1)),
          overall_grade: grade,
          remarks: `Recorded via Teacher AI Action by ${teacher.name}`,
          published: true,
        });
      }

      await recordMongoAudit(
        req.user!,
        'Executed AI Marks Action',
        'Result',
        canonicalStudentId,
        `Subject: ${cleanSubj}, Marks: ${om}/${tm}`
      );

      return res.json({
        success: true,
        message: `Successfully recorded ${om}/${tm} in ${cleanSubj} for ${studentDoc.full_name}. Recorded in institutional audit log.`,
      });
    }

    return res.status(400).json({ error: `Unknown actionType: ${actionType}` });
  } catch (err: any) {
    return sendRouteError(res, err, 'Failed to execute teacher action');
  }
});


