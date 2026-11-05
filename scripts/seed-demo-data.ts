import '../server/config/env.ts';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  UserModel,
  StudentModel,
  TeacherModel,
  ParentModel,
  ClassModel,
  SectionModel,
  SubjectModel,
  EnrollmentModel,
  computeActiveEnrollmentKey,
  TeacherAssignmentModel,
  AttendanceModel,
  ExamModel,
  ResultModel,
  FeeModel,
  FeePaymentModel,
  AdmissionModel,
  computeAdmissionDedupeKey,
  TimetableModel,
  AnnouncementModel,
  SchoolEventModel,
  GalleryModel,
  ContactMessageModel,
  NotificationModel,
  AuditLogModel,
} from '../server/models/index.ts';
import { connectDB, closeDB, sanitizeErrorMessage } from '../server/config/db.ts';

/**
 * Idempotent, safe demo database seed script for Shawan School & College.
 * Populates realistic academic, student, faculty, attendance, fee, exam and admission records.
 */
export async function seedDemoDatabase(options: { force?: boolean } = {}): Promise<{
  success: boolean;
  counts: Record<string, number>;
}> {
  const isEnabled = process.env.ENABLE_DEMO_SEED === 'true' || options.force === true || process.argv.includes('--force');

  if (!isEnabled) {
    throw new Error(
      '[Demo Seed Guard] Demo data seeding is disabled. Set ENABLE_DEMO_SEED=true in environment or pass --force to authorize demo data generation.'
    );
  }

  console.log('[Demo Seed] Initializing MongoDB connection...');
  await connectDB();
  console.log(`[Demo Seed] Connected to database: "${mongoose.connection.name}"`);

  const counts: Record<string, number> = {};

  // Pre-generate standard secure password hashes (computed once for speed)
  const defaultTeacherHash = bcrypt.hashSync('TeacherPassword123!', 10);
  const defaultParentHash = bcrypt.hashSync('ParentPassword123!', 10);
  const defaultStudentHash = bcrypt.hashSync('StudentPassword123!', 10);

  // ============================================================================
  // 1. CLASSES & SECTIONS
  // ============================================================================
  console.log('[Demo Seed] Seeding Classes & Sections...');
  const classesData = [
    { record_id: 'cls_nursery', name: 'Nursery', grade_level: 'Pre-Primary', stream: 'Early Childhood', monthly_tuition_fee: 2500, capacity: 35, class_teacher: 'Asma Gul' },
    { record_id: 'cls_prep', name: 'Prep', grade_level: 'Pre-Primary', stream: 'Early Childhood', monthly_tuition_fee: 2500, capacity: 35, class_teacher: 'Asma Gul' },
    { record_id: 'cls_1', name: 'Class 1', grade_level: 'Primary', stream: 'Single National Curriculum', monthly_tuition_fee: 3000, capacity: 40, class_teacher: 'Bushra Bibi' },
    { record_id: 'cls_2', name: 'Class 2', grade_level: 'Primary', stream: 'Single National Curriculum', monthly_tuition_fee: 3000, capacity: 40, class_teacher: 'Bushra Bibi' },
    { record_id: 'cls_3', name: 'Class 3', grade_level: 'Primary', stream: 'Single National Curriculum', monthly_tuition_fee: 3200, capacity: 40, class_teacher: 'Rashid Minhas' },
    { record_id: 'cls_4', name: 'Class 4', grade_level: 'Primary', stream: 'Single National Curriculum', monthly_tuition_fee: 3200, capacity: 40, class_teacher: 'Rashid Minhas' },
    { record_id: 'cls_5', name: 'Class 5', grade_level: 'Primary', stream: 'Single National Curriculum', monthly_tuition_fee: 3500, capacity: 40, class_teacher: 'Qazi Noman Ahmad' },
    { record_id: 'cls_6', name: 'Class 6', grade_level: 'Middle', stream: 'Core STEM & Humanities', monthly_tuition_fee: 3800, capacity: 40, class_teacher: 'Sajid Mehmood' },
    { record_id: 'cls_7', name: 'Class 7', grade_level: 'Middle', stream: 'Core STEM & Humanities', monthly_tuition_fee: 3800, capacity: 40, class_teacher: 'Qazi Noman Ahmad' },
    { record_id: 'cls_8', name: 'Class 8', grade_level: 'Middle', stream: 'Core STEM & Humanities', monthly_tuition_fee: 4000, capacity: 40, class_teacher: 'Muhammad Imran Khan' },
    { record_id: 'cls_9', name: 'Class 9', grade_level: 'Secondary (SSC)', stream: 'Science (Biology & Computer)', monthly_tuition_fee: 4500, capacity: 40, class_teacher: 'Muhammad Tariq Qureshi' },
    { record_id: 'cls_10', name: 'Class 10', grade_level: 'Secondary (SSC)', stream: 'Science (Biology & Computer)', monthly_tuition_fee: 4800, capacity: 40, class_teacher: 'Dr. Shaheen Akhtar' },
    { record_id: 'cls_11', name: 'Class 11 (1st Year)', grade_level: 'Higher Secondary (HSSC)', stream: 'Pre-Medical & Pre-Engineering', monthly_tuition_fee: 5500, capacity: 40, class_teacher: 'Farhana Yasmeen' },
    { record_id: 'cls_12', name: 'Class 12 (2nd Year)', grade_level: 'Higher Secondary (HSSC)', stream: 'Pre-Medical, Pre-Engineering & ICS', monthly_tuition_fee: 6000, capacity: 40, class_teacher: 'Muhammad Tariq Qureshi' },
  ];

  counts.classes = 0;
  for (const c of classesData) {
    await ClassModel.updateOne(
      { name: c.name },
      { $set: c },
      { upsert: true }
    );
    counts.classes++;
  }

  const sectionsData = [
    { record_id: 'sec_nursery_a', class_name: 'Nursery', name: 'A', capacity: 35, room: 'Foundation Room 01', teacher_name: 'Asma Gul' },
    { record_id: 'sec_prep_a', class_name: 'Prep', name: 'A', capacity: 35, room: 'Foundation Room 02', teacher_name: 'Asma Gul' },
    { record_id: 'sec_1_a', class_name: 'Class 1', name: 'A', capacity: 40, room: 'Junior Wing 101', teacher_name: 'Bushra Bibi' },
    { record_id: 'sec_2_a', class_name: 'Class 2', name: 'A', capacity: 40, room: 'Junior Wing 102', teacher_name: 'Bushra Bibi' },
    { record_id: 'sec_3_a', class_name: 'Class 3', name: 'A', capacity: 40, room: 'Junior Wing 103', teacher_name: 'Rashid Minhas' },
    { record_id: 'sec_4_a', class_name: 'Class 4', name: 'A', capacity: 40, room: 'Junior Wing 104', teacher_name: 'Rashid Minhas' },
    { record_id: 'sec_5_a', class_name: 'Class 5', name: 'A', capacity: 40, room: 'Middle Wing 201', teacher_name: 'Qazi Noman Ahmad' },
    { record_id: 'sec_6_a', class_name: 'Class 6', name: 'A', capacity: 40, room: 'Middle Wing 202', teacher_name: 'Sajid Mehmood' },
    { record_id: 'sec_7_a', class_name: 'Class 7', name: 'A', capacity: 40, room: 'Middle Wing 203', teacher_name: 'Qazi Noman Ahmad' },
    { record_id: 'sec_8_a', class_name: 'Class 8', name: 'A', capacity: 40, room: 'Middle Wing 204', teacher_name: 'Muhammad Imran Khan' },
    { record_id: 'sec_9_a', class_name: 'Class 9', name: 'A', capacity: 40, room: 'Senior Hall 301', teacher_name: 'Muhammad Tariq Qureshi' },
    { record_id: 'sec_9_b', class_name: 'Class 9', name: 'B', capacity: 40, room: 'Senior Hall 302', teacher_name: 'Dr. Shaheen Akhtar' },
    { record_id: 'sec_10_a', class_name: 'Class 10', name: 'A', capacity: 40, room: 'Senior Hall 303', teacher_name: 'Dr. Shaheen Akhtar' },
    { record_id: 'sec_10_b', class_name: 'Class 10', name: 'B', capacity: 40, room: 'Senior Hall 304', teacher_name: 'Farhana Yasmeen' },
    { record_id: 'sec_11_a', class_name: 'Class 11 (1st Year)', name: 'A', capacity: 40, room: 'Collegiate Block 401', teacher_name: 'Farhana Yasmeen' },
    { record_id: 'sec_12_a', class_name: 'Class 12 (2nd Year)', name: 'A', capacity: 40, room: 'Collegiate Block 402', teacher_name: 'Muhammad Tariq Qureshi' },
  ];

  counts.sections = 0;
  for (const s of sectionsData) {
    await SectionModel.updateOne(
      { class_name: s.class_name, name: s.name },
      { $set: s },
      { upsert: true }
    );
    counts.sections++;
  }

  // ============================================================================
  // 2. TEACHERS & TEACHER ACCOUNTS
  // ============================================================================
  console.log('[Demo Seed] Seeding Teachers and Faculty Accounts...');
  const teachersData = [
    {
      record_id: 'tch_demo_01',
      name: 'Muhammad Tariq Qureshi',
      email: 'tariq.physics@shawanschool.edu.pk',
      qualification: 'M.Sc Physics (Peshawar University), B.Ed',
      subject: 'Physics',
      classes: ['Class 9', 'Class 10', 'Class 11 (1st Year)', 'Class 12 (2nd Year)'],
      contact_no: '+92 300 5551001',
      joining_date: '2021-08-15',
      experience: '12 Years',
      status: 'Active' as const,
      bio: 'Head of Physics Department specializing in BISE mechanics, electromagnetism, and board practical examinations.',
    },
    {
      record_id: 'tch_demo_02',
      name: 'Dr. Shaheen Akhtar',
      email: 'shaheen.chemistry@shawanschool.edu.pk',
      qualification: 'Ph.D Chemistry (Gomal University)',
      subject: 'Chemistry',
      classes: ['Class 9', 'Class 10', 'Class 11 (1st Year)', 'Class 12 (2nd Year)'],
      contact_no: '+92 300 5551002',
      joining_date: '2022-01-10',
      experience: '10 Years',
      status: 'Active' as const,
      bio: 'Doctor of Organic Chemistry guiding senior college scholars through conceptual stoichiometry and laboratory analytical techniques.',
    },
    {
      record_id: 'tch_demo_03',
      name: 'Hafiz Abdur Rahman',
      email: 'abdur.islamiat@shawanschool.edu.pk',
      qualification: 'M.A Islamic Studies & Dars-e-Nizami Shahadat-ul-Alamiya',
      subject: 'Islamiat',
      classes: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'],
      contact_no: '+92 300 5551003',
      joining_date: '2019-09-01',
      experience: '15 Years',
      status: 'Active' as const,
      bio: 'Senior Tarbiyah supervisor committed to Quranic tajweed, Sirah ethics, and character building across all academic tiers.',
    },
    {
      record_id: 'tch_demo_04',
      name: 'Sajid Mehmood',
      email: 'sajid.cs@shawanschool.edu.pk',
      qualification: 'MCS Computer Science (QAU Islamabad)',
      subject: 'Computer Science',
      classes: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11 (1st Year)', 'Class 12 (2nd Year)'],
      contact_no: '+92 300 5551004',
      joining_date: '2023-02-15',
      experience: '8 Years',
      status: 'Active' as const,
      bio: 'ICT lab director instructing foundational programming in C++, web development, database logic, and digital literacy.',
    },
    {
      record_id: 'tch_demo_05',
      name: 'Farhana Yasmeen',
      email: 'farhana.bio@shawanschool.edu.pk',
      qualification: 'M.Sc Zoology & M.Ed (BISE DI Khan Merit Holder)',
      subject: 'Biology',
      classes: ['Class 9', 'Class 10', 'Class 11 (1st Year)', 'Class 12 (2nd Year)'],
      contact_no: '+92 300 5551005',
      joining_date: '2022-08-20',
      experience: '9 Years',
      status: 'Active' as const,
      bio: 'Senior pre-medical educator mentoring aspirational medical college candidates in anatomy, genetics, and biotechnology.',
    },
    {
      record_id: 'tch_demo_06',
      name: 'Muhammad Imran Khan',
      email: 'imran.english@shawanschool.edu.pk',
      qualification: 'M.A English Literature (NUML Islamabad)',
      subject: 'English',
      classes: ['Class 8', 'Class 9', 'Class 10', 'Class 11 (1st Year)', 'Class 12 (2nd Year)'],
      contact_no: '+92 300 5551006',
      joining_date: '2020-09-10',
      experience: '11 Years',
      status: 'Active' as const,
      bio: 'English linguistic coach driving conversational fluency, creative prose composition, and board examination comprehension.',
    },
    {
      record_id: 'tch_demo_07',
      name: 'Qazi Noman Ahmad',
      email: 'noman.math@shawanschool.edu.pk',
      qualification: 'M.Sc Mathematics (Gomal University)',
      subject: 'Mathematics',
      classes: ['Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'],
      contact_no: '+92 300 5551007',
      joining_date: '2023-01-05',
      experience: '7 Years',
      status: 'Active' as const,
      bio: 'Pure and applied mathematics instructor fostering analytical problem-solving in algebra, calculus, and Euclidean geometry.',
    },
    {
      record_id: 'tch_demo_08',
      name: 'Bushra Bibi',
      email: 'bushra.urdu@shawanschool.edu.pk',
      qualification: 'M.A Urdu Literature & B.Ed',
      subject: 'Urdu',
      classes: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'],
      contact_no: '+92 300 5551008',
      joining_date: '2021-03-01',
      experience: '10 Years',
      status: 'Active' as const,
      bio: 'Junior school supervisor dedicated to foundational Urdu calligraphy, poetic recitation, and reading comprehension.',
    },
    {
      record_id: 'tch_demo_09',
      name: 'Asma Gul',
      email: 'asma.early@shawanschool.edu.pk',
      qualification: 'B.Sc & Certified Montessori Directress',
      subject: 'Early Childhood Education',
      classes: ['Nursery', 'Prep'],
      contact_no: '+92 300 5551009',
      joining_date: '2024-01-15',
      experience: '6 Years',
      status: 'Active' as const,
      bio: 'Montessori specialist nurturing early phonics, spatial creativity, sensory development, and joyful classroom discovery.',
    },
    {
      record_id: 'tch_demo_10',
      name: 'Rashid Minhas',
      email: 'rashid.pakstudies@shawanschool.edu.pk',
      qualification: 'M.A Pakistan Studies & History',
      subject: 'Pakistan Studies',
      classes: ['Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'],
      contact_no: '+92 300 5551010',
      joining_date: '2022-09-01',
      experience: '8 Years',
      status: 'Active' as const,
      bio: 'Social sciences lecturer cultivating civic responsibility, regional geography, and historical constitutional awareness.',
    },
  ];

  counts.teachers = 0;
  for (const t of teachersData) {
    const userId = `usr_demo_${t.record_id}`;
    await UserModel.updateOne(
      { email: t.email },
      {
        $set: {
          record_id: userId,
          email: t.email,
          name: t.name,
          role: 'teacher',
          password_hash: defaultTeacherHash,
          phone: t.contact_no,
          linked_id: t.record_id,
          status: 'active',
        },
      },
      { upsert: true }
    );

    await TeacherModel.updateOne(
      { record_id: t.record_id },
      {
        $set: {
          ...t,
          user_id: userId,
        },
      },
      { upsert: true }
    );
    counts.teachers++;
  }

  // ============================================================================
  // 3. SUBJECTS & TEACHER ASSIGNMENTS
  // ============================================================================
  console.log('[Demo Seed] Seeding Subjects & Teacher Assignments...');
  const subjectsData = [
    // Pre-Primary & Primary
    { record_id: 'sub_nur_eng', class_name: 'Nursery', name: 'English Phonics', code: 'NUR-ENG', teacher_name: 'Asma Gul', weekly_periods: 6 },
    { record_id: 'sub_nur_urd', class_name: 'Nursery', name: 'Urdu Haroof-e-Tahajji', code: 'NUR-URD', teacher_name: 'Asma Gul', weekly_periods: 6 },
    { record_id: 'sub_nur_mth', class_name: 'Nursery', name: 'Early Numeracy', code: 'NUR-MTH', teacher_name: 'Asma Gul', weekly_periods: 5 },
    { record_id: 'sub_p_eng', class_name: 'Prep', name: 'English Primer', code: 'PRP-ENG', teacher_name: 'Asma Gul', weekly_periods: 6 },
    { record_id: 'sub_1_eng', class_name: 'Class 1', name: 'English', code: 'CLS1-ENG', teacher_name: 'Bushra Bibi', weekly_periods: 6 },
    { record_id: 'sub_1_mth', class_name: 'Class 1', name: 'Mathematics', code: 'CLS1-MTH', teacher_name: 'Bushra Bibi', weekly_periods: 6 },
    { record_id: 'sub_1_isl', class_name: 'Class 1', name: 'Islamiat', code: 'CLS1-ISL', teacher_name: 'Hafiz Abdur Rahman', weekly_periods: 4 },
    { record_id: 'sub_5_sci', class_name: 'Class 5', name: 'General Science', code: 'CLS5-SCI', teacher_name: 'Farhana Yasmeen', weekly_periods: 5 },
    { record_id: 'sub_5_mth', class_name: 'Class 5', name: 'Mathematics', code: 'CLS5-MTH', teacher_name: 'Qazi Noman Ahmad', weekly_periods: 6 },
    { record_id: 'sub_5_eng', class_name: 'Class 5', name: 'English', code: 'CLS5-ENG', teacher_name: 'Muhammad Imran Khan', weekly_periods: 5 },
    // Middle
    { record_id: 'sub_8_eng', class_name: 'Class 8', name: 'English', code: 'CLS8-ENG', teacher_name: 'Muhammad Imran Khan', weekly_periods: 6 },
    { record_id: 'sub_8_mth', class_name: 'Class 8', name: 'Mathematics', code: 'CLS8-MTH', teacher_name: 'Qazi Noman Ahmad', weekly_periods: 6 },
    { record_id: 'sub_8_sci', class_name: 'Class 8', name: 'General Science', code: 'CLS8-SCI', teacher_name: 'Muhammad Tariq Qureshi', weekly_periods: 5 },
    { record_id: 'sub_8_cs', class_name: 'Class 8', name: 'Computer Education', code: 'CLS8-CS', teacher_name: 'Sajid Mehmood', weekly_periods: 4 },
    // Matric (Class 9 & 10)
    { record_id: 'sub_9_phy', class_name: 'Class 9', name: 'Physics', code: 'PHY-9', teacher_name: 'Muhammad Tariq Qureshi', weekly_periods: 6 },
    { record_id: 'sub_9_chm', class_name: 'Class 9', name: 'Chemistry', code: 'CHM-9', teacher_name: 'Dr. Shaheen Akhtar', weekly_periods: 6 },
    { record_id: 'sub_9_bio', class_name: 'Class 9', name: 'Biology', code: 'BIO-9', teacher_name: 'Farhana Yasmeen', weekly_periods: 6 },
    { record_id: 'sub_9_cs', class_name: 'Class 9', name: 'Computer Science', code: 'CS-9', teacher_name: 'Sajid Mehmood', weekly_periods: 6 },
    { record_id: 'sub_9_mth', class_name: 'Class 9', name: 'Mathematics', code: 'MTH-9', teacher_name: 'Qazi Noman Ahmad', weekly_periods: 6 },
    { record_id: 'sub_9_eng', class_name: 'Class 9', name: 'English', code: 'ENG-9', teacher_name: 'Muhammad Imran Khan', weekly_periods: 5 },
    { record_id: 'sub_9_isl', class_name: 'Class 9', name: 'Islamiat', code: 'ISL-9', teacher_name: 'Hafiz Abdur Rahman', weekly_periods: 4 },
    { record_id: 'sub_10_phy', class_name: 'Class 10', name: 'Physics', code: 'PHY-10', teacher_name: 'Muhammad Tariq Qureshi', weekly_periods: 6 },
    { record_id: 'sub_10_chm', class_name: 'Class 10', name: 'Chemistry', code: 'CHM-10', teacher_name: 'Dr. Shaheen Akhtar', weekly_periods: 6 },
    { record_id: 'sub_10_bio', class_name: 'Class 10', name: 'Biology', code: 'BIO-10', teacher_name: 'Farhana Yasmeen', weekly_periods: 6 },
    { record_id: 'sub_10_mth', class_name: 'Class 10', name: 'Mathematics', code: 'MTH-10', teacher_name: 'Qazi Noman Ahmad', weekly_periods: 6 },
    { record_id: 'sub_10_pst', class_name: 'Class 10', name: 'Pakistan Studies', code: 'PST-10', teacher_name: 'Rashid Minhas', weekly_periods: 4 },
    // College (Class 11 & 12)
    { record_id: 'sub_11_phy', class_name: 'Class 11 (1st Year)', name: 'Physics Part I', code: 'PHY-11', teacher_name: 'Muhammad Tariq Qureshi', weekly_periods: 6 },
    { record_id: 'sub_11_chm', class_name: 'Class 11 (1st Year)', name: 'Chemistry Part I', code: 'CHM-11', teacher_name: 'Dr. Shaheen Akhtar', weekly_periods: 6 },
    { record_id: 'sub_11_bio', class_name: 'Class 11 (1st Year)', name: 'Biology Part I', code: 'BIO-11', teacher_name: 'Farhana Yasmeen', weekly_periods: 6 },
    { record_id: 'sub_11_eng', class_name: 'Class 11 (1st Year)', name: 'English Compulsory', code: 'ENG-11', teacher_name: 'Muhammad Imran Khan', weekly_periods: 5 },
    { record_id: 'sub_12_phy', class_name: 'Class 12 (2nd Year)', name: 'Physics Part II', code: 'PHY-12', teacher_name: 'Muhammad Tariq Qureshi', weekly_periods: 6 },
    { record_id: 'sub_12_chm', class_name: 'Class 12 (2nd Year)', name: 'Chemistry Part II', code: 'CHM-12', teacher_name: 'Dr. Shaheen Akhtar', weekly_periods: 6 },
    { record_id: 'sub_12_cs', class_name: 'Class 12 (2nd Year)', name: 'Computer Science Part II', code: 'CS-12', teacher_name: 'Sajid Mehmood', weekly_periods: 6 },
  ];

  counts.subjects = 0;
  for (const sub of subjectsData) {
    await SubjectModel.updateOne(
      { class_name: sub.class_name, name: sub.name },
      { $set: sub },
      { upsert: true }
    );
    counts.subjects++;
  }

  // Teacher Assignments
  const assignments = [
    { record_id: 'ta_demo_01', teacher_id: 'tch_demo_01', teacher_name: 'Muhammad Tariq Qureshi', class_name: 'Class 9', section: 'A', subject: 'Physics', academic_session: '2026-2027', is_class_teacher: true },
    { record_id: 'ta_demo_02', teacher_id: 'tch_demo_01', teacher_name: 'Muhammad Tariq Qureshi', class_name: 'Class 10', section: 'A', subject: 'Physics', academic_session: '2026-2027', is_class_teacher: false },
    { record_id: 'ta_demo_03', teacher_id: 'tch_demo_01', teacher_name: 'Muhammad Tariq Qureshi', class_name: 'Class 11 (1st Year)', section: 'A', subject: 'Physics Part I', academic_session: '2026-2027', is_class_teacher: false },
    { record_id: 'ta_demo_04', teacher_id: 'tch_demo_02', teacher_name: 'Dr. Shaheen Akhtar', class_name: 'Class 9', section: 'A', subject: 'Chemistry', academic_session: '2026-2027', is_class_teacher: false },
    { record_id: 'ta_demo_05', teacher_id: 'tch_demo_02', teacher_name: 'Dr. Shaheen Akhtar', class_name: 'Class 10', section: 'A', subject: 'Chemistry', academic_session: '2026-2027', is_class_teacher: true },
    { record_id: 'ta_demo_06', teacher_id: 'tch_demo_04', teacher_name: 'Sajid Mehmood', class_name: 'Class 9', section: 'B', subject: 'Computer Science', academic_session: '2026-2027', is_class_teacher: false },
    { record_id: 'ta_demo_07', teacher_id: 'tch_demo_05', teacher_name: 'Farhana Yasmeen', class_name: 'Class 9', section: 'A', subject: 'Biology', academic_session: '2026-2027', is_class_teacher: false },
    { record_id: 'ta_demo_08', teacher_id: 'tch_demo_05', teacher_name: 'Farhana Yasmeen', class_name: 'Class 11 (1st Year)', section: 'A', subject: 'Biology Part I', academic_session: '2026-2027', is_class_teacher: true },
    { record_id: 'ta_demo_09', teacher_id: 'tch_demo_06', teacher_name: 'Muhammad Imran Khan', class_name: 'Class 8', section: 'A', subject: 'English', academic_session: '2026-2027', is_class_teacher: true },
    { record_id: 'ta_demo_10', teacher_id: 'tch_demo_07', teacher_name: 'Qazi Noman Ahmad', class_name: 'Class 9', section: 'A', subject: 'Mathematics', academic_session: '2026-2027', is_class_teacher: false },
  ];

  counts.teacher_assignments = 0;
  for (const a of assignments) {
    await TeacherAssignmentModel.updateOne(
      { teacher_id: a.teacher_id, class_name: a.class_name, section: a.section, subject: a.subject, academic_session: a.academic_session },
      { $set: a },
      { upsert: true }
    );
    counts.teacher_assignments++;
  }

  // ============================================================================
  // 4. PARENTS & GUARDIANS (22 Synthetic Records)
  // ============================================================================
  console.log('[Demo Seed] Seeding Parents & Guardians...');
  const parentsData = [
    { record_id: 'par_demo_01', name: 'Tariq Mehmood Qureshi', father_name: 'Abdul Ghaffar Qureshi', phone: '+92 301 7001001', email: 'tariq.parent@shawanschool.edu.pk', occupation: 'Civil Engineer (C&W Dept D.I. Khan)', address: 'Rangpur Road, Paharpur, D.I. Khan' },
    { record_id: 'par_demo_02', name: 'Malik Farooq Ahmad', father_name: 'Malik Khuda Bakhsh', phone: '+92 301 7001002', email: 'farooq.parent@shawanschool.edu.pk', occupation: 'Agriculture Farm Manager', address: 'Near Grain Market, Paharpur' },
    { record_id: 'par_demo_03', name: 'Dr. Muhammad Irfan', father_name: 'Haji Ghulam Rasool', phone: '+92 301 7001003', email: 'irfan.parent@shawanschool.edu.pk', occupation: 'Senior Medical Officer (DHQ Teaching Hospital)', address: 'Main Bazar, Paharpur' },
    { record_id: 'par_demo_04', name: 'Ghulam Murtaza', father_name: 'Muhammad Yaqoob', phone: '+92 301 7001004', email: 'murtaza.parent@shawanschool.edu.pk', occupation: 'Government High School Teacher', address: 'Mohallah Qureshiyan, Paharpur' },
    { record_id: 'par_demo_05', name: 'Syed Zulfiqar Ali Shah', father_name: 'Syed Baqir Shah', phone: '+92 301 7001005', email: 'zulfiqar.parent@shawanschool.edu.pk', occupation: 'Advocate High Court', address: 'Court Road, Paharpur' },
    { record_id: 'par_demo_06', name: 'Javed Iqbal Baloch', father_name: 'Karim Dad Baloch', phone: '+92 301 7001006', email: 'javed.parent@shawanschool.edu.pk', occupation: 'Sub-Divisional Officer (SDO WAPDA)', address: 'Grid Station Colony, Paharpur' },
    { record_id: 'par_demo_07', name: 'Haji Abdul Sattar', father_name: 'Ghulam Qadir', phone: '+92 301 7001007', email: 'sattar.parent@shawanschool.edu.pk', occupation: 'Wholesale Grain Merchant', address: 'Anarkali Bazar, Paharpur' },
    { record_id: 'par_demo_08', name: 'Muhammad Shakeel Khan', father_name: 'Ahmad Khan', phone: '+92 301 7001008', email: 'shakeel.parent@shawanschool.edu.pk', occupation: 'Bank Branch Operations Manager', address: 'Near National Bank, Rangpur Road' },
    { record_id: 'par_demo_09', name: 'Rana Shahid Pervez', father_name: 'Rana Muhammad Afzal', phone: '+92 301 7001009', email: 'shahid.parent@shawanschool.edu.pk', occupation: 'Deputy District Education Officer (Retd)', address: 'Housing Scheme Phase II, D.I. Khan' },
    { record_id: 'par_demo_10', name: 'Noor Muhammad', father_name: 'Atta Muhammad', phone: '+92 301 7001010', email: 'noor.parent@shawanschool.edu.pk', occupation: 'Fertilizer & Pesticide Dealer', address: 'Indus Highway Link Road, Paharpur' },
    { record_id: 'par_demo_11', name: 'Muhammad Asif Gul', father_name: 'Gul Muhammad', phone: '+92 301 7001011', email: 'asif.parent@shawanschool.edu.pk', occupation: 'Senior Software Engineer', address: 'Paharpur Central, D.I. Khan' },
    { record_id: 'par_demo_12', name: 'Malik Khizar Hayat', father_name: 'Malik Rab Nawaz', phone: '+92 301 7001012', email: 'khizar.parent@shawanschool.edu.pk', occupation: 'Transport Fleet Operator', address: 'Bus Terminal Road, Paharpur' },
    { record_id: 'par_demo_13', name: 'Dr. Naveed Akhtar', father_name: 'Akhtar Hussain', phone: '+92 301 7001013', email: 'naveed.parent@shawanschool.edu.pk', occupation: 'Veterinary Officer (Livestock Dept)', address: 'Civil Hospital Road, Paharpur' },
    { record_id: 'par_demo_14', name: 'Muhammad Kamran', father_name: 'Allah Ditta', phone: '+92 301 7001014', email: 'kamran.parent@shawanschool.edu.pk', occupation: 'General Store Merchant', address: 'Sabzi Mandi Chowk, Paharpur' },
    { record_id: 'par_demo_15', name: 'Qari Sanaullah', father_name: 'Maulana Hidayatullah', phone: '+92 301 7001015', email: 'sanaullah.parent@shawanschool.edu.pk', occupation: 'Khateeb & Religious Scholar', address: 'Jamia Masjid Mohallah, Paharpur' },
    { record_id: 'par_demo_16', name: 'Muhammad Bilal Sheikh', father_name: 'Sheikh Nasiruddin', phone: '+92 301 7001016', email: 'bilal.parent@shawanschool.edu.pk', occupation: 'Pharmacy Owner', address: 'Hospital Road, Paharpur' },
    { record_id: 'par_demo_17', name: 'Zahid Mahmood', father_name: 'Fazal Mahmood', phone: '+92 301 7001017', email: 'zahid.parent@shawanschool.edu.pk', occupation: 'Building Contractor', address: 'Circular Road, Paharpur' },
    { record_id: 'par_demo_18', name: 'Bashir Ahmad Khan', father_name: 'Sultan Ahmad', phone: '+92 301 7001018', email: 'bashir.parent@shawanschool.edu.pk', occupation: 'Revenue Patwari (Revenue Dept)', address: 'Tehsil Complex Road, Paharpur' },
    { record_id: 'par_demo_19', name: 'Abdul Majeed', father_name: 'Abdul Aziz', phone: '+92 301 7001019', email: 'majeed.parent@shawanschool.edu.pk', occupation: 'Dairy Farm Proprietor', address: 'Village Band Kurai, Paharpur' },
    { record_id: 'par_demo_20', name: 'Sohail Ahmad Babar', father_name: 'Babar Khan', phone: '+92 301 7001020', email: 'sohail.parent@shawanschool.edu.pk', occupation: 'Senior Auditor (AG Office)', address: 'PAF Colony, D.I. Khan' },
    { record_id: 'par_demo_21', name: 'Mushtaq Ahmad', father_name: 'Muhammad Din', phone: '+92 301 7001021', email: 'mushtaq.parent@shawanschool.edu.pk', occupation: 'Postmaster (Pakistan Post Paharpur)', address: 'Post Office Street, Paharpur' },
    { record_id: 'par_demo_22', name: 'Dr. Tariq Jamil', father_name: 'Muhammad Jamil', phone: '+92 301 7001022', email: 'jamil.parent@shawanschool.edu.pk', occupation: 'Dental Surgeon', address: 'Medical Enclave, Paharpur' },
  ];

  counts.parents = 0;
  for (const p of parentsData) {
    const userId = `usr_demo_${p.record_id}`;
    await UserModel.updateOne(
      { email: p.email },
      {
        $set: {
          record_id: userId,
          email: p.email,
          name: p.name,
          role: 'parent',
          password_hash: defaultParentHash,
          phone: p.phone,
          linked_id: p.record_id,
          linked_student_ids: [],
          status: 'active',
        },
      },
      { upsert: true }
    );

    await ParentModel.updateOne(
      { record_id: p.record_id },
      {
        $set: {
          ...p,
          user_id: userId,
          linked_students: [],
        },
      },
      { upsert: true }
    );
    counts.parents++;
  }

  // ============================================================================
  // 5. STUDENTS (36 Realistic Synthetic Students)
  // ============================================================================
  console.log('[Demo Seed] Seeding Students & Enrollments across Nursery to Class 12...');
  const rawStudents = [
    // Pre-Primary (Nursery & Prep)
    { id: 'std_demo_01', adm: 'ADM-2026-001', roll: '01', name: 'Muhammad Huzaifa', father: 'Tariq Mehmood Qureshi', dob: '2022-03-12', gender: 'Male', cls: 'Nursery', sec: 'A', parIdx: 0 },
    { id: 'std_demo_02', adm: 'ADM-2026-002', roll: '02', name: 'Fatima Malik', father: 'Malik Farooq Ahmad', dob: '2022-05-18', gender: 'Female', cls: 'Nursery', sec: 'A', parIdx: 1 },
    { id: 'std_demo_03', adm: 'ADM-2026-003', roll: '01', name: 'Ayaan Irfan', father: 'Dr. Muhammad Irfan', dob: '2021-04-20', gender: 'Male', cls: 'Prep', sec: 'A', parIdx: 2 },
    { id: 'std_demo_04', adm: 'ADM-2026-004', roll: '02', name: 'Zunaira Murtaza', father: 'Ghulam Murtaza', dob: '2021-07-14', gender: 'Female', cls: 'Prep', sec: 'A', parIdx: 3 },

    // Primary (Classes 1 - 5)
    { id: 'std_demo_05', adm: 'ADM-2026-005', roll: '01', name: 'Syed Ali Haider', father: 'Syed Zulfiqar Ali Shah', dob: '2020-02-10', gender: 'Male', cls: 'Class 1', sec: 'A', parIdx: 4 },
    { id: 'std_demo_06', adm: 'ADM-2026-006', roll: '02', name: 'Khadija Baloch', father: 'Javed Iqbal Baloch', dob: '2020-06-25', gender: 'Female', cls: 'Class 1', sec: 'A', parIdx: 5 },
    { id: 'std_demo_07', adm: 'ADM-2026-007', roll: '01', name: 'Bilal Ahmad Sattar', father: 'Haji Abdul Sattar', dob: '2019-03-15', gender: 'Male', cls: 'Class 2', sec: 'A', parIdx: 6 },
    { id: 'std_demo_08', adm: 'ADM-2026-008', roll: '02', name: 'Mahnoor Shakeel', father: 'Muhammad Shakeel Khan', dob: '2019-09-08', gender: 'Female', cls: 'Class 2', sec: 'A', parIdx: 7 },
    { id: 'std_demo_09', adm: 'ADM-2026-009', roll: '01', name: 'Rana Daniyal Shahid', father: 'Rana Shahid Pervez', dob: '2018-01-22', gender: 'Male', cls: 'Class 3', sec: 'A', parIdx: 8 },
    { id: 'std_demo_10', adm: 'ADM-2026-010', roll: '02', name: 'Anaya Noor', father: 'Noor Muhammad', dob: '2018-08-30', gender: 'Female', cls: 'Class 3', sec: 'A', parIdx: 9 },
    { id: 'std_demo_11', adm: 'ADM-2026-011', roll: '01', name: 'Muhammad Hamza Asif', father: 'Muhammad Asif Gul', dob: '2017-02-14', gender: 'Male', cls: 'Class 4', sec: 'A', parIdx: 10 },
    { id: 'std_demo_12', adm: 'ADM-2026-012', roll: '02', name: 'Ayesha Khizar', father: 'Malik Khizar Hayat', dob: '2017-05-19', gender: 'Female', cls: 'Class 4', sec: 'A', parIdx: 11 },
    { id: 'std_demo_13', adm: 'ADM-2026-013', roll: '03', name: 'Usman Naveed', father: 'Dr. Naveed Akhtar', dob: '2017-10-04', gender: 'Male', cls: 'Class 4', sec: 'A', parIdx: 12 },
    { id: 'std_demo_14', adm: 'ADM-2026-014', roll: '01', name: 'Zohaib Kamran', father: 'Muhammad Kamran', dob: '2016-04-11', gender: 'Male', cls: 'Class 5', sec: 'A', parIdx: 13 },
    { id: 'std_demo_15', adm: 'ADM-2026-015', roll: '02', name: 'Hafsa Sanaullah', father: 'Qari Sanaullah', dob: '2016-06-29', gender: 'Female', cls: 'Class 5', sec: 'A', parIdx: 14 },
    { id: 'std_demo_16', adm: 'ADM-2026-016', roll: '03', name: 'Abdullah Sheikh', father: 'Muhammad Bilal Sheikh', dob: '2016-11-17', gender: 'Male', cls: 'Class 5', sec: 'A', parIdx: 15 },

    // Middle (Classes 6 - 8)
    { id: 'std_demo_17', adm: 'ADM-2026-017', roll: '01', name: 'Muhammad Saad Zahid', father: 'Zahid Mahmood', dob: '2015-01-08', gender: 'Male', cls: 'Class 6', sec: 'A', parIdx: 16 },
    { id: 'std_demo_18', adm: 'ADM-2026-018', roll: '02', name: 'Eman Bashir', father: 'Bashir Ahmad Khan', dob: '2015-07-21', gender: 'Female', cls: 'Class 6', sec: 'A', parIdx: 17 },
    { id: 'std_demo_19', adm: 'ADM-2026-019', roll: '03', name: 'Hamad Majeed', father: 'Abdul Majeed', dob: '2015-12-05', gender: 'Male', cls: 'Class 6', sec: 'A', parIdx: 18 },
    { id: 'std_demo_20', adm: 'ADM-2026-020', roll: '01', name: 'Talha Sohail Babar', father: 'Sohail Ahmad Babar', dob: '2014-03-16', gender: 'Male', cls: 'Class 7', sec: 'A', parIdx: 19 },
    { id: 'std_demo_21', adm: 'ADM-2026-021', roll: '02', name: 'Hira Mushtaq', father: 'Mushtaq Ahmad', dob: '2014-08-27', gender: 'Female', cls: 'Class 7', sec: 'A', parIdx: 20 },
    { id: 'std_demo_22', adm: 'ADM-2026-022', roll: '03', name: 'Waleed Tariq', father: 'Dr. Tariq Jamil', dob: '2014-11-09', gender: 'Male', cls: 'Class 7', sec: 'A', parIdx: 21 },
    { id: 'std_demo_23', adm: 'ADM-2026-023', roll: '01', name: 'Ahmad Tariq Qureshi', father: 'Tariq Mehmood Qureshi', dob: '2013-02-14', gender: 'Male', cls: 'Class 8', sec: 'A', parIdx: 0 },
    { id: 'std_demo_24', adm: 'ADM-2026-024', roll: '02', name: 'Maryam Malik', father: 'Malik Farooq Ahmad', dob: '2013-06-20', gender: 'Female', cls: 'Class 8', sec: 'A', parIdx: 1 },
    { id: 'std_demo_25', adm: 'ADM-2026-025', roll: '03', name: 'Hassan Irfan', father: 'Dr. Muhammad Irfan', dob: '2013-10-18', gender: 'Male', cls: 'Class 8', sec: 'A', parIdx: 2 },

    // Secondary / Matric (Class 9 & 10)
    { id: 'std_demo_26', adm: 'ADM-2026-026', roll: '01', name: 'Muhammad Rayyan Shah', father: 'Syed Zulfiqar Ali Shah', dob: '2012-01-19', gender: 'Male', cls: 'Class 9', sec: 'A', parIdx: 4 },
    { id: 'std_demo_27', adm: 'ADM-2026-027', roll: '02', name: 'Zainab Baloch', father: 'Javed Iqbal Baloch', dob: '2012-04-23', gender: 'Female', cls: 'Class 9', sec: 'A', parIdx: 5 },
    { id: 'std_demo_28', adm: 'ADM-2026-028', roll: '01', name: 'Usama Sattar', father: 'Haji Abdul Sattar', dob: '2012-07-11', gender: 'Male', cls: 'Class 9', sec: 'B', parIdx: 6 },
    { id: 'std_demo_29', adm: 'ADM-2026-029', roll: '02', name: 'Laiba Shakeel', father: 'Muhammad Shakeel Khan', dob: '2012-11-28', gender: 'Female', cls: 'Class 9', sec: 'B', parIdx: 7 },
    { id: 'std_demo_30', adm: 'ADM-2026-030', roll: '01', name: 'Rana Shahmeer Shahid', father: 'Rana Shahid Pervez', dob: '2011-03-05', gender: 'Male', cls: 'Class 10', sec: 'A', parIdx: 8 },
    { id: 'std_demo_31', adm: 'ADM-2026-031', roll: '02', name: 'Aiman Noor', father: 'Noor Muhammad', dob: '2011-06-17', gender: 'Female', cls: 'Class 10', sec: 'A', parIdx: 9 },
    { id: 'std_demo_32', adm: 'ADM-2026-032', roll: '01', name: 'Subhan Asif', father: 'Muhammad Asif Gul', dob: '2011-09-24', gender: 'Male', cls: 'Class 10', sec: 'B', parIdx: 10 },

    // Higher Secondary College (Class 11 & 12)
    { id: 'std_demo_33', adm: 'ADM-2026-033', roll: '01', name: 'Farhan Khizar (Pre-Med)', father: 'Malik Khizar Hayat', dob: '2010-02-18', gender: 'Male', cls: 'Class 11 (1st Year)', sec: 'A', parIdx: 11 },
    { id: 'std_demo_34', adm: 'ADM-2026-034', roll: '02', name: 'Alishba Naveed (Pre-Engg)', father: 'Dr. Naveed Akhtar', dob: '2010-08-12', gender: 'Female', cls: 'Class 11 (1st Year)', sec: 'A', parIdx: 12 },
    { id: 'std_demo_35', adm: 'ADM-2026-035', roll: '01', name: 'Danish Kamran (Pre-Med)', father: 'Muhammad Kamran', dob: '2009-04-15', gender: 'Male', cls: 'Class 12 (2nd Year)', sec: 'A', parIdx: 13 },
    { id: 'std_demo_36', adm: 'ADM-2026-036', roll: '02', name: 'Jawad Sanaullah (ICS)', father: 'Qari Sanaullah', dob: '2009-10-30', gender: 'Male', cls: 'Class 12 (2nd Year)', sec: 'A', parIdx: 14 },
  ];

  counts.students = 0;
  counts.enrollments = 0;

  // Track parent -> students linking
  const parentLinksMap = new Map<string, string[]>();

  for (const s of rawStudents) {
    const parentObj = parentsData[s.parIdx] || parentsData[0];
    const parentUserId = `usr_demo_${parentObj.record_id}`;
    const studentUserId = `usr_demo_std_${s.id}`;
    const studentEmail = `student.${s.id}@student.shawanschool.edu.pk`;

    // 1. Create Student User Account
    await UserModel.updateOne(
      { email: studentEmail },
      {
        $set: {
          record_id: studentUserId,
          email: studentEmail,
          name: s.name,
          role: 'student',
          password_hash: defaultStudentHash,
          phone: parentObj.phone,
          linked_id: s.id,
          status: 'active',
        },
      },
      { upsert: true }
    );

    // 2. Create Student Record
    await StudentModel.updateOne(
      { admission_no: s.adm },
      {
        $set: {
          record_id: s.id,
          admission_no: s.adm,
          roll_no: s.roll,
          full_name: s.name,
          father_name: s.father,
          dob: s.dob,
          gender: s.gender as 'Male' | 'Female',
          class_name: s.cls,
          section: s.sec,
          contact_no: parentObj.phone,
          address: parentObj.address,
          emergency_contact: parentObj.phone,
          admission_date: '2026-01-15',
          academic_status: 'Active',
          parent_user_id: parentUserId,
          user_id: studentUserId,
        },
      },
      { upsert: true }
    );
    counts.students++;

    // 3. Create Enrollment Record
    const enrKey = computeActiveEnrollmentKey(s.id, '2026-2027', 'Active');
    await EnrollmentModel.updateOne(
      { student_id: s.id, academic_year: '2026-2027' },
      {
        $set: {
          record_id: `enr_${s.id}`,
          student_id: s.id,
          student_name: s.name,
          class_name: s.cls,
          section: s.sec,
          academic_year: '2026-2027',
          roll_no: s.roll,
          enrollment_date: '2026-01-15',
          status: 'Active',
          active_enrollment_key: enrKey,
        },
      },
      { upsert: true }
    );
    counts.enrollments++;

    // Add to parent links map
    const currList = parentLinksMap.get(parentObj.record_id) || [];
    currList.push(s.id);
    parentLinksMap.set(parentObj.record_id, currList);
  }

  // Update parents with their linked children
  for (const [parRecId, studentIds] of parentLinksMap.entries()) {
    const parentUserId = `usr_demo_${parRecId}`;
    await ParentModel.updateOne(
      { record_id: parRecId },
      { $set: { linked_students: studentIds } }
    );
    await UserModel.updateOne(
      { record_id: parentUserId },
      { $set: { linked_student_ids: studentIds } }
    );
  }

  // ============================================================================
  // 6. ADMISSION APPLICATIONS (12 Applications)
  // ============================================================================
  console.log('[Demo Seed] Seeding Admission Applications...');
  const admissionsData = [
    { app_no: 'ADM-2026-APP-101', name: 'Zainab Bibi', father: 'Abdul Razzaq', class_app: 'Nursery', prev: 'Home Schooling', phone: '+92 302 5552001', status: 'Approved' as const, date: '2026-01-10' },
    { app_no: 'ADM-2026-APP-102', name: 'Musa Khan', father: 'Muhammad Shafiq', class_app: 'Class 1', prev: 'Al-Huda Model School Paharpur', phone: '+92 302 5552002', status: 'Approved' as const, date: '2026-01-12' },
    { app_no: 'ADM-2026-APP-103', name: 'Fatima Zahra', father: 'Syed Qasim Shah', class_app: 'Class 6', prev: 'Govt Girls High School Paharpur', phone: '+92 302 5552003', status: 'Pending' as const, date: '2026-02-01' },
    { app_no: 'ADM-2026-APP-104', name: 'Bilawal Abbas', father: 'Abbas Ali', class_app: 'Class 9', prev: 'The City Academy D.I. Khan', phone: '+92 302 5552004', status: 'Under Review' as const, date: '2026-02-05' },
    { app_no: 'ADM-2026-APP-105', name: 'Shahmeer Alam', father: 'Alamgir Khan', class_app: 'Class 11 (1st Year)', prev: 'BISE DI Khan Matric Distinction', phone: '+92 302 5552005', status: 'Approved' as const, date: '2026-02-08' },
    { app_no: 'ADM-2026-APP-106', name: 'Mehwish Gul', father: 'Gul Nawaz', class_app: 'Class 9', prev: 'Govt Comprehensive High School', phone: '+92 302 5552006', status: 'Pending' as const, date: '2026-02-10' },
    { app_no: 'ADM-2026-APP-107', name: 'Haris Mehmood', father: 'Arshad Mehmood', class_app: 'Class 8', prev: 'Army Public School D.I. Khan (Transfer)', phone: '+92 302 5552007', status: 'Approved' as const, date: '2026-02-12' },
    { app_no: 'ADM-2026-APP-108', name: 'Maryam Qazi', father: 'Qazi Aslam', class_app: 'Class 10', prev: 'Frontier Science Academy', phone: '+92 302 5552008', status: 'Under Review' as const, date: '2026-02-15' },
    { app_no: 'ADM-2026-APP-109', name: 'Rohail Ahmad', father: 'Nisar Ahmad', class_app: 'Class 11 (1st Year)', prev: 'Paharpur Public High School', phone: '+92 302 5552009', status: 'Pending' as const, date: '2026-02-18' },
    { app_no: 'ADM-2026-APP-110', name: 'Kashif Ali', father: 'Liaquat Ali', class_app: 'Class 5', prev: 'Govt Primary School Band Kurai', phone: '+92 302 5552010', status: 'Rejected' as const, date: '2026-02-20' },
    { app_no: 'ADM-2026-APP-111', name: 'Nimra Tariq', father: 'Tariq Javed', class_app: 'Class 7', prev: 'Oxford Grammar Academy', phone: '+92 302 5552011', status: 'Under Review' as const, date: '2026-02-22' },
    { app_no: 'ADM-2026-APP-112', name: 'Zohaib Hassan', father: 'Hassan Raza', class_app: 'Class 12 (2nd Year)', prev: 'Degree College Paharpur (Migration)', phone: '+92 302 5552012', status: 'Pending' as const, date: '2026-02-25' },
  ];

  counts.admissions = 0;
  for (const adm of admissionsData) {
    const dedupe = computeAdmissionDedupeKey(adm.name, adm.father, adm.class_app, adm.status);
    await AdmissionModel.updateOne(
      { application_no: adm.app_no },
      {
        $set: {
          record_id: `adm_${adm.app_no}`,
          application_no: adm.app_no,
          student_name: adm.name,
          father_name: adm.father,
          dob: '2012-05-10',
          gender: 'Male',
          class_applying: adm.class_app,
          previous_school: adm.prev,
          parent_phone: adm.phone,
          parent_email: `applicant.${adm.app_no.toLowerCase()}@example.com`,
          address: 'Rangpur Road, Paharpur, D.I. Khan',
          documents: [
            { title: 'B-Form Copy', filename: 'b_form.pdf', verified: adm.status === 'Approved' },
            { title: 'School Leaving Certificate', filename: 'slc.pdf', verified: adm.status === 'Approved' },
          ],
          status: adm.status,
          remarks: adm.status === 'Approved' ? 'Merit criteria verified by Admissions Committee.' : adm.status === 'Rejected' ? 'Seat quota in requested section full.' : 'Documents awaiting verification.',
          active_dedupe_key: dedupe,
          created_at: new Date(`${adm.date}T10:00:00Z`),
        },
      },
      { upsert: true }
    );
    counts.admissions++;
  }

  // ============================================================================
  // 7. STUDENT ATTENDANCE (Previous 30 Days + Today)
  // ============================================================================
  console.log('[Demo Seed] Seeding 30-Day Attendance records...');
  counts.attendance = 0;
  const now = new Date();
  const pastDates: string[] = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    // Skip Sundays
    if (d.getUTCDay() === 0) continue;
    pastDates.push(d.toISOString().split('T')[0]);
  }

  // Attendance status distribution helper: ~90% Present, 5% Absent, 5% Leave
  for (const dateStr of pastDates) {
    for (let sIdx = 0; sIdx < rawStudents.length; sIdx++) {
      const s = rawStudents[sIdx];
      // Deterministic hash based on student + date for stable attendance
      const hashVal = (sIdx * 31 + parseInt(dateStr.replace(/-/g, ''), 10)) % 100;
      let status: 'Present' | 'Absent' | 'Leave' = 'Present';
      let remarks = '';
      if (hashVal < 5) {
        status = 'Absent';
        remarks = 'Unexcused absence';
      } else if (hashVal < 9) {
        status = 'Leave';
        remarks = 'Medical leave application on file';
      }

      await AttendanceModel.updateOne(
        { student_id: s.id, date: dateStr },
        {
          $set: {
            record_id: `att_${s.id}_${dateStr.replace(/-/g, '')}`,
            student_id: s.id,
            student_name: s.name,
            class_name: s.cls,
            section: s.sec,
            date: dateStr,
            status,
            remarks,
            marked_by: 'Class Incharge',
            academic_session: '2026-2027',
          },
        },
        { upsert: true }
      );
      counts.attendance++;
    }
  }

  // ============================================================================
  // 8. CLASS TIMETABLES (Monday to Friday, 6 Periods per day)
  // ============================================================================
  console.log('[Demo Seed] Seeding Timetable Schedules...');
  counts.timetable = 0;
  const periods = [
    { start: '08:00', end: '08:45' },
    { start: '08:50', end: '09:35' },
    { start: '09:40', end: '10:25' },
    { start: '10:45', end: '11:30' },
    { start: '11:35', end: '12:20' },
    { start: '12:25', end: '13:10' },
  ];

  const days: Array<'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday'> = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'
  ];

  // Timetables for key demo classes: Class 9, Class 10, Class 11, Class 8
  const timetableTemplates = [
    {
      cls: 'Class 9', sec: 'A', room: 'Senior Hall 301',
      schedule: [
        { subject: 'Physics', teacher: 'Muhammad Tariq Qureshi' },
        { subject: 'Chemistry', teacher: 'Dr. Shaheen Akhtar' },
        { subject: 'Biology', teacher: 'Farhana Yasmeen' },
        { subject: 'Mathematics', teacher: 'Qazi Noman Ahmad' },
        { subject: 'English', teacher: 'Muhammad Imran Khan' },
        { subject: 'Islamiat', teacher: 'Hafiz Abdur Rahman' },
      ],
    },
    {
      cls: 'Class 10', sec: 'A', room: 'Senior Hall 303',
      schedule: [
        { subject: 'Mathematics', teacher: 'Qazi Noman Ahmad' },
        { subject: 'Physics', teacher: 'Muhammad Tariq Qureshi' },
        { subject: 'Chemistry', teacher: 'Dr. Shaheen Akhtar' },
        { subject: 'Biology', teacher: 'Farhana Yasmeen' },
        { subject: 'Pakistan Studies', teacher: 'Rashid Minhas' },
        { subject: 'English', teacher: 'Muhammad Imran Khan' },
      ],
    },
    {
      cls: 'Class 11 (1st Year)', sec: 'A', room: 'Collegiate Block 401',
      schedule: [
        { subject: 'Biology Part I', teacher: 'Farhana Yasmeen' },
        { subject: 'Chemistry Part I', teacher: 'Dr. Shaheen Akhtar' },
        { subject: 'Physics Part I', teacher: 'Muhammad Tariq Qureshi' },
        { subject: 'English Compulsory', teacher: 'Muhammad Imran Khan' },
        { subject: 'Islamic Education', teacher: 'Hafiz Abdur Rahman' },
        { subject: 'Science Practical', teacher: 'Muhammad Tariq Qureshi' },
      ],
    },
    {
      cls: 'Class 8', sec: 'A', room: 'Middle Wing 204',
      schedule: [
        { subject: 'English', teacher: 'Muhammad Imran Khan' },
        { subject: 'Mathematics', teacher: 'Qazi Noman Ahmad' },
        { subject: 'General Science', teacher: 'Muhammad Tariq Qureshi' },
        { subject: 'Computer Education', teacher: 'Sajid Mehmood' },
        { subject: 'Urdu', teacher: 'Bushra Bibi' },
        { subject: 'Islamiat', teacher: 'Hafiz Abdur Rahman' },
      ],
    },
  ];

  for (const tpl of timetableTemplates) {
    for (let dIdx = 0; dIdx < days.length; dIdx++) {
      const day = days[dIdx];
      for (let pIdx = 0; pIdx < periods.length; pIdx++) {
        // Rotate schedule slightly per day so periods vary
        const item = tpl.schedule[(pIdx + dIdx) % tpl.schedule.length];
        const p = periods[pIdx];
        const recId = `tt_${tpl.cls.replace(/[^a-zA-Z0-9]/g, '_')}_${day}_${pIdx}`;

        await TimetableModel.updateOne(
          { class_name: tpl.cls, section: tpl.sec, day, start_time: p.start },
          {
            $set: {
              record_id: recId,
              class_name: tpl.cls,
              section: tpl.sec,
              subject: item.subject,
              teacher_name: item.teacher,
              day,
              start_time: p.start,
              end_time: p.end,
              room: tpl.room,
            },
          },
          { upsert: true }
        );
        counts.timetable++;
      }
    }
  }

  // ============================================================================
  // 9. FEE VOUCHERS & PAYMENT RECORDS
  // ============================================================================
  console.log('[Demo Seed] Seeding Fee Records & Payment History...');
  counts.fees = 0;
  counts.fee_payments = 0;

  const months = ['January 2026', 'February 2026', 'March 2026'];
  for (let mIdx = 0; mIdx < months.length; mIdx++) {
    const month = months[mIdx];
    const monthKeyPart = `2026_${String(mIdx + 1).padStart(2, '0')}`;

    for (let sIdx = 0; sIdx < rawStudents.length; sIdx++) {
      const s = rawStudents[sIdx];
      // Fee amount varies by tier
      let tuition = 3500;
      if (s.cls.includes('Nursery') || s.cls.includes('Prep')) tuition = 2500;
      else if (s.cls.includes('Class 1') || s.cls.includes('Class 2')) tuition = 3000;
      else if (s.cls.includes('Class 9') || s.cls.includes('Class 10')) tuition = 4500;
      else if (s.cls.includes('11') || s.cls.includes('12')) tuition = 5500;

      const totalAmount = tuition;
      let status: 'Paid' | 'Partial' | 'Unpaid' = 'Paid';
      let paidAmount = totalAmount;
      let pendingAmount = 0;

      // Realistic mix: Most paid for Jan/Feb, some partial, some pending in recent month
      const mod = (sIdx + mIdx * 3) % 10;
      if (mIdx === 2 && mod === 0) {
        status = 'Unpaid';
        paidAmount = 0;
        pendingAmount = totalAmount;
      } else if (mIdx === 2 && mod <= 2) {
        status = 'Partial';
        paidAmount = Math.round(totalAmount / 2);
        pendingAmount = totalAmount - paidAmount;
      }

      const voucherId = `VOU-${monthKeyPart}-${s.adm.replace('ADM-', '')}`;
      const paymentHistory: any[] = [];

      if (paidAmount > 0) {
        const receiptNo = `REC-${monthKeyPart}-${s.adm.replace('ADM-', '')}`;
        const payDate = `2026-0${mIdx + 1}-08`;
        paymentHistory.push({
          receipt_no: receiptNo,
          date: payDate,
          amount: paidAmount,
          method: 'Bank Deposit',
          transaction_id: `TXN-NBP-${monthKeyPart}-${sIdx + 100}`,
          notes: 'Full/partial fee deposited at National Bank Paharpur branch.',
        });

        // Also upsert into FeePaymentModel
        await FeePaymentModel.updateOne(
          { receipt_no: receiptNo },
          {
            $set: {
              record_id: `pay_${receiptNo}`,
              receipt_no: receiptNo,
              voucher_id: voucherId,
              student_id: s.id,
              student_name: s.name,
              amount: paidAmount,
              payment_date: payDate,
              payment_method: 'Bank Deposit',
              received_by: 'Accounts Officer',
              transaction_id: `TXN-NBP-${monthKeyPart}-${sIdx + 100}`,
              notes: 'Bank challan verified.',
            },
          },
          { upsert: true }
        );
        counts.fee_payments++;
      }

      await FeeModel.updateOne(
        { student_id: s.id, fee_month: month, year: 2026 },
        {
          $set: {
            voucher_id: voucherId,
            student_id: s.id,
            student_name: s.name,
            class_name: s.cls,
            fee_month: month,
            fee_month_key: `${s.id}_${monthKeyPart}`,
            year: 2026,
            tuition_fee: tuition,
            admission_fee: 0,
            other_charges: 0,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            pending_amount: pendingAmount,
            due_date: `2026-0${mIdx + 1}-15`,
            status,
            payment_history: paymentHistory,
          },
        },
        { upsert: true }
      );
      counts.fees++;
    }
  }

  // ============================================================================
  // 10. EXAMINATIONS & STUDENT RESULTS
  // ============================================================================
  console.log('[Demo Seed] Seeding Examinations & Student Results...');
  counts.exams = 0;
  counts.results = 0;

  const examsData = [
    {
      record_id: 'ex_demo_first_term_2026',
      title: 'First Term Assessment 2026',
      term: 'First Term',
      academic_year: '2026-2027',
      start_date: '2026-03-01',
      end_date: '2026-03-12',
      classes: ['All Classes'],
      status: 'Completed' as const,
    },
    {
      record_id: 'ex_demo_mid_term_2026',
      title: 'Mid-Term Board Preparation Examination 2026',
      term: 'Mid Term',
      academic_year: '2026-2027',
      start_date: '2026-05-15',
      end_date: '2026-05-28',
      classes: ['Class 8', 'Class 9', 'Class 10', 'Class 11 (1st Year)', 'Class 12 (2nd Year)'],
      status: 'Completed' as const,
    },
    {
      record_id: 'ex_demo_final_term_2026',
      title: 'BISE DI Khan Pre-Board Mock Assessment 2026',
      term: 'Annual',
      academic_year: '2026-2027',
      start_date: '2026-11-20',
      end_date: '2026-12-05',
      classes: ['Class 9', 'Class 10', 'Class 11 (1st Year)', 'Class 12 (2nd Year)'],
      status: 'Scheduled' as const,
    },
  ];

  for (const ex of examsData) {
    await ExamModel.updateOne(
      { record_id: ex.record_id },
      { $set: ex },
      { upsert: true }
    );
    counts.exams++;
  }

  // Create Results for Class 9, Class 10, Class 11, Class 8 students under Mid-Term
  const targetResultStudents = rawStudents.filter(s =>
    ['Class 8', 'Class 9', 'Class 10', 'Class 11 (1st Year)', 'Class 12 (2nd Year)'].includes(s.cls)
  );

  for (const s of targetResultStudents) {
    // Generate 5 subjects marks
    const subjs = [
      { subject_name: 'English', total_marks: 100, obtained_marks: 75 + (parseInt(s.roll, 10) * 3) % 20, grade: 'A' },
      { subject_name: 'Urdu', total_marks: 100, obtained_marks: 78 + (parseInt(s.roll, 10) * 4) % 18, grade: 'A' },
      { subject_name: 'Mathematics', total_marks: 100, obtained_marks: 82 + (parseInt(s.roll, 10) * 5) % 16, grade: 'A+' },
      { subject_name: 'Physics', total_marks: 100, obtained_marks: 80 + (parseInt(s.roll, 10) * 2) % 17, grade: 'A' },
      { subject_name: 'Islamiat', total_marks: 50, obtained_marks: 42 + (parseInt(s.roll, 10)) % 7, grade: 'A+' },
    ];

    const totalMarks = subjs.reduce((a, b) => a + b.total_marks, 0);
    const obtainedMarks = subjs.reduce((a, b) => a + b.obtained_marks, 0);
    const percentage = Math.round((obtainedMarks / totalMarks) * 100);
    const overallGrade = percentage >= 85 ? 'A+' : percentage >= 75 ? 'A' : percentage >= 65 ? 'B' : 'C';

    await ResultModel.updateOne(
      { exam_id: 'ex_demo_mid_term_2026', student_id: s.id },
      {
        $set: {
          record_id: `res_mid_${s.id}`,
          exam_id: 'ex_demo_mid_term_2026',
          exam_title: 'Mid-Term Board Preparation Examination 2026',
          student_id: s.id,
          student_name: s.name,
          class_name: s.cls,
          section: s.sec,
          subjects: subjs,
          total_marks: totalMarks,
          obtained_marks: obtainedMarks,
          percentage,
          overall_grade: overallGrade,
          remarks: 'Exceptional academic discipline and board examination conceptual clarity.',
          published: true,
          academic_session: '2026-2027',
        },
      },
      { upsert: true }
    );
    counts.results++;
  }

  // ============================================================================
  // 11. ANNOUNCEMENTS, EVENTS & NOTIFICATIONS
  // ============================================================================
  console.log('[Demo Seed] Seeding Announcements, Events & Notifications...');
  const announcementsData = [
    {
      record_id: 'ann_demo_01',
      title: 'Online Admissions Open for Academic Session 2026–2027',
      content: 'Shawan School & College Paharpur announces admissions open from Playgroup/Nursery up to F.Sc 1st Year (Pre-Medical, Pre-Engineering & ICS). Merit-based scholarships available.',
      category: 'Admissions',
      audience: 'All',
      published: true,
      priority: 'high' as const,
      created_at: new Date('2026-02-01T08:00:00Z'),
    },
    {
      record_id: 'ann_demo_02',
      title: 'BISE D.I. Khan Secondary Board Registration Deadlines',
      content: 'All Grade 9 and Grade 10 students must submit their verified B-Forms and passport photographs to Academic Officer Mr. Rashid Minhas for BISE registration.',
      category: 'Academic',
      audience: 'Students',
      published: true,
      priority: 'normal' as const,
      created_at: new Date('2026-02-15T08:00:00Z'),
    },
    {
      record_id: 'ann_demo_03',
      title: 'Parent-Teacher Council Consultation Session',
      content: 'A scheduled consultation session for parents of Grade 6 through Grade 10 will take place in the Main Auditorium on Saturday from 09:30 AM to 12:30 PM.',
      category: 'General',
      audience: 'Parents',
      published: true,
      priority: 'normal' as const,
      created_at: new Date('2026-02-25T08:00:00Z'),
    },
    {
      record_id: 'ann_demo_04',
      title: 'Annual STEM Science Exhibition & Laboratory Showcase',
      content: 'Students from physics, chemistry, biology and ICT computer groups will demonstrate working scientific prototypes. Parents and local educationists cordially invited.',
      category: 'Events',
      audience: 'All',
      published: true,
      priority: 'high' as const,
      created_at: new Date('2026-03-01T08:00:00Z'),
    },
  ];

  counts.announcements = 0;
  for (const a of announcementsData) {
    await AnnouncementModel.updateOne(
      { record_id: a.record_id },
      { $set: a },
      { upsert: true }
    );
    counts.announcements++;
  }

  const eventsData = [
    {
      record_id: 'ev_demo_01',
      title: 'Annual Athletic Meet & Inter-House Sports Gala',
      description: 'Cricket tournament, 100m sprint, tug-of-war, and gymnastics championship on the natural turf sports ground.',
      date: '2026-03-20',
      time: '08:30 AM',
      location: 'Central Campus Playing Grounds, Paharpur',
      category: 'Sports',
      status: 'Upcoming' as const,
    },
    {
      record_id: 'ev_demo_02',
      title: 'Inter-Collegiate STEM Innovation & Robotics Expo',
      description: 'Senior college students display AI, renewable energy, and biological model exhibitions.',
      date: '2026-04-10',
      time: '09:00 AM',
      location: 'Science & Computer Laboratories Block',
      category: 'Academic',
      status: 'Upcoming' as const,
    },
    {
      record_id: 'ev_demo_03',
      title: 'First Term Parent-Teacher Conference & Progress Distribution',
      description: 'Discussion of first term student performance, character assessments, and individual faculty counseling.',
      date: '2026-04-25',
      time: '09:30 AM',
      location: 'Main Auditorium, Shawan College',
      category: 'General',
      status: 'Upcoming' as const,
    },
  ];

  counts.events = 0;
  for (const e of eventsData) {
    await SchoolEventModel.updateOne(
      { record_id: e.record_id },
      { $set: e },
      { upsert: true }
    );
    counts.events++;
  }

  const notificationsData = [
    { title: 'New Admissions Cycle Open', message: 'Online admission portal is active for academic session 2026–2027.', role: 'all' },
    { title: 'Fee Vouchers Uploaded', message: 'Monthly fee vouchers for current session are available in parent portal.', role: 'parent' },
    { title: 'Syllabus Coverage Audit', message: 'Teachers are requested to verify curriculum completion status before the mock tests.', role: 'teacher' },
  ];

  counts.notifications = 0;
  for (const n of notificationsData) {
    await NotificationModel.updateOne(
      { title: n.title, role: n.role },
      { $set: n },
      { upsert: true }
    );
    counts.notifications++;
  }

  // Audit Log Entry for Seeding Operation
  await AuditLogModel.create({
    user_id: 'system_demo_seeder',
    user_name: 'System Database Seeder',
    role: 'super_admin',
    action: 'Demo Database Seeding Completed',
    entity: 'System',
    entity_id: 'all_demo_collections',
    details: `Idempotent demo seeding completed successfully across ${Object.keys(counts).length} collections.`,
    ip_address: '127.0.0.1',
    created_at: new Date(),
  }).catch(() => {});

  console.log('[Demo Seed] Database seeding finished successfully!');
  console.log('[Demo Seed] Seeded Counts Summary:', counts);

  return { success: true, counts };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('seed-demo-data.ts')) {
  seedDemoDatabase({ force: true })
    .then(res => {
      console.log('[CLI] Demo seeding completed successfully:', JSON.stringify(res.counts, null, 2));
      return closeDB();
    })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[CLI Error] Seeding failed:', sanitizeErrorMessage(err?.message || String(err)));
      return closeDB().catch(() => {}).then(() => process.exit(1));
    });
}
