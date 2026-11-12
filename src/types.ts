export interface User {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'teacher' | 'parent' | 'student';
  phone?: string;
  avatar?: string;
  linked_id?: string;
  linked_student_ids?: string[];
}

export interface AuditLogEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  target_type: string;
  target_id?: string;
  details?: string;
  timestamp: string;
}

export interface Student {
  id: string;
  admission_no: string;
  full_name: string;
  name?: string;
  father_name: string;
  dob: string;
  gender: 'Male' | 'Female' | 'Other';
  class_name: string;
  section: string;
  contact_no: string;
  address: string;
  emergency_contact: string;
  profile_image?: string;
  admission_date: string;
  academic_status: 'Active' | 'Inactive' | 'Graduated' | 'Suspended';
  roll_no: string;
  parent_user_id?: string;
}

export interface Teacher {
  id: string;
  user_id?: string;
  name: string;
  father_name?: string;
  cnic?: string;
  profile_photo?: string;
  qualification: string;
  subject: string;
  specialization?: string;
  classes: string[];
  contact_no: string;
  email: string;
  joining_date: string;
  experience: string;
  status: 'Active' | 'Pending' | 'On Leave' | 'Resigned' | 'Suspended';
  bio: string;
}

export interface TeacherTask {
  id: string;
  task_id: string;
  title: string;
  description: string;
  teacher_id: string;
  teacher_name: string;
  class_name: string;
  section: string;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  status: 'Pending' | 'In Progress' | 'Completed';
  due_date: string;
  assigned_by: string;
  completion_notes: string;
  completed_at: string;
  created_at: string;
}

export interface HomeworkItem {
  id: string;
  homework_id: string;
  title: string;
  description: string;
  class_name: string;
  section: string;
  subject: string;
  teacher_id: string;
  teacher_name: string;
  assigned_date: string;
  due_date: string;
  total_marks?: number;
  instructions: string;
  created_at: string;
}

export interface TeacherSignupRequest {
  id: string;
  user_id: string;
  teacher_id: string;
  name: string;
  email: string;
  phone: string;
  father_name: string;
  cnic: string;
  qualification: string;
  subject: string;
  specialization: string;
  experience: string;
  bio: string;
  status: string;
  created_at: string;
}

export interface ClassItem {
  id: string;
  name: string;
  grade_level: string;
  stream: string;
  monthly_tuition_fee: number;
  capacity: number;
  class_teacher: string;
}

export interface SubjectItem {
  id: string;
  class_name: string;
  name: string;
  code: string;
  teacher_name: string;
  weekly_periods: number;
}

export interface AdmissionApplication {
  id: string;
  application_no: string;
  student_name: string;
  father_name: string;
  dob: string;
  gender: 'Male' | 'Female' | 'Other';
  class_applying: string;
  previous_school: string;
  parent_phone: string;
  parent_email: string;
  address: string;
  documents: { title: string; filename: string; verified?: boolean }[];
  status: 'Pending' | 'Under Review' | 'Approved' | 'Rejected' | 'Completed';
  remarks?: string;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  date: string;
  status: 'Present' | 'Absent' | 'Late' | 'Leave';
  remarks?: string;
  marked_by?: string;
}

export interface FeeRecord {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  fee_month: string;
  year: number;
  tuition_fee: number;
  admission_fee: number;
  other_charges: number;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  due_date: string;
  status: 'Paid' | 'Unpaid' | 'Partial' | 'Overdue';
  payment_history: {
    receipt_no: string;
    date: string;
    amount: number;
    method: 'Cash' | 'Bank Deposit' | 'Easypaisa / JazzCash' | 'Online Slip';
    notes?: string;
  }[];
}

export interface TimetableEntry {
  id: string;
  class_name: string;
  section: string;
  subject: string;
  teacher_name: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
  start_time: string;
  end_time: string;
  room: string;
}

export interface Exam {
  id: string;
  title: string;
  term: string;
  academic_year: string;
  start_date: string;
  end_date: string;
  classes: string[];
}

export interface ResultRecord {
  id: string;
  exam_id: string;
  exam_title: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  subjects: {
    subject_name: string;
    total_marks: number;
    obtained_marks: number;
    grade: string;
  }[];
  total_marks: number;
  obtained_marks: number;
  percentage: number;
  overall_grade: string;
  remarks: string;
  published: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  category: 'General' | 'Exam' | 'Admission' | 'Holiday' | 'Event' | 'Academic';
  audience: 'All' | 'Students' | 'Teachers' | 'Public';
  date: string;
  priority: 'Normal' | 'High' | 'Urgent';
  author: string;
}

export interface SchoolEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  cover_image: string;
  status: 'Upcoming' | 'Ongoing' | 'Completed';
}

export interface GalleryItem {
  id: string;
  title: string;
  caption: string;
  category: 'Campus' | 'Academics' | 'Sports' | 'Events' | 'Laboratories';
  image_url: string;
  date: string;
}

export type InquiryStatus = 'Pending' | 'Processing' | 'Awaiting Admin Approval' | 'Replied' | 'Resolved';

export interface InquiryReply {
  id?: string;
  sender_type?: 'admin' | 'ai_system' | 'parent';
  sender_id?: string;
  sender_name?: string;
  sent_by?: string;
  sent_at?: string;
  message: string;
  created_at?: string;
  channel?: string;
  sent_via_email?: boolean;
  sent_via_notification?: boolean;
  approved_by_id?: string;
  approved_by_name?: string;
}

