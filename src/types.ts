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

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  created_at: string;
  read: boolean;
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
