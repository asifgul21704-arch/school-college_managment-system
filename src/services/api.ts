import {
  User,
  Student,
  Teacher,
  ClassItem,
  SubjectItem,
  AdmissionApplication,
  AttendanceRecord,
  FeeRecord,
  TimetableEntry,
  Exam,
  ResultRecord,
  Announcement,
  SchoolEvent,
  GalleryItem,
  ContactMessage,
  SchoolSettings,
  MongoServerStatus,
  SupabaseServerStatus,
  TeacherTask,
  HomeworkItem,
  TeacherSignupRequest,
} from '../types';

const LEGACY_LOCALSTORAGE_TOKEN_KEY = 'shawan_auth_token';
const EPHEMERAL_FALLBACK_KEY = 'shawan_ephemeral_bearer_fallback';
let memoryFallbackToken: string | null = null;

// Proactively purge any legacy plaintext JWT previously stored in persistent localStorage
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(LEGACY_LOCALSTORAGE_TOKEN_KEY);
  }
} catch {
  // Ignore storage access errors in restricted environments
}

function normalizeApiBaseUrl(raw: unknown): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .replace(/\/+$/, '');
  if (!cleaned) return '';
  if (!/^https?:\/\//i.test(cleaned) && !cleaned.startsWith('/')) {
    return `https://${cleaned}`;
  }
  return cleaned;
}

const RAW_API_BASE = normalizeApiBaseUrl((import.meta as any).env?.VITE_API_BASE_URL);

export function buildApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!RAW_API_BASE) {
    return `/api${cleanEndpoint}`;
  }
  if (RAW_API_BASE.endsWith('/api')) {
    return `${RAW_API_BASE}${cleanEndpoint}`;
  }
  return `${RAW_API_BASE}/api${cleanEndpoint}`;
}

export function resolveBackendUrl(urlPath: string): string {
  if (!urlPath || /^https?:\/\//i.test(urlPath) || urlPath.startsWith('data:')) {
    return urlPath;
  }
  if (!RAW_API_BASE) {
    return urlPath;
  }
  const backendOrigin = RAW_API_BASE.replace(/\/api$/, '');
  return `${backendOrigin}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`;
}

export const getStoredToken = (): string | null => {
  if (memoryFallbackToken) return memoryFallbackToken;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(EPHEMERAL_FALLBACK_KEY);
    }
  } catch {
    // Ignore storage access restrictions
  }
  return null;
};

export const setStoredToken = (token: string): void => {
  memoryFallbackToken = token;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.removeItem(LEGACY_LOCALSTORAGE_TOKEN_KEY);
      window.sessionStorage?.setItem(EPHEMERAL_FALLBACK_KEY, token);
    }
  } catch {
    // Ignore storage access restrictions
  }
};