export interface ContactMessage {
  id: string;
  reference_no?: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  created_at: string;
  read: boolean;
  replied?: boolean;
  status?: InquiryStatus;
  intent?: string;
  parent_user_id?: string;
  verified_parent_id?: string;
  verified_parent_name?: string;
  verified_student_ids?: string[];
  ai_draft_reply?: string;
  ai_generated_at?: string;
  ai_intent_analysis?: {
    is_fee_inquiry: boolean;
    parent_verified: boolean;
    verification_notes: string;
    student_count: number;
  };
  replies?: InquiryReply[];
  resolved_at?: string;
  resolved_by?: string;
}

export interface SchoolSettings {
  school_name: string;
  short_name: string;
  slogan: string;
  location: string;
  google_maps_code: string;
  google_maps_embed_query: string;
  phone: string;
  alt_phone: string;
  email: string;
  admission_email: string;
  affiliation: string;
  registration_info: string;
  school_timings_summer: string;
  school_timings_winter: string;
  principal_name: string;
  principal_message: string;
  about_text: string;
  mission: string;
  vision: string;
  core_values: string[];
  social_facebook: string;
  social_whatsapp: string;
  hero_badge: string;
  hero_title: string;
  hero_subtitle: string;
  features: { title: string; description: string; icon: string }[];
  academic_levels: { level: string; grades: string; description: string; stream: string }[];
  facilities: { name: string; description: string; image: string }[];
  testimonials: { name: string; role: string; quote: string; year: string }[];
}

export interface MongoServerStatus {
  connected: boolean;
  state: 'connected' | 'connecting' | 'disconnected' | 'error';
  isAtlas: boolean;
  databaseName: string;
  host: string;
  uriMasked: string;
  error?: string;
  latencyMs?: number;
  collectionsCount?: number;
  collections?: { name: string; count: number }[];
  lastChecked: string;
}

export interface SupabaseServerStatus {
  connected: boolean;
  projectId: string;
  url: string;
  authWorking: boolean;
  tablesFound: boolean;
  tableDetails: Record<string, boolean>;
  message: string;
  lastChecked: string;
}

export type PaymentLifecycleStatus =
  | 'Initiated'
  | 'Pending Verification'
  | 'Processing'
  | 'Paid'
  | 'Failed'
  | 'Rejected'
  | 'Refunded';

export type PaymentVerificationStatus = 'Pending' | 'Verified' | 'Rejected';

export interface PaymentTransaction {
  id: string;
  fee_id: string;
  student_id: string;
  payment_reference: string;
  receipt_no: string;
  transaction_id?: string;
  date: string;
  amount: number;
  method: string;
  status: PaymentLifecycleStatus;
  verification_status: PaymentVerificationStatus;
  parent_user_id?: string;
  parent_name?: string;
  parent_phone?: string;
  student_name?: string;
  admission_no?: string;
  class_name?: string;
  fee_month?: string;
  year?: number;
  notes: string;
  received_by: string;
  gateway_provider?: string;
  bank_name?: string;
  account_number?: string;
  deposit_date?: string;
  deposit_slip_ref?: string;
  receipt_attachment_url?: string;
  verified_by_id?: string;
  verified_by_name?: string;
  verified_at?: string;
  rejection_reason?: string;
  sms_status?: string;
  sms_message?: string;
  sms_sent_at?: string;
  created_at?: string;
}

export interface BankAccountSetting {
  bank_name: string;
  account_title: string;
  account_number: string;
  iban: string;
  branch: string;
  active: boolean;
}

export interface MobileWalletSetting {
  provider: 'JazzCash' | 'Easypaisa' | 'Raast';
  account_title: string;
  mobile_number: string;
  active: boolean;
}

export interface PaymentSettings {
  gateways: {
    jazzcash_enabled: boolean;
    easypaisa_enabled: boolean;
    raast_enabled: boolean;
    mode: 'Sandbox' | 'Live';
  };
  bank_accounts: BankAccountSetting[];
  wallets: MobileWalletSetting[];
  policies: {
    allow_partial: boolean;
    min_partial_amount: number;
    late_fee_amount: number;
    late_fee_days_grace: number;
    payment_instructions: string;
  };
  sms: {
    enabled: boolean;
    provider: 'simulated' | 'jazz' | 'telenor' | 'custom';
    template_submission: string;
    template_approved: string;
    template_rejected: string;
  };
}

export interface OutstandingFeeSummary {
  total_outstanding: number;
  current_month_fee: number;
  previous_balance: number;
  late_fee_fine: number;
  next_due_date: string;
  status: 'All Cleared' | 'Partial' | 'Pending Dues' | 'Overdue';
  pending_vouchers_count: number;
}

export interface ExpenseRecord {
  id: string;
  title: string;
  category: 'Utilities' | 'Salaries' | 'Maintenance' | 'Supplies' | 'Transport' | 'Events' | 'Other';
  amount: number;
  expense_date: string;
  payment_method: string;
  reference?: string;
  notes?: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface PayrollRecord {
  id: string;
  staff_id: string;
  staff_name: string;
  designation: string;
  salary_month: number;
  salary_year: number;
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_salary: number;
  paid_amount: number;
  payment_date?: string;
  payment_method?: string;
  notes?: string;
  status: 'Unpaid' | 'Partially Paid' | 'Paid';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface VerifiedFeeCollectionRecord {
  id: string;
  date: string;
  amount: number;
  method: string;
  receipt_no: string;
  student_id: string;
  student_name: string;
  class_name: string;
  fee_month: string;
  year: number | null;
  verification_status: 'Verified';
}
