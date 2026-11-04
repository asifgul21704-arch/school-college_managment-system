import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AuditLogModel } from './models/AuditLog.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE_PATH
  ? path.resolve(process.env.DB_FILE_PATH)
  : path.resolve(DATA_DIR, 'db.json');

export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: 'super_admin' | 'admin' | 'teacher' | 'parent' | 'student';
  phone?: string;
  avatar?: string;
  linked_id?: string; // student_id or teacher_id
  linked_student_ids?: string[]; // for parent accounts linked to multiple children
  created_at: string;
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
  name: string;
  profile_photo?: string;
  qualification: string;
  subject: string;
  classes: string[];
  contact_no: string;
  email: string;
  joining_date: string;
  experience: string;
  status: 'Active' | 'On Leave' | 'Resigned';
  bio: string;
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
  status?: 'Active' | 'Inactive';
}

export interface SectionItem {
  id: string;
  name: string;
  class_name: string;
  capacity: number;
  room: string;
  teacher_name: string;
}

export interface EnrollmentItem {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  academic_year: string;
  roll_no: string;
  enrollment_date: string;
  status: 'Active' | 'Transferred' | 'Completed' | 'Dropped';
}

export interface TeacherAssignmentItem {
  id: string;
  teacher_id: string;
  teacher_name: string;
  class_name: string;
  section: string;
  subject: string;
  academic_session: string;
  assigned_date: string;
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
  date: string; // YYYY-MM-DD
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
    method: 'Cash' | 'Bank Deposit' | 'Bank Transfer' | 'Easypaisa / JazzCash' | 'Online Slip';
    transaction_id?: string;
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

export interface DatabaseSchema {
  users: User[];
  students: Student[];
  teachers: Teacher[];
  classes: ClassItem[];
  subjects: SubjectItem[];
  sections: SectionItem[];
  enrollments: EnrollmentItem[];
  teacher_assignments: TeacherAssignmentItem[];
  admissions: AdmissionApplication[];
  attendance: AttendanceRecord[];
  fees: FeeRecord[];
  timetable: TimetableEntry[];
  exams: Exam[];
  results: ResultRecord[];
  announcements: Announcement[];
  events: SchoolEvent[];
  gallery: GalleryItem[];
  contact_messages: ContactMessage[];
  settings: SchoolSettings;
  audit_logs: AuditLogEntry[];
}

class Database {
  private data: DatabaseSchema;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        if (!this.data.audit_logs) {
          this.data.audit_logs = [];
        }
        if (!this.data.sections) {
          this.data.sections = [
            { id: 'sec_01', name: 'A', class_name: 'Grade 9 - Matric', capacity: 40, room: 'Room 10', teacher_name: 'Prof. Tariq Mahmood' },
            { id: 'sec_02', name: 'B', class_name: 'Grade 9 - Matric', capacity: 40, room: 'Room 11', teacher_name: 'Sir Muhammad Naveed' },
            { id: 'sec_03', name: 'A', class_name: 'Grade 10 - Matric', capacity: 40, room: 'Room 12', teacher_name: 'Prof. Tariq Mahmood' },
            { id: 'sec_04', name: 'B', class_name: 'Grade 10 - Matric', capacity: 40, room: 'Room 13', teacher_name: 'Sir Rashid Khan' },
          ];
        }
        if (!this.data.enrollments) {
          this.data.enrollments = (this.data.students || []).map(s => ({
            id: `enr_${s.id}`,
            student_id: s.id,
            student_name: s.full_name,
            class_name: s.class_name,
            section: s.section || 'A',
            academic_year: '2026-2027',
            roll_no: s.roll_no || '',
            enrollment_date: s.admission_date || new Date().toISOString().split('T')[0],
            status: 'Active' as const,
          }));
        }
        if (!this.data.teacher_assignments) {
          this.data.teacher_assignments = [
            {
              id: 'asg_01',
              teacher_id: 'tch_01',
              teacher_name: 'Prof. Tariq Mahmood',
              class_name: 'Grade 9 - Matric',
              section: 'A',
              subject: 'Physics',
              academic_session: '2026-2027',
              assigned_date: '2026-08-15',
            },
            {
              id: 'asg_02',
              teacher_id: 'tch_01',
              teacher_name: 'Prof. Tariq Mahmood',
              class_name: 'Grade 10 - Matric',
              section: 'A',
              subject: 'Physics',
              academic_session: '2026-2027',
              assigned_date: '2026-08-15',
            },
          ];
        }
      } catch (err) {
        console.error('Error reading db.json, initializing fresh db:', err);
        this.data = this.createInitialData();
        this.save();
      }
    } else {
      this.data = this.createInitialData();
      this.save();
    }
  }

  public getData(): DatabaseSchema {
    return this.data;
  }

  public logAudit(user: { id: string; name: string; role: string }, action: string, target_type: string, target_id?: string, details?: string): void {
    if (!this.data.audit_logs) {
      this.data.audit_logs = [];
    }
    const timestamp = new Date().toISOString();
    this.data.audit_logs.unshift({
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      user_id: user.id,
      user_name: user.name,
      user_role: user.role,
      action,
      target_type,
      target_id,
      details,
      timestamp,
    });
    if (this.data.audit_logs.length > 500) {
      this.data.audit_logs = this.data.audit_logs.slice(0, 500);
    }
    this.save();

    if (mongoose.connection.readyState === 1) {
      AuditLogModel.create({
        user_id: user.id || 'system',
        user_name: user.name || 'System',
        user_role: user.role || 'admin',
        action,
        target_type,
        target_id: target_id || '',
        details: details || '',
        timestamp,
      }).catch(() => {});
    }
  }

  public save(): void {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  }

  private createInitialData(): DatabaseSchema {
    const salt = bcrypt.genSaltSync(10);
    const adminHash = bcrypt.hashSync('AdminPassword123!', salt);
    const teacherHash = bcrypt.hashSync('TeacherPassword123!', salt);
    const studentHash = bcrypt.hashSync('StudentPassword123!', salt);

    return {
      users: [
        {
          id: 'usr_super_admin',
          email: 'admin@shawanschool.edu.pk',
          password_hash: adminHash,
          name: 'Principal & Chief Administrator',
          role: 'super_admin',
          phone: '+92 300 1234567',
          created_at: '2026-01-10T08:00:00.000Z',
        },
        {
          id: 'usr_admin',
          email: 'office@shawanschool.edu.pk',
          password_hash: adminHash,
          name: 'Academic Affairs Officer',
          role: 'admin',
          phone: '+92 300 7654321',
          created_at: '2026-01-10T08:00:00.000Z',
        },
        {
          id: 'usr_teacher_1',
          email: 'teacher@shawanschool.edu.pk',
          password_hash: teacherHash,
          name: 'Prof. Tariq Mahmood (M.Sc Physics)',
          role: 'teacher',
          phone: '+92 312 9876543',
          linked_id: 'tch_01',
          created_at: '2026-01-15T08:00:00.000Z',
        },
        {
          id: 'usr_student_1',
          email: 'student@shawanschool.edu.pk',
          password_hash: studentHash,
          name: 'Muhammad Hamza',
          role: 'student',
          phone: '+92 333 1122334',
          linked_id: 'std_01',
          created_at: '2026-02-01T08:00:00.000Z',
        },
        {
          id: 'usr_parent_1',
          email: 'parent@shawanschool.edu.pk',
          password_hash: studentHash,
          name: 'Haji Ghulam Rasool (Parent)',
          role: 'parent',
          phone: '+92 333 1122334',
          linked_id: 'std_01',
          created_at: '2026-02-01T08:00:00.000Z',
        },
      ],
      students: [
        {
          id: 'std_01',
          admission_no: 'SSC-2026-001',
          full_name: 'Muhammad Hamza',
          father_name: 'Haji Ghulam Rasool',
          dob: '2009-04-14',
          gender: 'Male',
          class_name: 'Grade 10 - Matric',
          section: 'A (Science)',
          contact_no: '+92 333 1122334',
          address: 'Rangpur Road, Mohallah Eidgah, Paharpur, DI Khan',
          emergency_contact: '+92 301 5566778',
          admission_date: '2024-04-01',
          academic_status: 'Active',
          roll_no: '101',
          parent_user_id: 'usr_parent_1',
        },
        {
          id: 'std_02',
          admission_no: 'SSC-2026-002',
          full_name: 'Ayesha Noor',
          father_name: 'Muhammad Aslam Khan',
          dob: '2010-09-22',
          gender: 'Female',
          class_name: 'Grade 9 - Matric',
          section: 'A (Biology)',
          contact_no: '+92 345 9988776',
          address: 'Main Bazaar Road, Near Tehsil Gate, Paharpur',
          emergency_contact: '+92 345 9988770',
          admission_date: '2025-04-05',
          academic_status: 'Active',
          roll_no: '902',
        },
        {
          id: 'std_03',
          admission_no: 'SSC-2026-003',
          full_name: 'Zubair Ahmad',
          father_name: 'Sher Zaman',
          dob: '2008-01-18',
          gender: 'Male',
          class_name: '1st Year (F.Sc Pre-Medical)',
          section: 'Medical-A',
          contact_no: '+92 315 4433221',
          address: 'Chashma Right Bank Canal Colony, Paharpur',
          emergency_contact: '+92 315 4433229',
          admission_date: '2025-08-10',
          academic_status: 'Active',
          roll_no: '1105',
        },
        {
          id: 'std_04',
          admission_no: 'SSC-2026-004',
          full_name: 'Fatima Bibi',
          father_name: 'Inam Ullah',
          dob: '2008-06-30',
          gender: 'Female',
          class_name: '2nd Year (ICS Computer Science)',
          section: 'ICS-A',
          contact_no: '+92 302 7788990',
          address: 'Band Kurai Road, Paharpur, DI Khan',
          emergency_contact: '+92 302 7788991',
          admission_date: '2024-08-12',
          academic_status: 'Active',
          roll_no: '1201',
        },
        {
          id: 'std_05',
          admission_no: 'SSC-2026-005',
          full_name: 'Bilal Khan',
          father_name: 'Qaiser Khan',
          dob: '2012-11-05',
          gender: 'Male',
          class_name: 'Grade 7 - Middle',
          section: 'B',
          contact_no: '+92 306 1239874',
          address: 'Rangpur Road, Paharpur',
          emergency_contact: '+92 306 1239870',
          admission_date: '2023-04-10',
          academic_status: 'Active',
          roll_no: '708',
        },
      ],
      teachers: [
        {
          id: 'tch_01',
          name: 'Prof. Tariq Mahmood',
          qualification: 'M.Sc Physics (Gomal University DI Khan)',
          subject: 'Physics & Applied Science',
          classes: ['Grade 9 - Matric', 'Grade 10 - Matric', '1st Year F.Sc', '2nd Year F.Sc'],
          contact_no: '+92 312 9876543',
          email: 'tariq.physics@shawanschool.edu.pk',
          joining_date: '2021-03-01',
          experience: '9 Years in SSC & HSSC Teaching',
          status: 'Active',
          bio: 'Specialist in conceptual physics and board examination preparation with a track record of high BISE distinction holders.',
        },
        {
          id: 'tch_02',
          name: 'Ma’am Saima Parveen',
          qualification: 'M.Phil Botany / M.Ed',
          subject: 'Biology & Environmental Sciences',
          classes: ['Grade 9 - Matric', 'Grade 10 - Matric', '1st Year (Pre-Medical)'],
          contact_no: '+92 303 5544332',
          email: 'saima.bio@shawanschool.edu.pk',
          joining_date: '2022-04-15',
          experience: '7 Years in Senior Secondary Education',
          status: 'Active',
          bio: 'Dedicated botany and biology educator with hands-on lab experimentation methodology and modern visual learning techniques.',
        },
        {
          id: 'tch_03',
          name: 'Sir Muhammad Naveed',
          qualification: 'M.Sc Mathematics (QAU Islamabad)',
          subject: 'Mathematics & Statistics',
          classes: ['Grade 8', 'Grade 9 - Matric', 'Grade 10 - Matric', '1st Year Pre-Eng'],
          contact_no: '+92 344 6677889',
          email: 'naveed.math@shawanschool.edu.pk',
          joining_date: '2020-09-01',
          experience: '11 Years in Secondary Mathematics',
          status: 'Active',
          bio: 'Passionate mathematician focusing on building strong analytical reasoning, algebra foundations, and calculus problem-solving.',
        },
        {
          id: 'tch_04',
          name: 'Engr. Kashif Rehman',
          qualification: 'BS Computer Science & Software Engineering',
          subject: 'Computer Science & ICT',
          classes: ['Grade 6 to 10', 'ICS 1st Year', 'ICS 2nd Year'],
          contact_no: '+92 301 2233445',
          email: 'kashif.cs@shawanschool.edu.pk',
          joining_date: '2023-01-10',
          experience: '5 Years in Tech & Coding Instruction',
          status: 'Active',
          bio: 'Oversees the digital computer laboratory, C++ programming syllabus, database fundamentals, and cyber safety for collegiate students.',
        },
        {
          id: 'tch_05',
          name: 'Qari Abdul Rauf',
          qualification: 'M.A Islamic Studies & Dars-e-Nizami (Wafaq)',
          subject: 'Islamiyat, Quranic Translation & Ethics',
          classes: ['Primary', 'Middle', 'Secondary'],
          contact_no: '+92 333 8899001',
          email: 'rauf.islamiyat@shawanschool.edu.pk',
          joining_date: '2019-08-15',
          experience: '14 Years in Moral & Islamic Pedagogy',
          status: 'Active',
          bio: 'Responsible for moral tarbiyah, Tajweed recitation, Nazra Quran, and Islamic ethical foundation for all age cohorts.',
        },
      ],
      classes: [
        {
          id: 'cls_01',
          name: 'Playgroup & Nursery',
          grade_level: 'Early Childhood Education',
          stream: 'General Activity-Based',
          monthly_tuition_fee: 1800,
          capacity: 30,
          class_teacher: 'Ms. Farzana Bibi',
        },
        {
          id: 'cls_02',
          name: 'Grade 1 to 5 (Primary)',
          grade_level: 'Primary Schooling',
          stream: 'National Single Curriculum (SNC)',
          monthly_tuition_fee: 2200,
          capacity: 35,
          class_teacher: 'Ms. Rubina Kausar',
        },
        {
          id: 'cls_03',
          name: 'Grade 6 to 8 (Middle)',
          grade_level: 'Middle Schooling',
          stream: 'Science & Arts Foundation',
          monthly_tuition_fee: 2600,
          capacity: 40,
          class_teacher: 'Sir Muhammad Naveed',
        },
        {
          id: 'cls_04',
          name: 'Grade 9 - Matric',
          grade_level: 'Secondary School Certificate (Part I)',
          stream: 'Science (Bio/Computer Groups)',
          monthly_tuition_fee: 3200,
          capacity: 45,
          class_teacher: 'Ma’am Saima Parveen',
        },
        {
          id: 'cls_05',
          name: 'Grade 10 - Matric',
          grade_level: 'Secondary School Certificate (Part II)',
          stream: 'Science (Bio/Computer Groups)',
          monthly_tuition_fee: 3400,
          capacity: 45,
          class_teacher: 'Prof. Tariq Mahmood',
        },
        {
          id: 'cls_06',
          name: '1st Year (F.Sc Pre-Medical)',
          grade_level: 'HSSC Part I (College Level)',
          stream: 'Pre-Medical (BISE DI Khan)',
          monthly_tuition_fee: 4200,
          capacity: 40,
          class_teacher: 'Prof. Tariq Mahmood',
        },
        {
          id: 'cls_07',
          name: '1st Year (F.Sc Pre-Engineering)',
          grade_level: 'HSSC Part I (College Level)',
          stream: 'Pre-Engineering (BISE DI Khan)',
          monthly_tuition_fee: 4200,
          capacity: 40,
          class_teacher: 'Sir Muhammad Naveed',
        },
        {
          id: 'cls_08',
          name: 'ICS (Intermediate in Computer Science)',
          grade_level: 'HSSC Part I & II (College Level)',
          stream: 'Computer Science, Math, Physics/Stats',
          monthly_tuition_fee: 4000,
          capacity: 40,
          class_teacher: 'Engr. Kashif Rehman',
        },
      ],
      subjects: [
        { id: 'sb_01', class_name: 'Grade 10 - Matric', name: 'Physics', code: 'PHY-10', teacher_name: 'Prof. Tariq Mahmood', weekly_periods: 6 },
        { id: 'sb_02', class_name: 'Grade 10 - Matric', name: 'Chemistry', code: 'CHM-10', teacher_name: 'Prof. Tariq Mahmood', weekly_periods: 6 },
        { id: 'sb_03', class_name: 'Grade 10 - Matric', name: 'Mathematics', code: 'MTH-10', teacher_name: 'Sir Muhammad Naveed', weekly_periods: 7 },
        { id: 'sb_04', class_name: 'Grade 10 - Matric', name: 'Biology', code: 'BIO-10', teacher_name: 'Ma’am Saima Parveen', weekly_periods: 6 },
        { id: 'sb_05', class_name: 'Grade 10 - Matric', name: 'English Compulsory', code: 'ENG-10', teacher_name: 'Sir Rashid Khan', weekly_periods: 6 },
        { id: 'sb_06', class_name: 'Grade 10 - Matric', name: 'Urdu Compulsory', code: 'URD-10', teacher_name: 'Ms. Farzana Bibi', weekly_periods: 5 },
        { id: 'sb_07', class_name: 'Grade 10 - Matric', name: 'Islamiyat / Pak Studies', code: 'PKS-10', teacher_name: 'Qari Abdul Rauf', weekly_periods: 4 },
        { id: 'sb_08', class_name: '1st Year (F.Sc Pre-Medical)', name: 'Physics I', code: 'PHY-11', teacher_name: 'Prof. Tariq Mahmood', weekly_periods: 7 },
        { id: 'sb_09', class_name: '1st Year (F.Sc Pre-Medical)', name: 'Chemistry I', code: 'CHM-11', teacher_name: 'Prof. Tariq Mahmood', weekly_periods: 7 },
        { id: 'sb_10', class_name: '1st Year (F.Sc Pre-Medical)', name: 'Biology I', code: 'BIO-11', teacher_name: 'Ma’am Saima Parveen', weekly_periods: 8 },
      ],
      admissions: [
        {
          id: 'adm_01',
          application_no: 'ADM-2026-7841',
          student_name: 'Kamran Ali',
          father_name: 'Akhtar Ali',
          dob: '2010-02-14',
          gender: 'Male',
          class_applying: 'Grade 9 - Matric',
          previous_school: 'Govt Middle School Paharpur',
          parent_phone: '+92 313 7766554',
          parent_email: 'akhtar.ali@gmail.com',
          address: 'Rangpur Road, Near Grain Market, Paharpur',
          documents: [
            { title: 'School Leaving Certificate', filename: 'slc_certificate.pdf', verified: true },
            { title: 'B-Form Copy', filename: 'b_form_scanned.jpg', verified: true },
          ],
          status: 'Approved',
          remarks: 'Admission confirmed. Documents verified. Fee voucher issued.',
          created_at: '2026-09-15T10:30:00.000Z',
        },
        {
          id: 'adm_02',
          application_no: 'ADM-2026-7842',
          student_name: 'Sana Gul',
          father_name: 'Gulzar Ahmad',
          dob: '2008-07-19',
          gender: 'Female',
          class_applying: '1st Year (F.Sc Pre-Medical)',
          previous_school: 'GGHSS Paharpur DI Khan',
          parent_phone: '+92 344 8877665',
          parent_email: 'gulzar.ahmad@gmail.com',
          address: 'Mohallah Farooqia, Paharpur',
          documents: [
            { title: 'Matric DMC Result Card (BISE DI Khan)', filename: 'matric_dmc_gul.pdf', verified: true },
            { title: 'Character Certificate', filename: 'character_cert.pdf', verified: false },
          ],
          status: 'Under Review',
          remarks: 'Academic merit meets 85%+ science criteria. Interview scheduled.',
          created_at: '2026-09-20T14:15:00.000Z',
        },
        {
          id: 'adm_03',
          application_no: 'ADM-2026-7843',
          student_name: 'Usman Ghani',
          father_name: 'Abdul Ghani',
          dob: '2015-05-12',
          gender: 'Male',
          class_applying: 'Grade 5 (Primary)',
          previous_school: 'Private Academy Paharpur',
          parent_phone: '+92 300 4455667',
          parent_email: 'abdul.ghani@yahoo.com',
          address: 'Chashma Road, Paharpur',
          documents: [
            { title: 'Birth Certificate', filename: 'birth_cert.jpg', verified: false },
          ],
          status: 'Pending',
          remarks: 'Initial application submitted online.',
          created_at: '2026-09-25T11:00:00.000Z',
        },
      ],
      attendance: [
        {
          id: 'att_01',
          student_id: 'std_01',
          student_name: 'Muhammad Hamza',
          class_name: 'Grade 10 - Matric',
          section: 'A (Science)',
          date: '2026-09-28',
          status: 'Present',
          marked_by: 'Prof. Tariq Mahmood',
        },
        {
          id: 'att_02',
          student_id: 'std_02',
          student_name: 'Ayesha Noor',
          class_name: 'Grade 9 - Matric',
          section: 'A (Biology)',
          date: '2026-09-28',
          status: 'Present',
          marked_by: 'Ma’am Saima Parveen',
        },
        {
          id: 'att_03',
          student_id: 'std_03',
          student_name: 'Zubair Ahmad',
          class_name: '1st Year (F.Sc Pre-Medical)',
          section: 'Medical-A',
          date: '2026-09-28',
          status: 'Late',
          remarks: 'Arrived 15 minutes late due to morning transport',
          marked_by: 'Prof. Tariq Mahmood',
        },
        {
          id: 'att_04',
          student_id: 'std_04',
          student_name: 'Fatima Bibi',
          class_name: '2nd Year (ICS Computer Science)',
          section: 'ICS-A',
          date: '2026-09-28',
          status: 'Present',
          marked_by: 'Engr. Kashif Rehman',
        },
        {
          id: 'att_05',
          student_id: 'std_05',
          student_name: 'Bilal Khan',
          class_name: 'Grade 7 - Middle',
          section: 'B',
          date: '2026-09-28',
          status: 'Leave',
          remarks: 'Medical leave approved by guardian note',
          marked_by: 'Sir Muhammad Naveed',
        },
      ],
      fees: [
        {
          id: 'fee_01',
          student_id: 'std_01',
          student_name: 'Muhammad Hamza',
          class_name: 'Grade 10 - Matric',
          fee_month: 'September',
          year: 2026,
          tuition_fee: 3400,
          admission_fee: 0,
          other_charges: 200,
          total_amount: 3600,
          paid_amount: 3600,
          pending_amount: 0,
          due_date: '2026-09-10',
          status: 'Paid',
          payment_history: [
            {
              receipt_no: 'REC-90812',
              date: '2026-09-08',
              amount: 3600,
              method: 'Bank Deposit',
              notes: 'Paid via Allied Bank / HBL Paharpur Branch Challan',
            },
          ],
        },
        {
          id: 'fee_02',
          student_id: 'std_02',
          student_name: 'Ayesha Noor',
          class_name: 'Grade 9 - Matric',
          fee_month: 'September',
          year: 2026,
          tuition_fee: 3200,
          admission_fee: 0,
          other_charges: 200,
          total_amount: 3400,
          paid_amount: 3400,
          pending_amount: 0,
          due_date: '2026-09-10',
          status: 'Paid',
          payment_history: [
            {
              receipt_no: 'REC-90815',
              date: '2026-09-09',
              amount: 3400,
              method: 'Cash',
              notes: 'Paid at school accounts counter',
            },
          ],
        },
        {
          id: 'fee_03',
          student_id: 'std_03',
          student_name: 'Zubair Ahmad',
          class_name: '1st Year (F.Sc Pre-Medical)',
          fee_month: 'September',
          year: 2026,
          tuition_fee: 4200,
          admission_fee: 0,
          other_charges: 500, // Science lab charges
          total_amount: 4700,
          paid_amount: 2500,
          pending_amount: 2200,
          due_date: '2026-09-15',
          status: 'Partial',
          payment_history: [
            {
              receipt_no: 'REC-90844',
              date: '2026-09-14',
              amount: 2500,
              method: 'Cash',
              notes: 'First installment submitted. Balance due by next week.',
            },
          ],
        },
      ],
      timetable: [
        { id: 'tt_01', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'Physics', teacher_name: 'Prof. Tariq Mahmood', day: 'Monday', start_time: '08:00', end_time: '08:45', room: 'Room 12 (Science Wing)' },
        { id: 'tt_02', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'Mathematics', teacher_name: 'Sir Muhammad Naveed', day: 'Monday', start_time: '08:45', end_time: '09:30', room: 'Room 12 (Science Wing)' },
        { id: 'tt_03', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'Chemistry', teacher_name: 'Prof. Tariq Mahmood', day: 'Monday', start_time: '09:30', end_time: '10:15', room: 'Chemistry Lab' },
        { id: 'tt_04', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'English', teacher_name: 'Sir Rashid Khan', day: 'Monday', start_time: '10:45', end_time: '11:30', room: 'Room 12 (Science Wing)' },
        { id: 'tt_05', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'Biology', teacher_name: 'Ma’am Saima Parveen', day: 'Monday', start_time: '11:30', end_time: '12:15', room: 'Bio Lab' },
        { id: 'tt_06', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'Islamiyat', teacher_name: 'Qari Abdul Rauf', day: 'Monday', start_time: '12:15', end_time: '01:00', room: 'Room 12 (Science Wing)' },
        // Tuesday
        { id: 'tt_07', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'Mathematics', teacher_name: 'Sir Muhammad Naveed', day: 'Tuesday', start_time: '08:00', end_time: '08:45', room: 'Room 12 (Science Wing)' },
        { id: 'tt_08', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'Physics Practical', teacher_name: 'Prof. Tariq Mahmood', day: 'Tuesday', start_time: '08:45', end_time: '10:15', room: 'Physics Lab' },
        { id: 'tt_09', class_name: 'Grade 10 - Matric', section: 'A (Science)', subject: 'Urdu', teacher_name: 'Ms. Farzana Bibi', day: 'Tuesday', start_time: '10:45', end_time: '11:30', room: 'Room 12 (Science Wing)' },
      ],
      exams: [
        {
          id: 'ex_01',
          title: 'Mid-Term Assessment Examination 2026',
          term: 'Mid-Term',
          academic_year: '2026-2027',
          start_date: '2026-10-15',
          end_date: '2026-10-26',
          classes: ['Grade 6 to 8 (Middle)', 'Grade 9 - Matric', 'Grade 10 - Matric', '1st Year (F.Sc Pre-Medical)', 'ICS'],
        },
        {
          id: 'ex_02',
          title: 'Pre-Board Preparatory Exams (BISE DI Khan Pattern)',
          term: 'Pre-Board Send-up',
          academic_year: '2025-2026',
          start_date: '2026-02-10',
          end_date: '2026-02-22',
          classes: ['Grade 9 - Matric', 'Grade 10 - Matric'],
        },
      ],
      results: [
        {
          id: 'res_01',
          exam_id: 'ex_02',
          exam_title: 'Pre-Board Preparatory Exams (BISE DI Khan Pattern)',
          student_id: 'std_01',
          student_name: 'Muhammad Hamza',
          class_name: 'Grade 10 - Matric',
          section: 'A (Science)',
          subjects: [
            { subject_name: 'Physics', total_marks: 75, obtained_marks: 68, grade: 'A1' },
            { subject_name: 'Chemistry', total_marks: 75, obtained_marks: 65, grade: 'A1' },
            { subject_name: 'Mathematics', total_marks: 75, obtained_marks: 71, grade: 'A1' },
            { subject_name: 'Biology', total_marks: 75, obtained_marks: 67, grade: 'A1' },
            { subject_name: 'English', total_marks: 75, obtained_marks: 62, grade: 'A' },
            { subject_name: 'Urdu', total_marks: 75, obtained_marks: 64, grade: 'A' },
            { subject_name: 'Islamiyat', total_marks: 50, obtained_marks: 46, grade: 'A1' },
          ],
          total_marks: 500,
          obtained_marks: 443,
          percentage: 88.6,
          overall_grade: 'A1 (Distinction)',
          remarks: 'Outstanding analytical capability. High probability of securing top district rank in BISE DI Khan annual exam.',
          published: true,
        },
        {
          id: 'res_02',
          exam_id: 'ex_02',
          exam_title: 'Pre-Board Preparatory Exams (BISE DI Khan Pattern)',
          student_id: 'std_02',
          student_name: 'Ayesha Noor',
          class_name: 'Grade 9 - Matric',
          section: 'A (Biology)',
          subjects: [
            { subject_name: 'Physics', total_marks: 75, obtained_marks: 62, grade: 'A' },
            { subject_name: 'Chemistry', total_marks: 75, obtained_marks: 60, grade: 'A' },
            { subject_name: 'Mathematics', total_marks: 75, obtained_marks: 66, grade: 'A1' },
            { subject_name: 'Biology', total_marks: 75, obtained_marks: 69, grade: 'A1' },
            { subject_name: 'English', total_marks: 75, obtained_marks: 58, grade: 'B' },
          ],
          total_marks: 375,
          obtained_marks: 315,
          percentage: 84.0,
          overall_grade: 'A',
          remarks: 'Commendable performance in Science and Biology. Strengthen English grammar.',
          published: true,
        },
      ],
      announcements: [
        {
          id: 'ann_01',
          title: 'Admissions Open for Academic Session 2026–2027 (Pre-School to Intermediate)',
          content: 'Admissions are now open at Shawan School and College Paharpur for Playgroup, Primary, Middle, SSC Matriculation (Science), and HSSC Intermediate College (Pre-Medical, Pre-Engineering & ICS). Prospectus and online registration available. Scholarships available for merit achievers.',
          category: 'Admission',
          audience: 'All',
          date: '2026-09-20',
          priority: 'Urgent',
          author: 'Office of the Principal',
        },
        {
          id: 'ann_02',
          title: 'BISE Dera Ismail Khan Annual Exam Registration Schedule',
          content: 'Students of SSC Part 1 & Part 2 are informed that the deadline for submitting exam registration forms and verified B-Form documents with normal fee is October 25, 2026. Please verify candidate details in the student portal.',
          category: 'Exam',
          audience: 'Students',
          date: '2026-09-24',
          priority: 'High',
          author: 'Examination Controller',
        },
        {
          id: 'ann_03',
          title: 'Annual Science Fair & STEM Exhibition Announcement',
          content: 'The Annual Inter-Class Science & Robotics Exhibition will be hosted at the campus auditorium on October 18, 2026. Working project prototypes in Renewable Solar Energy, Robotics, and Environmental Preservation are invited.',
          category: 'Academic',
          audience: 'All',
          date: '2026-09-26',
          priority: 'Normal',
          author: 'Science Club Patron',
        },
        {
          id: 'ann_04',
          title: 'Autumn Parent-Teacher Conference (PTM) Notice',
          content: 'A comprehensive Parent-Teacher Meeting is scheduled for Saturday, October 10, 2026, from 9:00 AM to 1:00 PM. Parents can review mid-term diagnostic test reports, attendance records, and personal conduct evaluations.',
          category: 'General',
          audience: 'All',
          date: '2026-09-27',
          priority: 'High',
          author: 'Administration',
        },
      ],
      events: [
        {
          id: 'ev_01',
          title: 'Annual Science, Tech & Robotics Exhibition 2026',
          description: 'Showcasing ingenious working scientific models, computer coding demos, and biology lab investigations created by our matric and college students.',
          date: '2026-10-18',
          time: '09:00 AM - 02:00 PM',
          location: 'College Main Hall & Science Courtyard, Rangpur Road, Paharpur',
          cover_image: '/src/assets/images/school_science_lab_1790606594349.jpg',
          status: 'Upcoming',
        },
        {
          id: 'ev_02',
          title: 'Paharpur Inter-School Cricket & Athletics Tournament',
          description: 'Annual sports festival bringing together talented youth across Paharpur and surrounding tehsil schools in cricket, athletics, and badminton.',
          date: '2026-11-04',
          time: '08:30 AM - 04:00 PM',
          location: 'Shawan Sports Complex & Athletic Grounds',
          cover_image: '/src/assets/images/school_sports_ground_1790606627159.jpg',
          status: 'Upcoming',
        },
        {
          id: 'ev_03',
          title: 'Merit Awards & High Achievers Convocation',
          description: 'Honoring distinction holders of the Board of Intermediate and Secondary Education (BISE) Dera Ismail Khan with gold medals and university scholarships.',
          date: '2026-11-20',
          time: '10:00 AM - 01:00 PM',
          location: 'Jinnah Auditorium, Shawan College Paharpur',
          cover_image: '/src/assets/images/hero_school_campus_1790606578302.jpg',
          status: 'Upcoming',
        },
      ],
      gallery: [
        {
          id: 'gal_01',
          title: 'Main Academic Campus & Limestone Facade',
          caption: 'Spacious campus building on Rangpur Road featuring modern architectural ventilation, landscaped perimeter, and student gathering lawns.',
          category: 'Campus',
          image_url: '/src/assets/images/hero_school_campus_1790606578302.jpg',
          date: '2026-09-10',
        },
        {
          id: 'gal_02',
          title: 'State-of-the-Art Science & Digital Computer Lab',
          caption: 'Equipped with apparatus for Physics, Chemistry, Biology, and modern networked desktop PCs for Intermediate Computer Science students.',
          category: 'Laboratories',
          image_url: '/src/assets/images/school_science_lab_1790606594349.jpg',
          date: '2026-09-12',
        },
        {
          id: 'gal_03',
          title: 'Central Library & Silent Research Resource Center',
          caption: 'Over 5,000 academic reference volumes, national curriculum textbooks, past board papers, and serene individual reading desks.',
          category: 'Academics',
          image_url: '/src/assets/images/school_library_hall_1790606612341.jpg',
          date: '2026-09-15',
        },
        {
          id: 'gal_04',
          title: 'Campus Athletic Grounds & Outdoor Recreation',
          caption: 'Dedicated green playground facilitating physical training (PT), cricket matches, football, and annual sports days.',
          category: 'Sports',
          image_url: '/src/assets/images/school_sports_ground_1790606627159.jpg',
          date: '2026-09-18',
        },
      ],
      contact_messages: [
        {
          id: 'msg_01',
          name: 'Engr. Faisal Farooq',
          email: 'faisal.farooq@outlook.com',
          phone: '+92 314 5566778',
          subject: 'Admission inquiry for F.Sc Pre-Engineering',
          message: 'Salam. My son has scored 980 marks in matric from BISE DI Khan. What is the fee concession procedure for merit scholars in F.Sc?',
          created_at: '2026-09-26T09:12:00.000Z',
          read: false,
        },
      ],
      settings: {
        school_name: 'Shawan School and College',
        short_name: 'Shawan College',
        slogan: 'Inspiring Young Minds Through Academic Rigor & Moral Character',
        location: '4X48+MRH, Rangpur Road, Paharpur, Dera Ismail Khan, Khyber Pakhtunkhwa, Pakistan',
        google_maps_code: '4X48+MRH',
        google_maps_embed_query: 'Rangpur Road, Paharpur, Dera Ismail Khan, Khyber Pakhtunkhwa, Pakistan',
        phone: '+92 300 0000000',
        alt_phone: '+92 966 000000',
        email: 'info@shawanschool.edu.pk',
        admission_email: 'admissions@shawanschool.edu.pk',
        affiliation: 'Affiliated with Board of Intermediate & Secondary Education (BISE) Dera Ismail Khan & Khyber Pakhtunkhwa PSRA',
        registration_info: 'Recognized Private Educational Institution, District Dera Ismail Khan',
        school_timings_summer: '07:45 AM - 01:30 PM (Mon - Thu, Sat) | Friday: 07:45 AM - 12:00 PM',
        school_timings_winter: '08:15 AM - 02:00 PM (Mon - Thu, Sat) | Friday: 08:15 AM - 12:30 PM',
        principal_name: 'Principal, Shawan School and College',
        principal_message: 'Welcome to Shawan School and College Paharpur. Our mission is to democratize world-class scientific, intellectual, and moral instruction for the sons and daughters of Paharpur and Dera Ismail Khan. We foster an academic environment where disciplined study, modern laboratories, dedicated mentors, and Islamic ethical values empower each student to realize their highest academic and career aspirations.',
        about_text: 'Shawan School and College is a forward-looking educational institution situated on Rangpur Road in Paharpur, Dera Ismail Khan, Pakistan. With comprehensive educational offerings spanning early childhood foundation, primary, middle schooling, and higher secondary college tiers (Pre-Medical, Pre-Engineering, Computer Science), the institution bridges contemporary technological pedagogy with proven academic discipline. Guided by certified subject specialists and equipped with advanced laboratories, we prepare youth for competitive university admissions and purposeful citizenship.',
        mission: 'To cultivate intellectually competent, morally upright, and socially proactive leaders through rigorous academic training, innovative STEM education, and values-based character development.',
        vision: 'To stand as the leading center of academic excellence in the Dera Ismail Khan division, nurturing students who excel in provincial board examinations, national higher education, and constructive nation-building.',
        core_values: [
          'Academic Rigor & Critical Thinking',
          'Moral Integrity & Ethical Conduct',
          'Scientific Inquiry & Technological Literacy',
          'Compassion, Discipline & Mutual Respect',
        ],
        social_facebook: 'https://facebook.com',
        social_whatsapp: '+923000000000',
        hero_badge: 'Admissions Open 2026–2027 · BISE DI Khan Registered',
        hero_title: 'Building Leaders of Tomorrow in Paharpur',
        hero_subtitle: 'A premier educational institution in Paharpur, D.I. Khan offering comprehensive schooling and higher secondary college programs with modern science facilities, proven faculty, and individualized student care.',
        features: [
          {
            title: 'Modern Science & Computer Labs',
            description: 'Fully equipped Physics, Chemistry, Biology, and ICT computer laboratories adhering to modern board examination specifications.',
            icon: 'FlaskConical',
          },
          {
            title: 'Distinguished Faculty',
            description: 'Subject-matter experts with master’s credentials committed to individualized mentoring and conceptual mastery.',
            icon: 'GraduationCap',
          },
          {
            title: 'BISE DI Khan Track Record',
            description: 'Consistent top grades, distinction certificates, and entry-test foundations for medical and engineering universities.',
            icon: 'Award',
          },
          {
            title: 'Holistic Character & Tarbiyah',
            description: 'Balanced curriculum combining rigorous secular knowledge with Nazra Quran, ethics, speech competitions, and physical sports.',
            icon: 'HeartHandshake',
          },
        ],
        academic_levels: [
          {
            level: 'Early Childhood & Primary',
            grades: 'Playgroup to Grade 5',
            stream: 'National Single Curriculum (SNC)',
            description: 'Activity-based foundational literacy, numeracy, phonics, general science, and Islamic character nurturing.',
          },
          {
            level: 'Middle School',
            grades: 'Grade 6 to 8',
            stream: 'Core STEM & Humanities',
            description: 'Analytical math, physical sciences, Urdu, English communication, and computer fundamentals.',
          },
          {
            level: 'Matriculation (SSC)',
            grades: 'Grade 9 & 10',
            stream: 'Science (Biology & Computer Groups)',
            description: 'Rigorous preparation for BISE Dera Ismail Khan board examinations with daily lab practicals and model testing.',
          },
          {
            level: 'Intermediate College (HSSC)',
            grades: '1st & 2nd Year College',
            stream: 'F.Sc Pre-Medical, Pre-Engineering & ICS',
            description: 'Collegiate level instruction oriented towards MDCAT, ECAT, university admissions, and professional disciplines.',
          },
        ],
        facilities: [
          {
            name: 'Advanced Science Laboratories',
            description: 'Separated dedicated labs for Physics, Chemistry, and Biology equipped with optical microscopes, glassware, chemicals, and safety gear.',
            image: '/src/assets/images/school_science_lab_1790606594349.jpg',
          },
          {
            name: 'Central Academic Library',
            description: 'Thousands of curriculum textbooks, scholarly references, international encyclopedias, and quiet study alcoves.',
            image: '/src/assets/images/school_library_hall_1790606612341.jpg',
          },
          {
            name: 'Sports Complex & Playing Grounds',
            description: 'Expansive natural turf grounds for cricket, football, physical drill sessions, and inter-house athletic meets.',
            image: '/src/assets/images/school_sports_ground_1790606627159.jpg',
          },
          {
            name: 'Digital ICT Computer Center',
            description: 'High-speed networked computer workstations running programming software, office tools, and digital learning modules.',
            image: '/src/assets/images/school_science_lab_1790606594349.jpg',
          },
        ],
        testimonials: [
          {
            name: 'Muhammad Asif (Parent)',
            role: 'Father of 10th Grade Student',
            quote: 'Shawan School has provided exceptional academic discipline in Paharpur. The teachers give individual attention to each boy and girl, and their regular test reporting gives us complete peace of mind.',
            year: 'Session 2025–2026',
          },
          {
            name: 'Dr. Shahzad Khan (Alumnus)',
            role: 'Former F.Sc Pre-Medical Student, now MBBS Doctor',
            quote: 'The conceptual foundation built by the faculty at Shawan College was instrumental in cracking the medical college entrance test. Truly a blessing for Paharpur students.',
            year: 'Class of 2021',
          },
          {
            name: 'Malik Tariq (Local Community Elder)',
            role: 'Resident of Rangpur Road, Paharpur',
            quote: 'Having an institution of this caliber with equipped science labs and high moral environment on Rangpur Road has elevated education in our entire tehsil.',
            year: 'Paharpur, DI Khan',
          },
        ],
      },
      sections: [
        { id: 'sec_01', name: 'A', class_name: 'Grade 9 - Matric', capacity: 40, room: 'Room 10', teacher_name: 'Prof. Tariq Mahmood' },
        { id: 'sec_02', name: 'B', class_name: 'Grade 9 - Matric', capacity: 40, room: 'Room 11', teacher_name: 'Sir Muhammad Naveed' },
        { id: 'sec_03', name: 'A', class_name: 'Grade 10 - Matric', capacity: 40, room: 'Room 12', teacher_name: 'Prof. Tariq Mahmood' },
        { id: 'sec_04', name: 'B', class_name: 'Grade 10 - Matric', capacity: 40, room: 'Room 13', teacher_name: 'Sir Rashid Khan' },
      ],
      enrollments: [],
      teacher_assignments: [
        {
          id: 'asg_01',
          teacher_id: 'tch_01',
          teacher_name: 'Prof. Tariq Mahmood',
          class_name: 'Grade 9 - Matric',
          section: 'A',
          subject: 'Physics',
          academic_session: '2026-2027',
          assigned_date: '2026-08-15',
        },
        {
          id: 'asg_02',
          teacher_id: 'tch_01',
          teacher_name: 'Prof. Tariq Mahmood',
          class_name: 'Grade 10 - Matric',
          section: 'A',
          subject: 'Physics',
          academic_session: '2026-2027',
          assigned_date: '2026-08-15',
        },
      ],
      audit_logs: [],
    };
  }
}

export const db = new Database();