export const removeStoredToken = (): void => {
  memoryFallbackToken = null;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.removeItem(LEGACY_LOCALSTORAGE_TOKEN_KEY);
      window.sessionStorage?.removeItem(EPHEMERAL_FALLBACK_KEY);
    }
  } catch {
    // Ignore storage access restrictions
  }
};

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const fallbackToken = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (fallbackToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${fallbackToken}`;
  }

  const res = await fetch(buildApiUrl(endpoint), {
    credentials: 'include',
    ...options,
    headers,
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  let data: any = {};
  let parsedJson = false;
  try {
    data = await res.json();
    parsedJson = true;
  } catch {
    data = {};
  }

  if (!res.ok) {
    if (res.status === 401) {
      removeStoredToken();
    }
    const defaultMsg =
      res.status === 404
        ? 'Backend API endpoint not found (HTTP 404). If deployed on Vercel, ensure VITE_API_BASE_URL is set in Vercel to your Railway backend URL.'
        : res.status === 503
        ? 'Institutional database is currently unavailable (HTTP 503).'
        : `Request failed with status ${res.status}`;
    const errorMsg = data?.error || data?.message || defaultMsg;
    const err = new Error(errorMsg) as any;
    err.status = res.status;
    throw err;
  }

  if (!parsedJson || contentType.includes('text/html')) {
    throw new Error(
      'Invalid API response received (expected JSON, received HTML/non-JSON). Please verify VITE_API_BASE_URL points to the backend server.'
    );
  }

  return data as T;
}

/**
 * Prefers the secure HttpOnly session cookie set by the backend.
 * Retains an ephemeral tab-scoped Bearer fallback ONLY when strict cross-origin
 * third-party cookie blocking prevents the browser from sending the HttpOnly cookie.
 */
export async function establishAuthenticatedSession(fallbackToken?: string): Promise<{
  user: User;
  studentProfile?: Student | null;
  teacherProfile?: Teacher | null;
}> {
  removeStoredToken();
  try {
    return await request<{ user: User; studentProfile?: Student | null; teacherProfile?: Teacher | null }>('/auth/me');
  } catch (cookieErr) {
    if (!fallbackToken) {
      throw cookieErr;
    }
    setStoredToken(fallbackToken);
    return await request<{ user: User; studentProfile?: Student | null; teacherProfile?: Teacher | null }>('/auth/me');
  }
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    request<{ message: string }>('/auth/logout', {
      method: 'POST',
    }),

  changePassword: (current_password: string, new_password: string) =>
    request<{ message: string; token: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),

  adminResetPassword: (target: { user_id?: string; email?: string; new_password: string }) =>
    request<{ message: string; user: User }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(target),
    }),

  requestPasswordReset: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  confirmPasswordReset: (data: { token: string; new_password: string; confirm_password: string }) =>
    request<{ message: string }>('/auth/confirm-reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  registerStudent: (data: {
    full_name: string;
    email: string;
    password: string;
    confirm_password: string;
    dob?: string;
    gender?: string;
    father_name: string;
    phone?: string;
    address?: string;
    class_name: string;
    section?: string;
  }) =>
    request<{ token: string; user: User; studentProfile: Student }>('/auth/register-student', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  registerParent: (data: {
    full_name: string;
    email: string;
    password: string;
    confirm_password: string;
    phone?: string;
    address?: string;
    child_admission_no?: string;
    child_dob?: string;
  }) =>
    request<{ token: string; user: User; linked_students: Student[] }>('/auth/register-parent', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  registerTeacher: (data: {
    full_name: string;
    father_name?: string;
    email: string;
    password: string;
    confirm_password: string;
    phone?: string;
    cnic?: string;
    qualification: string;
    subject: string;
    specialization?: string;
    experience?: string;
    bio?: string;
    profile_photo?: string;
  }) =>
    request<{ success: boolean; message: string; teacher?: Teacher }>('/auth/register-teacher', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  linkStudentToParent: (admission_no: string, dob: string) =>
    request<{ message: string; student: Student; linked_students: Student[] }>('/parents/link-student', {
      method: 'POST',
      body: JSON.stringify({ admission_no, dob }),
    }),

  // Redesigned verification & linking methods
  findChildToLink: (data: {
    father_name: string;
    student_name: string;
    class_name: string;
    roll_no: string;
  }) =>
    request<{
      count: number;
      matches: Array<{
        id: string;
        full_name: string;
        class_name: string;
        section: string;
        roll_no: string;
      }>;
    }>('/parents/find-child', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  confirmLinkChild: (data: { student_id: string; father_name?: string }) =>
    request<{
      success: boolean;
      message: string;
      student: Student;
      linked_students: Student[];
    }>('/parents/confirm-link-child', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  unlinkChild: (student_id: string) =>
    request<{
      success: boolean;
      message: string;
      linked_students: Student[];
      active_child_id?: string;
    }>('/parents/unlink-child', {
      method: 'POST',
      body: JSON.stringify({ student_id }),
    }),

  // Admin parent-student relationship management
  getAdminParentLinks: () =>
    request<{
      parents: Array<{
        id: string;
        name: string;
        email: string;
        phone: string;
        linked_students: Student[];
      }>;
      all_students: Array<{
        id: string;
        admission_no: string;
        full_name: string;
        father_name: string;
        class_name: string;
        section: string;
        roll_no: string;
        parent_user_id?: string;
      }>;
    }>('/admin/parent-links'),

  adminLinkParentStudent: (parent_id: string, student_id: string) =>
    request<{ success: boolean; message: string }>('/admin/parent-links/link', {
      method: 'POST',
      body: JSON.stringify({ parent_id, student_id }),
    }),

  adminUnlinkParentStudent: (parent_id: string, student_id: string) =>
    request<{ success: boolean; message: string }>('/admin/parent-links/unlink', {
      method: 'POST',
      body: JSON.stringify({ parent_id, student_id }),
    }),

  getMyStudents: () => request<Student[]>('/parents/my-students'),

  getCurrentUser: () =>
    request<{ user: User; studentProfile?: Student; teacherProfile?: Teacher; linkedStudents?: Student[] }>('/auth/me'),

  // Dashboard Stats
  getDashboardStats: () =>
    request<{
      totalStudents: number;
      totalTeachers: number;
      pendingAdmissions: number;
      approvedAdmissions: number;
      todayMarked: number;
      presentToday: number;
      attendanceRate: number;
      totalPendingFee: number;
      totalCollectedFee: number;
      upcomingEvents: number;
      totalAnnouncements: number;
      unreadMessages: number;
      recentAnnouncements: Announcement[];
      recentAdmissions: AdmissionApplication[];
      recentFees: FeeRecord[];
    }>('/dashboard/stats'),

  // Settings / CMS
  getSettings: () => request<SchoolSettings>('/settings'),
  updateSettings: (settings: Partial<SchoolSettings>) =>
    request<{ message: string; settings: SchoolSettings }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  // Students
  getStudents: (params?: { search?: string; class_name?: string; section?: string; status?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<Student[]>(`/students${query ? `?${query}` : ''}`);
  },
  getStudentById: (id: string) =>
    request<{
      student: Student;
      attendance: AttendanceRecord[];
      fees: FeeRecord[];
      results: ResultRecord[];
      timetable: TimetableEntry[];
    }>(`/students/${id}`),
  createStudent: (student: Partial<Student>) =>
    request<Student>('/students', { method: 'POST', body: JSON.stringify(student) }),
  updateStudent: (id: string, student: Partial<Student>) =>
    request<Student>(`/students/${id}`, { method: 'PUT', body: JSON.stringify(student) }),
  deleteStudent: (id: string) =>
    request<{ message: string; student: Student }>(`/students/${id}`, { method: 'DELETE' }),

  // Teachers
  getTeachers: () => request<Teacher[]>('/teachers'),
  createTeacher: (teacher: Partial<Teacher> & { password?: string }) =>
    request<{ teacher: Teacher; account_created?: boolean; temporary_password?: string }>('/teachers', {
      method: 'POST',
      body: JSON.stringify(teacher),
    }),
  updateTeacher: (id: string, teacher: Partial<Teacher>) =>
    request<Teacher>(`/teachers/${id}`, { method: 'PUT', body: JSON.stringify(teacher) }),
  deleteTeacher: (id: string) =>
    request<{ message: string; teacher: Teacher }>(`/teachers/${id}`, { method: 'DELETE' }),

  // Classes & Subjects
  getClasses: () => request<ClassItem[]>('/classes'),
  createClass: (cls: Partial<ClassItem>) =>
    request<ClassItem>('/classes', { method: 'POST', body: JSON.stringify(cls) }),
  updateClass: (id: string, cls: Partial<ClassItem>) =>
    request<ClassItem>(`/classes/${id}`, { method: 'PUT', body: JSON.stringify(cls) }),
  deleteClass: (id: string) =>
    request<{ message: string; item: ClassItem }>(`/classes/${id}`, { method: 'DELETE' }),

  getSubjects: (className?: string) =>
    request<SubjectItem[]>(`/subjects${className ? `?class_name=${encodeURIComponent(className)}` : ''}`),
  createSubject: (sub: Partial<SubjectItem>) =>
    request<SubjectItem>('/subjects', { method: 'POST', body: JSON.stringify(sub) }),
  updateSubject: (id: string, sub: Partial<SubjectItem>) =>
    request<SubjectItem>(`/subjects/${id}`, { method: 'PUT', body: JSON.stringify(sub) }),
  deleteSubject: (id: string) =>
    request<{ message: string; item: SubjectItem }>(`/subjects/${id}`, { method: 'DELETE' }),

  // Sections
  getSections: (className?: string) =>
    request<any[]>(`/sections${className ? `?class_name=${encodeURIComponent(className)}` : ''}`),
  createSection: (sec: { name: string; class_name: string; capacity?: number; room?: string; teacher_name?: string }) =>
    request<any>('/sections', { method: 'POST', body: JSON.stringify(sec) }),
  updateSection: (id: string, sec: any) =>
    request<any>(`/sections/${id}`, { method: 'PUT', body: JSON.stringify(sec) }),
  deleteSection: (id: string) =>
    request<{ message: string; item: any }>(`/sections/${id}`, { method: 'DELETE' }),

  // Teacher Assignments
  getTeacherAssignments: (params?: { teacher_id?: string; class_name?: string; section?: string; subject?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<any[]>(`/admin/teacher-assignments${query ? `?${query}` : ''}`);
  },
  createTeacherAssignment: (data: { teacher_id: string; class_name: string; section: string; subject: string; academic_session?: string }) =>
    request<any>('/admin/teacher-assignments', { method: 'POST', body: JSON.stringify(data) }),
  deleteTeacherAssignment: (id: string) =>
    request<{ message: string; assignment: any }>(`/admin/teacher-assignments/${id}`, { method: 'DELETE' }),

  // Enrollment Management
  getEnrollments: (params?: { student_id?: string; class_name?: string; section?: string; academic_year?: string; status?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<any[]>(`/admin/enrollments${query ? `?${query}` : ''}`);
  },
  getEnrollmentHistory: (studentId: string) =>
    request<any[]>(`/admin/enrollments/history/${encodeURIComponent(studentId)}`),
  createEnrollment: (data: { student_id: string; class_name: string; section?: string; academic_year?: string; roll_no?: string }) =>
    request<any>('/admin/enrollments', { method: 'POST', body: JSON.stringify(data) }),
  transferEnrollment: (data: { student_id: string; new_class_name: string; new_section?: string; reason?: string; academic_year?: string }) =>
    request<any>('/admin/enrollments/transfer', { method: 'POST', body: JSON.stringify(data) }),

  // Admissions
  applyAdmission: (app: Partial<AdmissionApplication>) =>
    request<{ message: string; application_no: string; application: AdmissionApplication }>('/admissions/apply', {
      method: 'POST',
      body: JSON.stringify(app),
    }),
  trackAdmission: (appNo: string) =>
    request<AdmissionApplication>(`/admissions/track/${encodeURIComponent(appNo)}`),
  getAdmissions: (params?: { status?: string; class_applying?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<AdmissionApplication[]>(`/admissions${query ? `?${query}` : ''}`);
  },
  updateAdmissionStatus: (id: string, status: string, remarks?: string, createStudentRecord?: boolean) =>
    request<{ message: string; application: AdmissionApplication }>(`/admissions/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, remarks, createStudentRecord }),
    }),
  deleteAdmission: (id: string) =>
    request<{ message: string; application: AdmissionApplication }>(`/admissions/${id}`, { method: 'DELETE' }),

  // Attendance
  getAttendance: (params?: { date?: string; class_name?: string; section?: string; student_id?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<AttendanceRecord[]>(`/attendance${query ? `?${query}` : ''}`);
  },
  saveBatchAttendance: (date: string, records: any[]) =>
    request<{ message: string }>('/attendance/batch', {
      method: 'POST',
      body: JSON.stringify({ date, records }),
    }),
  getStudentAttendance: (studentId: string) =>
    request<{
      summary: { total: number; present: number; absent: number; late: number; leave: number; percentage: number };
      records: AttendanceRecord[];
    }>(`/attendance/student/${studentId}`),

  // Fees
  getFees: (params?: { student_id?: string; class_name?: string; status?: string; month?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<FeeRecord[]>(`/fees${query ? `?${query}` : ''}`);
  },
  createFeeVoucher: (fee: Partial<FeeRecord>) =>
    request<FeeRecord>('/fees', { method: 'POST', body: JSON.stringify(fee) }),
  recordFeePayment: (id: string, amount: number, method: string, notes?: string) =>
    request<{ message: string; fee: FeeRecord; receipt_no: string }>(`/fees/${id}/pay`, {
      method: 'PUT',
      body: JSON.stringify({ amount, method, notes }),
    }),
  deleteFee: (id: string) =>
    request<{ message: string; item: FeeRecord }>(`/fees/${id}`, { method: 'DELETE' }),

  // Timetable
  getTimetable: (params?: { class_name?: string; section?: string; day?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<TimetableEntry[]>(`/timetable${query ? `?${query}` : ''}`);
  },
  createTimetableEntry: (entry: Partial<TimetableEntry>) =>
    request<TimetableEntry>('/timetable', { method: 'POST', body: JSON.stringify(entry) }),
  updateTimetableEntry: (id: string, entry: Partial<TimetableEntry>) =>
    request<TimetableEntry>(`/timetable/${id}`, { method: 'PUT', body: JSON.stringify(entry) }),
  deleteTimetableEntry: (id: string) =>
    request<{ message: string; item: TimetableEntry }>(`/timetable/${id}`, { method: 'DELETE' }),

  // Exams & Results
  getExams: () => request<Exam[]>('/exams'),
  createExam: (exam: Partial<Exam>) =>
    request<Exam>('/exams', { method: 'POST', body: JSON.stringify(exam) }),
  updateExam: (id: string, exam: Partial<Exam>) =>
    request<Exam>(`/exams/${id}`, { method: 'PUT', body: JSON.stringify(exam) }),
  deleteExam: (id: string) =>
    request<{ message: string; item: Exam }>(`/exams/${id}`, { method: 'DELETE' }),

  getResults: (params?: { exam_id?: string; student_id?: string; class_name?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<ResultRecord[]>(`/results${query ? `?${query}` : ''}`);
  },
  saveResult: (result: Partial<ResultRecord>) =>
    request<ResultRecord>('/results', { method: 'POST', body: JSON.stringify(result) }),
  deleteResult: (id: string) =>
    request<{ message: string; item: ResultRecord }>(`/results/${id}`, { method: 'DELETE' }),
  togglePublishResult: (id: string, published?: boolean) =>
    request<ResultRecord>(`/results/${id}/publish`, { method: 'PATCH', body: JSON.stringify({ published }) }),

  // Announcements & Events
  getAnnouncements: (params?: { category?: string; audience?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<Announcement[]>(`/announcements${query ? `?${query}` : ''}`);
  },
  createAnnouncement: (ann: Partial<Announcement>) =>
    request<Announcement>('/announcements', { method: 'POST', body: JSON.stringify(ann) }),
  deleteAnnouncement: (id: string) =>
    request<{ message: string; item: Announcement }>(`/announcements/${id}`, { method: 'DELETE' }),

  getEvents: () => request<SchoolEvent[]>('/events'),
  createEvent: (ev: Partial<SchoolEvent>) =>
    request<SchoolEvent>('/events', { method: 'POST', body: JSON.stringify(ev) }),
  updateEvent: (id: string, ev: Partial<SchoolEvent>) =>
    request<SchoolEvent>(`/events/${id}`, { method: 'PUT', body: JSON.stringify(ev) }),
  deleteEvent: (id: string) =>
    request<{ message: string; item: SchoolEvent }>(`/events/${id}`, { method: 'DELETE' }),

  // Gallery
  getGallery: (category?: string) =>
    request<GalleryItem[]>(`/gallery${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  createGalleryItem: (item: Partial<GalleryItem>) =>
    request<GalleryItem>('/gallery', { method: 'POST', body: JSON.stringify(item) }),
  updateGalleryItem: (id: string, item: Partial<GalleryItem>) =>
    request<GalleryItem>(`/gallery/${id}`, { method: 'PUT', body: JSON.stringify(item) }),
  deleteGalleryItem: (id: string) =>
    request<{ message: string; item: GalleryItem }>(`/gallery/${id}`, { method: 'DELETE' }),

  // Contact
  sendContactMessage: (msg: { name: string; email: string; phone: string; subject: string; message: string }) =>
    request<{ message: string; inquiry: ContactMessage }>('/contact', { method: 'POST', body: JSON.stringify(msg) }),
  getContactMessages: () => request<ContactMessage[]>('/contact'),
  markContactRead: (id: string) => request<ContactMessage>(`/contact/${id}/read`, { method: 'PUT' }),

  // Users & Audits
  getUsers: () => request<User[]>('/users'),
  createUser: (user: any) => request<User>('/users', { method: 'POST', body: JSON.stringify(user) }),
  getAuditLogs: () => request<any[]>('/audit-logs'),

  // Upload
  uploadFile: async (dataUrl: string, filename: string) => {
    const uploaded = await request<{ url: string; filename: string; size: number; mimeType: string }>('/upload', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, filename }),
    });
    return {
      ...uploaded,
      url: resolveBackendUrl(uploaded.url),
    };
  },

  // MongoDB Atlas Backend Management
  getMongoStatus: () => request<MongoServerStatus>('/mongodb/status'),
  syncAllToMongo: () =>
    request<{ success: boolean; message: string; summary: Record<string, number> }>('/mongodb/sync-all', {
      method: 'POST',
    }),
  testMongoConnection: () =>
    request<{ success: boolean; latencyMs: number; databaseName: string; message: string }>('/mongodb/test-connection'),
  getMongoCollections: () =>
    request<{ name: string; count: number; type: string }[]>('/mongodb/collections'),

  // Legacy Supabase Compatibility Shim (points to live database status)
  getSupabaseStatus: () => request<any>('/mongodb/status'),
  syncAllToSupabase: () =>
    request<{ success: boolean; message: string; summary: Record<string, number> }>('/mongodb/sync-all', {
      method: 'POST',
    }),
  getSupabaseSchema: async (): Promise<string> => {
    return '-- Migrated to MongoDB Atlas Mongoose Collections (users, students, teachers, parents, classes, etc.)';
  },
  getParents: () => request<any[]>('/parents'),

  // Admin-Only AI Assistant
  queryAdminAi: (
    prompt: string,
    contextOptions?: {
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
  ) =>
    request<{
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
        provider: string;
        model?: string;
        message?: string;
      };
    }>('/admin/ai/query', {
      method: 'POST',
      body: JSON.stringify({ prompt, ...(contextOptions || {}) }),
    }),
  getAdminAiStatus: () =>
    request<{
      configured: boolean;
      verified: boolean;
      provider: string;
      model?: string;
      message?: string;
    }>('/admin/ai/status'),
  executeAdminAiAction: (actionType: string, payload: any, confirmed: boolean) =>
    request<{
      success: boolean;
      message: string;
      dispatchedCount?: number;
      auditLogId?: string;
    }>('/admin/ai/execute-action', {
      method: 'POST',
      body: JSON.stringify({ actionType, payload, confirmed }),
    }),
  getAdminAiAuditLogs: () => request<any[]>('/admin/ai/audit-logs'),
  getAdminAiSamplePrompts: () =>
    request<{
      categories: {
        title: string;
        prompts: string[];
      }[];
    }>('/admin/ai/sample-prompts'),

  // Student & Parent Portal AI
  queryPortalAi: (prompt: string) =>
    request<{
      text: string;
      toolUsed?: string;
      disambiguationRequired?: boolean;
      candidates?: Array<{ id: string; name: string; class_name: string; roll_no: string }>;
    }>('/portal/ai/query', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  // Real MongoDB Notifications System
  getNotifications: () => request<any[]>('/notifications'),
  getUnreadNotificationCount: () => request<{ unreadCount: number }>('/notifications/unread-count'),
  markNotificationRead: (id: string) =>
    request<any>(`/notifications/${id}/read`, {
      method: 'PUT',
    }),
  markAllNotificationsRead: () =>
    request<{ message: string }>('/notifications/mark-all-read', {
      method: 'PUT',
    }),

  // ==========================================
  // Teacher Portal & Academic Management (Phase 5)
  // ==========================================
  getTeacherDashboard: () =>
    request<{
      teacher: Teacher;
      assignedClasses: string[];
      totalClasses: number;
      totalStudents: number;
      todayTimetable: TimetableEntry[];
      timetableCount: number;
      attendanceStatus: {
        date: string;
        markedToday: boolean;
        markedClasses: string[];
        pendingClasses: string[];
      };
      recentAnnouncements: Announcement[];
      recentActivity: {
        attendance: AttendanceRecord[];
        results: ResultRecord[];
      };
      assignments?: any[];
      isClassTeacher?: boolean;
      classTeacherAssignments?: any[];
      tasks?: TeacherTask[];
      pendingTasksCount?: number;
      unreadNotifsCount?: number;
    }>('/teacher/dashboard'),

  getTeacherProfile: () => request<Teacher>('/teacher/profile'),

  updateTeacherProfile: (profile: Partial<Teacher>) =>
    request<{ message: string; teacher: Teacher }>('/teacher/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    }),

  getTeacherClasses: () =>
    request<
      Array<{
        class_name: string;
        grade_level: string;
        stream: string;
        student_count: number;
        sections: string[];
        subject: string;
        todayAttendanceMarked: boolean;
      }>
    >('/teacher/classes'),

  getTeacherStudents: (params?: { class_name?: string; section?: string; search?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<
      Array<
        Student & {
          attendance_percentage: number;
          total_days: number;
          presents: number;
        }
      >
    >(`/teacher/students${query ? `?${query}` : ''}`);
  },

  getTeacherAttendance: (params?: {
    class_name?: string;
    section?: string;
    date?: string;
    filter?: string;
    start_date?: string;
    end_date?: string;
  }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<{
      summary: {
        total: number;
        present: number;
        absent: number;
        late: number;
        leave: number;
        percentage: number;
      };
      records: AttendanceRecord[];
    }>(`/teacher/attendance${query ? `?${query}` : ''}`);
  },

  saveTeacherAttendance: (data: {
    date: string;
    class_name: string;
    section: string;
    records: Array<{
      student_id: string;
      student_name?: string;
      status: 'Present' | 'Absent' | 'Late' | 'Leave';
      remarks?: string;
    }>;
  }) =>
    request<{ success: boolean; message: string; count: number }>('/teacher/attendance', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTeacherExams: () => request<Exam[]>('/teacher/exams'),

  getTeacherResults: (params?: { exam_id?: string; class_name?: string; subject?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<{
      summary: {
        totalStudentsTested: number;
        averagePercentage: number;
        highestScore: number;
        lowestScore: number;
        passCount: number;
        failCount: number;
      };
      results: ResultRecord[];
    }>(`/teacher/results${query ? `?${query}` : ''}`);
  },

  saveTeacherResults: (data: {
    exam_id: string;
    exam_title?: string;
    student_id: string;
    subject_name: string;
    total_marks: number;
    obtained_marks: number;
    remarks?: string;
  }) =>
    request<{ success: boolean; message: string; result: ResultRecord }>('/teacher/results', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTeacherTimetable: () =>
    request<{
      today: string;
      timetable: TimetableEntry[];
    }>('/teacher/timetable'),

  queryTeacherAi: (prompt: string) =>
    request<{
      text: string;
      toolUsed?: string;
      disambiguationRequired?: boolean;
      candidates?: Array<{ id: string; name: string; class_name: string; roll_no: string }>;
      requiresConfirmation?: boolean;
      pendingAction?: {
        actionType: string;
        title: string;
        description: string;
        payload: any;
      };
    }>('/teacher/ai/query', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  executeTeacherAiAction: (actionType: string, payload: any, confirmed: boolean) =>
    request<{ success: boolean; message: string }>('/teacher/ai/execute-action', {
      method: 'POST',
      body: JSON.stringify({ actionType, payload, confirmed }),
    }),

  // Admin Teacher Approval Requests
  getTeacherRequests: () =>
    request<{ requests: TeacherSignupRequest[] }>('/admin/teacher-requests'),

  approveTeacherRequest: (
    id: string,
    data?: {
      classes?: string[];
      subject?: string;
      employment_status?: 'Active' | 'On Leave' | 'Suspended';
      assignments?: Array<{ class_name: string; section: string; subject: string; is_class_teacher?: boolean }>;
      is_class_teacher?: boolean;
      class_teacher_for?: { class_name: string; section: string };
    }
  ) =>
    request<{ success: boolean; message: string; teacher: Teacher }>(`/admin/teacher-requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  rejectTeacherRequest: (id: string, data?: { reason?: string }) =>
    request<{ success: boolean; message: string }>(`/admin/teacher-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  // Admin & Teacher Tasks Management
  getAdminTeacherTasks: (params?: { teacher_id?: string; status?: string }) => {
    const query = new URLSearchParams(params as any).toString();
    return request<{ tasks: TeacherTask[] }>(`/admin/teacher-tasks${query ? `?${query}` : ''}`);
  },

  createAdminTeacherTask: (data: {
    title: string;
    description?: string;
    teacher_id: string;
    class_name?: string;
    section?: string;
    priority?: 'Low' | 'Medium' | 'High' | 'Urgent';
    due_date: string;
  }) =>
    request<{ success: boolean; message: string; task: TeacherTask }>('/admin/teacher-tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAdminTeacherTask: (id: string, data: Partial<TeacherTask>) =>
    request<{ success: boolean; task: TeacherTask }>(`/admin/teacher-tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteAdminTeacherTask: (id: string) =>
    request<{ success: boolean; message: string }>(`/admin/teacher-tasks/${id}`, {
      method: 'DELETE',
    }),

  getTeacherTasks: () =>
    request<{ tasks: TeacherTask[] }>('/teacher/tasks'),

  updateTeacherTask: (
    id: string,
    data: { status?: 'Pending' | 'In Progress' | 'Completed'; completion_notes?: string }
  ) =>
    request<{ success: boolean; task: TeacherTask }>(`/teacher/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Teacher Homework Management
  getTeacherHomework: (params?: { class_name?: string; section?: string }) => {
    const query = new URLSearchParams(params as any).toString();
    return request<{ homework: HomeworkItem[] }>(`/teacher/homework${query ? `?${query}` : ''}`);
  },

  createTeacherHomework: (data: {
    title: string;
    description: string;
    class_name: string;
    section: string;
    subject: string;
    due_date: string;
    total_marks?: number;
    instructions?: string;
  }) =>
    request<{ success: boolean; message: string; homework: HomeworkItem }>('/teacher/homework', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteTeacherHomework: (id: string) =>
    request<{ success: boolean; message: string }>(`/teacher/homework/${id}`, {
      method: 'DELETE',
    }),

  getPublicHomework: (params?: { class_name?: string; section?: string }) => {
    const query = new URLSearchParams(params as any).toString();
    return request<{ homework: HomeworkItem[] }>(`/homework${query ? `?${query}` : ''}`);
  },
};

