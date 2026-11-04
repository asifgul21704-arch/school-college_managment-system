/**
 * PHASE 8 — ACADEMIC STRUCTURE MONGODB-AUTHORITATIVE MIGRATION VERIFICATION SUITE
 *
 * Modules Verified:
 *   1. Classes (/api/classes*)
 *   2. Sections (/api/sections*)
 *   3. Subjects (/api/subjects*)
 *   4. Timetable (/api/timetable*)
 *   5. Exams (/api/exams*)
 *   + Secondary dashboard, student detail, result exam-ref, teacher portal & AI queries
 *
 * Runs against an isolated MongoMemoryServer and temporary DB_FILE_PATH / UPLOAD_STORAGE_DIR
 * so real data/db.json and data/uploads/ are NEVER modified.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ROOT_DIR = __dirname;
const REAL_DB_PATH = path.resolve(ROOT_DIR, 'data', 'db.json');
const REAL_UPLOADS_DIR = path.resolve(ROOT_DIR, 'data', 'uploads');

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return 'MISSING';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listDirSnapshot(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = [];
  function walk(curr, rel) {
    for (const item of fs.readdirSync(curr, { withFileTypes: true })) {
      const full = path.join(curr, item.name);
      const nextRel = path.join(rel, item.name);
      if (item.isDirectory()) {
        walk(full, nextRel);
      } else {
        entries.push(`${nextRel}:${sha256File(full)}`);
      }
    }
  }
  walk(dirPath, '');
  return entries.sort();
}

function httpRequest(port, method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = { ...extraHeaders };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers,
      },
      res => {
        let raw = '';
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            // keep raw string
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function waitForHealth(port, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpRequest(port, 'GET', '/api/health');
      if (res.status === 200) return res;
    } catch {
      // retry
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server on port ${port} did not become healthy within ${timeoutMs}ms`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function spawnIsolatedServer(port, envOverrides = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      JWT_SECRET: 'phase8-academic-test-secret-key-2026-secure',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', d => (logs += d.toString()));
  child.stderr.on('data', d => (logs += d.toString()));
  return { child, getLogs: () => logs };
}

async function stopProcess(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve();
    }, 4000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

(async () => {
  const realDbHashBefore = sha256File(REAL_DB_PATH);
  const realUploadsBefore = JSON.stringify(listDirSnapshot(REAL_UPLOADS_DIR));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shawan-phase8-test-'));
  const tmpDbFile = path.join(tmpDir, 'db.json');
  const tmpUploadsDir = path.join(tmpDir, 'uploads');
  fs.mkdirSync(tmpUploadsDir, { recursive: true });
  fs.copyFileSync(REAL_DB_PATH, tmpDbFile);

  const baselineLocalJson = JSON.parse(fs.readFileSync(tmpDbFile, 'utf8'));

  let memMongo = null;
  let srv1 = null;
  let srv2 = null;
  let passed = 0;
  let failed = 0;

  function assert(cond, label, detail = '') {
    if (cond) {
      console.log(`  [PASS] ${label}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${label}${detail ? ' -> ' + detail : ''}`);
      failed++;
    }
  }

  try {
    console.log('==================================================================');
    console.log('PHASE 8 — ACADEMIC STRUCTURE MONGODB MIGRATION VERIFICATION');
    console.log('==================================================================\n');

    memMongo = await MongoMemoryServer.create({
      instance: { dbName: 'shawan_phase8_academic_test' },
    });
    const mongoUri = memMongo.getUri();

    // Launch Server Process #1
    const port1 = await getFreePort();
    srv1 = spawnIsolatedServer(port1, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbFile,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });
    await waitForHealth(port1);

    // Authenticate Admin, Teacher, Parent, and register isolated Student
    const adminLogin = await httpRequest(port1, 'POST', '/api/auth/login', {
      email: 'admin@shawanschool.edu.pk',
      password: 'AdminPassword123!',
    });
    const adminHeaders = { Authorization: `Bearer ${adminLogin.data?.token}` };

    const teacherLogin = await httpRequest(port1, 'POST', '/api/auth/login', {
      email: 'teacher@shawanschool.edu.pk',
      password: 'TeacherPassword123!',
    });
    const teacherHeaders = { Authorization: `Bearer ${teacherLogin.data?.token}` };

    const parentLogin = await httpRequest(port1, 'POST', '/api/auth/login', {
      email: 'parent@shawanschool.edu.pk',
      password: 'ParentPassword123!',
    });
    const parentHeaders = { Authorization: `Bearer ${parentLogin.data?.token}` };

    const studentReg = await httpRequest(port1, 'POST', '/api/auth/register-student', {
      full_name: 'Phase8 Student Tester',
      father_name: 'Phase8 Guardian',
      email: 'phase8.student@example.com',
      password: 'StudentPassword123!',
      confirm_password: 'StudentPassword123!',
      class_name: 'Grade 10 - Matric',
      section: 'A (Science)',
      gender: 'Male',
      dob: '2011-05-15',
      contact_no: '03001112233',
    });
    const studentHeaders = { Authorization: `Bearer ${studentReg.data?.token}` };

    // Record snapshot of academic arrays in temp db.json right after student registration
    const academicSnapshotBeforeWrites = JSON.parse(fs.readFileSync(tmpDbFile, 'utf8'));

    // =========================================================================
    // SECTION A: LEGACY BACKFILL, IDS, ORDERING & IDEMPOTENCY
    // =========================================================================
    console.log('--- SECTION A: LEGACY BACKFILL, IDS & IDEMPOTENCY ---');

    const [initClasses, initSections, initSubjects, initTimetable, initExams] = await Promise.all([
      httpRequest(port1, 'GET', '/api/classes'),
      httpRequest(port1, 'GET', '/api/sections'),
      httpRequest(port1, 'GET', '/api/subjects'),
      httpRequest(port1, 'GET', '/api/timetable'),
      httpRequest(port1, 'GET', '/api/exams'),
    ]);

    assert(
      initClasses.status === 200 &&
        initClasses.data.length === baselineLocalJson.classes.length &&
        initClasses.data[0]?.id === 'cls_01' &&
        initClasses.data.some(c => c.id === 'cls_04' && c.name === 'Grade 9 - Matric') &&
        initSections.status === 200 &&
        initSections.data.length === baselineLocalJson.sections.length &&
        initSections.data.some(s => s.id === 'sec_01' && s.class_name === 'Grade 9 - Matric') &&
        initSubjects.status === 200 &&
        initSubjects.data.length === baselineLocalJson.subjects.length &&
        initSubjects.data.some(s => s.id === 'sb_01' && s.code === 'PHY-10') &&
        initTimetable.status === 200 &&
        initTimetable.data.length === baselineLocalJson.timetable.length &&
        initTimetable.data.some(t => t.id === 'tt_01' && t.subject === 'Physics') &&
        initExams.status === 200 &&
        initExams.data.length === baselineLocalJson.exams.length &&
        initExams.data.some(e => e.id === 'ex_01') &&
        initExams.data.some(e => e.id === 'ex_02'),
      'A1. Legacy backfill preserves exact IDs (cls_*, sec_*, sb_*, tt_*, ex_*), counts, relationships, and ordering'
    );

    // Edit migrated records and delete one legacy class to test backfill idempotency (no overwrite / no resurrection)
    const editLegacyCls = await httpRequest(
      port1,
      'PUT',
      '/api/classes/cls_04',
      { monthly_tuition_fee: 3250, capacity: 48 },
      adminHeaders
    );
    const editLegacySec = await httpRequest(
      port1,
      'PUT',
      '/api/sections/sec_01',
      { room: 'Updated Block-A 101' },
      adminHeaders
    );
    const editLegacySubj = await httpRequest(
      port1,
      'PUT',
      '/api/subjects/sb_01',
      { weekly_periods: 7 },
      adminHeaders
    );
    const editLegacyTt = await httpRequest(
      port1,
      'PUT',
      '/api/timetable/tt_01',
      { room: 'Science Wing 201' },
      adminHeaders
    );
    const editLegacyEx = await httpRequest(
      port1,
      'PUT',
      '/api/exams/ex_01',
      { status: 'Ongoing' },
      adminHeaders
    );
    const deleteLegacyCls = await httpRequest(port1, 'DELETE', '/api/classes/cls_08', undefined, adminHeaders);

    // Trigger manual sync-all while tmpDbFile still has original cls_08 and unedited values
    const syncRes = await httpRequest(port1, 'POST', '/api/mongodb/sync-all', {}, adminHeaders);

    const [afterSyncCls, afterSyncSec, afterSyncSubj, afterSyncTt, afterSyncEx] = await Promise.all([
      httpRequest(port1, 'GET', '/api/classes'),
      httpRequest(port1, 'GET', '/api/sections'),
      httpRequest(port1, 'GET', '/api/subjects'),
      httpRequest(port1, 'GET', '/api/timetable'),
      httpRequest(port1, 'GET', '/api/exams'),
    ]);

    assert(
      editLegacyCls.status === 200 &&
        editLegacySec.status === 200 &&
        editLegacySubj.status === 200 &&
        editLegacyTt.status === 200 &&
        editLegacyEx.status === 200 &&
        deleteLegacyCls.status === 200 &&
        syncRes.status === 200 &&
        afterSyncCls.data.length === baselineLocalJson.classes.length - 1 &&
        !afterSyncCls.data.some(c => c.id === 'cls_08') &&
        afterSyncCls.data.find(c => c.id === 'cls_04')?.monthly_tuition_fee === 3250 &&
        afterSyncSec.data.find(s => s.id === 'sec_01')?.room === 'Updated Block-A 101' &&
        afterSyncSubj.data.find(s => s.id === 'sb_01')?.weekly_periods === 7 &&
        afterSyncTt.data.find(t => t.id === 'tt_01')?.room === 'Science Wing 201' &&
        afterSyncEx.data.find(e => e.id === 'ex_01')?.status === 'Ongoing',
      'A2. Re-running backfill / sync-all does NOT duplicate records, overwrite MongoDB edits, or resurrect deleted records'
    );

    // =========================================================================
    // SECTION B: FULL CRUD, ZERO DUAL-WRITES & RESTART PERSISTENCE
    // =========================================================================
    console.log('\n--- SECTION B: CRUD OPERATIONS, ZERO DUAL-WRITES & SERVER RESTART PERSISTENCE ---');

    const createCls = await httpRequest(
      port1,
      'POST',
      '/api/classes',
      {
        name: '2nd Year (F.Sc Pre-Medical)',
        grade_level: 'Grade 12',
        stream: 'Pre-Medical',
        monthly_tuition_fee: 4800,
        capacity: 50,
        class_teacher: 'Dr. Kamran Shah',
      },
      adminHeaders
    );
    const newClsId = createCls.data?.id;

    const createSec = await httpRequest(
      port1,
      'POST',
      '/api/sections',
      {
        name: 'A',
        class_name: '2nd Year (F.Sc Pre-Medical)',
        capacity: 50,
        room: 'Med Hall 301',
        teacher_name: 'Dr. Kamran Shah',
      },
      adminHeaders
    );
    const newSecId = createSec.data?.id;

    const createSubj = await httpRequest(
      port1,
      'POST',
      '/api/subjects',
      {
        class_name: '2nd Year (F.Sc Pre-Medical)',
        name: 'Advanced Biology',
        code: 'BIO-12',
        teacher_name: 'Dr. Kamran Shah',
        weekly_periods: 6,
        max_marks: 100,
        passing_marks: 33,
      },
      adminHeaders
    );
    const newSubjId = createSubj.data?.id;

    const createTt = await httpRequest(
      port1,
      'POST',
      '/api/timetable',
      {
        class_name: '2nd Year (F.Sc Pre-Medical)',
        section: 'A',
        subject: 'Advanced Biology',
        teacher_name: 'Dr. Kamran Shah',
        day: 'Thursday',
        start_time: '09:00',
        end_time: '09:45',
        room: 'Med Hall 301',
      },
      adminHeaders
    );
    const newTtId = createTt.data?.id;

    const createEx = await httpRequest(
      port1,
      'POST',
      '/api/exams',
      {
        title: 'Pre-Board Send-Up 2027',
        term: 'Send-Up',
        academic_year: '2026-2027',
        start_date: '2027-01-15',
        end_date: '2027-01-28',
        classes: ['2nd Year (F.Sc Pre-Medical)', 'Grade 10 - Matric'],
        status: 'Scheduled',
        max_marks: 550,
        passing_marks: 220,
      },
      adminHeaders
    );
    const newExId = createEx.data?.id;

    assert(
      createCls.status === 201 &&
        createSec.status === 201 &&
        createSubj.status === 201 &&
        createTt.status === 201 &&
        createEx.status === 201 &&
        Boolean(newClsId && newSecId && newSubjId && newTtId && newExId),
      'B1. Admin creates Class, Section, Subject, Timetable entry, and Exam in MongoDB (all 201 Created)'
    );

    // Check zero dual-writes to local db.json
    const academicSnapshotAfterWrites = JSON.parse(fs.readFileSync(tmpDbFile, 'utf8'));
    assert(
      JSON.stringify(academicSnapshotAfterWrites.classes) === JSON.stringify(academicSnapshotBeforeWrites.classes) &&
        JSON.stringify(academicSnapshotAfterWrites.sections) === JSON.stringify(academicSnapshotBeforeWrites.sections) &&
        JSON.stringify(academicSnapshotAfterWrites.subjects) === JSON.stringify(academicSnapshotBeforeWrites.subjects) &&
        JSON.stringify(academicSnapshotAfterWrites.timetable) === JSON.stringify(academicSnapshotBeforeWrites.timetable) &&
        JSON.stringify(academicSnapshotAfterWrites.exams) === JSON.stringify(academicSnapshotBeforeWrites.exams),
      'B2. Zero dual-writes to local db.json across all 5 migrated academic modules'
    );

    // Restart server (Process #1 -> Process #2) and verify persistence
    await stopProcess(srv1.child);
    srv1 = null;

    const port2 = await getFreePort();
    srv2 = spawnIsolatedServer(port2, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbFile,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });
    await waitForHealth(port2);

    const [p2Cls, p2Sec, p2Subj, p2Tt, p2Ex, auditRes] = await Promise.all([
      httpRequest(port2, 'GET', '/api/classes'),
      httpRequest(port2, 'GET', '/api/sections?class_name=' + encodeURIComponent('2nd Year (F.Sc Pre-Medical)')),
      httpRequest(port2, 'GET', '/api/subjects?class_name=' + encodeURIComponent('2nd Year (F.Sc Pre-Medical)')),
      httpRequest(port2, 'GET', '/api/timetable?class_name=' + encodeURIComponent('2nd Year (F.Sc Pre-Medical)')),
      httpRequest(port2, 'GET', '/api/exams?term=Send-Up'),
      httpRequest(port2, 'GET', '/api/audit-logs', undefined, adminHeaders),
    ]);

    const auditList = Array.isArray(auditRes.data) ? auditRes.data : auditRes.data?.logs || auditRes.data?.data || [];
    assert(
      p2Cls.data.some(c => c.id === newClsId && c.monthly_tuition_fee === 4800) &&
        !p2Cls.data.some(c => c.id === 'cls_08') &&
        p2Sec.data.some(s => s.id === newSecId && s.room === 'Med Hall 301') &&
        p2Subj.data.some(s => s.id === newSubjId && s.code === 'BIO-12' && s.max_marks === 100) &&
        p2Tt.data.some(t => t.id === newTtId && t.day === 'Thursday') &&
        p2Ex.data.some(e => e.id === newExId && e.max_marks === 550) &&
        auditList.some(a => a.action === 'Created Class') &&
        auditList.some(a => a.action === 'Created Exam'),
      'B3. Created, updated, deleted records and MongoDB AuditLog entries persist across OS server restart'
    );

    // =========================================================================
    // SECTION C: REFERENCE VALIDATION, NUMERIC BOUNDS, DATES & MARKS
    // =========================================================================
    console.log('\n--- SECTION C: REFERENCE VALIDATION, DATES, MARKS & NUMERIC BOUNDS ---');

    const badClsNegFee = await httpRequest(
      port2,
      'POST',
      '/api/classes',
      { name: 'Invalid Fee Class', monthly_tuition_fee: -500, capacity: 30 },
      adminHeaders
    );
    const badClsZeroCap = await httpRequest(
      port2,
      'POST',
      '/api/classes',
      { name: 'Invalid Cap Class', monthly_tuition_fee: 2000, capacity: 0 },
      adminHeaders
    );
    const dupCls = await httpRequest(
      port2,
      'POST',
      '/api/classes',
      { name: 'grade 9 - matric', monthly_tuition_fee: 3000 },
      adminHeaders
    );
    const badIdFmt = await httpRequest(
      port2,
      'PUT',
      '/api/classes/bad$id!format',
      { capacity: 35 },
      adminHeaders
    );
    assert(
      badClsNegFee.status === 400 &&
        badClsZeroCap.status === 400 &&
        dupCls.status === 409 &&
        badIdFmt.status === 400,
      'C1. Class validation rejects negative fee (400), zero capacity (400), case-insensitive duplicate (409), and malformed ID (400)'
    );

    const badSecUnknownCls = await httpRequest(
      port2,
      'POST',
      '/api/sections',
      { name: 'C', class_name: 'NonExistent Grade 99', capacity: 35 },
      adminHeaders
    );
    const badSecCap = await httpRequest(
      port2,
      'POST',
      '/api/sections',
      { name: 'C', class_name: 'Grade 9 - Matric', capacity: -10 },
      adminHeaders
    );
    const dupSec = await httpRequest(
      port2,
      'POST',
      '/api/sections',
      { name: 'a', class_name: 'Grade 9 - Matric', capacity: 40 },
      adminHeaders
    );
    assert(
      badSecUnknownCls.status === 400 && badSecCap.status === 400 && dupSec.status === 409,
      'C2. Section validation rejects nonexistent class reference (400), negative capacity (400), and duplicate section (409)'
    );

    const badSubjUnknownCls = await httpRequest(
      port2,
      'POST',
      '/api/subjects',
      { class_name: 'NonExistent Grade 99', name: 'Astronomy', weekly_periods: 4 },
      adminHeaders
    );
    const badSubjPeriods = await httpRequest(
      port2,
      'POST',
      '/api/subjects',
      { class_name: 'Grade 9 - Matric', name: 'Astronomy', weekly_periods: 0 },
      adminHeaders
    );
    const badSubjMarks = await httpRequest(
      port2,
      'POST',
      '/api/subjects',
      { class_name: 'Grade 9 - Matric', name: 'Astronomy', weekly_periods: 4, max_marks: 75, passing_marks: 90 },
      adminHeaders
    );
    const dupSubj = await httpRequest(
      port2,
      'POST',
      '/api/subjects',
      { class_name: 'Grade 10 - Matric', name: 'physics', weekly_periods: 5 },
      adminHeaders
    );
    assert(
      badSubjUnknownCls.status === 400 &&
        badSubjPeriods.status === 400 &&
        badSubjMarks.status === 400 &&
        dupSubj.status === 409,
      'C3. Subject validation rejects nonexistent class (400), zero periods (400), passing_marks > max_marks (400), and duplicate subject (409)'
    );

    const badExDate = await httpRequest(
      port2,
      'POST',
      '/api/exams',
      { title: 'Bad Calendar Date Exam', term: 'Mid-Term', start_date: '2026-02-30', end_date: '2026-03-05' },
      adminHeaders
    );
    const badExRange = await httpRequest(
      port2,
      'POST',
      '/api/exams',
      { title: 'Reversed Date Exam', term: 'Mid-Term', start_date: '2026-11-20', end_date: '2026-11-10' },
      adminHeaders
    );
    const badExMarks = await httpRequest(
      port2,
      'POST',
      '/api/exams',
      { title: 'Invalid Marks Exam', term: 'Mid-Term', start_date: '2026-11-10', max_marks: -100 },
      adminHeaders
    );
    const badExPassMarks = await httpRequest(
      port2,
      'POST',
      '/api/exams',
      { title: 'Invalid Pass Exam', term: 'Mid-Term', start_date: '2026-11-10', max_marks: 100, passing_marks: 150 },
      adminHeaders
    );
    const badExUnknownCls = await httpRequest(
      port2,
      'POST',
      '/api/exams',
      { title: 'Unknown Class Exam', term: 'Mid-Term', start_date: '2026-11-10', classes: ['Ghost Class 404'] },
      adminHeaders
    );
    assert(
      badExDate.status === 400 &&
        badExRange.status === 400 &&
        badExMarks.status === 400 &&
        badExPassMarks.status === 400 &&
        badExUnknownCls.status === 400,
      'C4. Exam validation rejects impossible dates (400), end_date < start_date (400), invalid marks (400), and unknown class references (400)'
    );

    // Result reference check against ExamModel
    const resUnknownEx = await httpRequest(
      port2,
      'POST',
      '/api/results',
      {
        exam_id: 'ex_nonexistent_888',
        student_id: 'std_01',
        subjects: [{ subject_name: 'Physics', total_marks: 100, obtained_marks: 88 }],
      },
      adminHeaders
    );
    const resValidMongoEx = await httpRequest(
      port2,
      'POST',
      '/api/results',
      {
        exam_id: newExId,
        student_id: 'std_01',
        subjects: [{ subject_name: 'Physics', total_marks: 100, obtained_marks: 92 }],
      },
      adminHeaders
    );
    assert(
      resUnknownEx.status === 400 && resValidMongoEx.status === 201,
      'C5. POST /api/results validates exam_id against authoritative MongoDB ExamModel (400 unknown, 201 valid)'
    );

    // =========================================================================
    // SECTION D: TIMETABLE TIME PARSING & CONFLICT DETECTION
    // =========================================================================
    console.log('\n--- SECTION D: TIMETABLE VALIDATION & CONFLICT DETECTION ---');

    const badTtCls = await httpRequest(
      port2,
      'POST',
      '/api/timetable',
      { class_name: 'Unknown Class', section: 'A', subject: 'Physics', day: 'Monday', start_time: '08:00', end_time: '08:45' },
      adminHeaders
    );
    const badTtSec = await httpRequest(
      port2,
      'POST',
      '/api/timetable',
      { class_name: 'Grade 9 - Matric', section: 'InvalidSecZ', subject: 'Physics', day: 'Monday', start_time: '11:00', end_time: '11:45' },
      adminHeaders
    );
    const badTtDay = await httpRequest(
      port2,
      'POST',
      '/api/timetable',
      { class_name: 'Grade 9 - Matric', section: 'A', subject: 'Physics', day: 'Funday', start_time: '11:00', end_time: '11:45' },
      adminHeaders
    );
    const badTtReversed = await httpRequest(
      port2,
      'POST',
      '/api/timetable',
      { class_name: 'Grade 9 - Matric', section: 'A', subject: 'Physics', day: 'Monday', start_time: '10:30', end_time: '09:45' },
      adminHeaders
    );
    assert(
      badTtCls.status === 400 &&
        badTtSec.status === 400 &&
        badTtDay.status === 400 &&
        badTtReversed.status === 400,
      'D1. Timetable rejects unknown class (400), undefined section (400), invalid day (400), and end_time <= start_time (400)'
    );

    // tt_01 in legacy data: Grade 10 - Matric, section "A (Science)", Monday 08:00 - 08:45, Prof. Tariq Mahmood
    const conflictClassSlot = await httpRequest(
      port2,
      'POST',
      '/api/timetable',
      {
        class_name: 'Grade 10 - Matric',
        section: 'A (Science)',
        subject: 'Chemistry',
        teacher_name: 'Dr. New Chemist',
        day: 'Monday',
        start_time: '08:15',
        end_time: '09:00',
        room: 'Room 105',
      },
      adminHeaders
    );

    const conflictTeacherSlot = await httpRequest(
      port2,
      'POST',
      '/api/timetable',
      {
        class_name: 'Grade 9 - Matric',
        section: 'B',
        subject: 'Physics',
        teacher_name: 'Prof. Tariq Mahmood',
        day: 'Monday',
        start_time: '08:15',
        end_time: '09:00',
        room: 'Room 102',
      },
      adminHeaders
    );

    // Self-update on newTtId (changing room on same Thursday 09:00-09:45 slot) must succeed without self-conflict
    const selfUpdateTt = await httpRequest(
      port2,
      'PUT',
      `/api/timetable/${newTtId}`,
      { room: 'Med Lab 302' },
      adminHeaders
    );

    assert(
      conflictClassSlot.status === 409 &&
        conflictTeacherSlot.status === 409 &&
        selfUpdateTt.status === 200 &&
        selfUpdateTt.data?.room === 'Med Lab 302',
      'D2. Timetable rejects overlapping Class+Section slot (409) and Teacher double-booking (409), while allowing self-update (200)'
    );

    // =========================================================================
    // SECTION E: ROLE-BASED ACCESS CONTROL (RBAC)
    // =========================================================================
    console.log('\n--- SECTION E: ROLE-BASED ACCESS CONTROL (RBAC) ---');

    const writeEndpoints = [
      ['POST', '/api/classes', { name: 'Unauthorized Class' }],
      ['PUT', `/api/classes/${newClsId}`, { capacity: 55 }],
      ['DELETE', `/api/classes/${newClsId}`],
      ['POST', '/api/sections', { name: 'Z', class_name: 'Grade 9 - Matric' }],
      ['PUT', `/api/sections/${newSecId}`, { capacity: 55 }],
      ['DELETE', `/api/sections/${newSecId}`],
      ['POST', '/api/subjects', { class_name: 'Grade 9 - Matric', name: 'Unauthorized Subj' }],
      ['PUT', `/api/subjects/${newSubjId}`, { weekly_periods: 4 }],
      ['DELETE', `/api/subjects/${newSubjId}`],
      ['POST', '/api/timetable', { class_name: 'Grade 9 - Matric', section: 'A', subject: 'Math', day: 'Saturday', start_time: '11:00', end_time: '11:45' }],
      ['PUT', `/api/timetable/${newTtId}`, { room: 'Hack' }],
      ['DELETE', `/api/timetable/${newTtId}`],
      ['POST', '/api/exams', { title: 'Unauthorized Exam', term: 'Final' }],
      ['PUT', `/api/exams/${newExId}`, { status: 'Completed' }],
      ['DELETE', `/api/exams/${newExId}`],
    ];

    let rbacAllBlocked = true;
    for (const [method, url, payload] of writeEndpoints) {
      const unauth = await httpRequest(port2, method, url, payload);
      const asStudent = await httpRequest(port2, method, url, payload, studentHeaders);
      const asParent = await httpRequest(port2, method, url, payload, parentHeaders);
      const asTeacher = await httpRequest(port2, method, url, payload, teacherHeaders);
      if (
        unauth.status !== 401 ||
        asStudent.status !== 403 ||
        asParent.status !== 403 ||
        asTeacher.status !== 403
      ) {
        rbacAllBlocked = false;
        console.error('RBAC mismatch on', method, url, {
          unauth: unauth.status,
          student: asStudent.status,
          parent: asParent.status,
          teacher: asTeacher.status,
        });
      }
    }

    assert(
      rbacAllBlocked,
      'E1. Unauthenticated (401), Student (403), Parent (403), and Teacher (403) blocked from all 15 academic write endpoints'
    );

    // =========================================================================
    // SECTION F: DASHBOARD, PORTALS, PAGINATION & CLEAN DELETE
    // =========================================================================
    console.log('\n--- SECTION F: DASHBOARD, PORTALS, PAGINATION & DELETE LIFECYCLE ---');

    const [dashStats, pagedClasses, stdDetail, teacherCls, teacherTt, teacherEx, studentAiTt] = await Promise.all([
      httpRequest(port2, 'GET', '/api/dashboard/stats', undefined, adminHeaders),
      httpRequest(port2, 'GET', '/api/classes?paginate=true&page=1&limit=3'),
      httpRequest(port2, 'GET', '/api/students/std_01', undefined, adminHeaders),
      httpRequest(port2, 'GET', '/api/teacher/classes', undefined, teacherHeaders),
      httpRequest(port2, 'GET', '/api/teacher/timetable', undefined, teacherHeaders),
      httpRequest(port2, 'GET', '/api/teacher/exams', undefined, teacherHeaders),
      httpRequest(port2, 'POST', '/api/portal/ai/query', { prompt: 'Show my class timetable schedule' }, studentHeaders),
    ]);

    assert(
      dashStats.status === 200 &&
        dashStats.data?.totalClasses === 8 && // 8 original - 1 deleted + 1 created = 8
        dashStats.data?.totalSections === 5 && // 4 original + 1 created = 5
        pagedClasses.status === 200 &&
        Array.isArray(pagedClasses.data?.data) &&
        pagedClasses.data.data.length === 3 &&
        pagedClasses.data.pagination?.total === 8 &&
        pagedClasses.headers['x-total-count'] === '8',
      'F1. Dashboard stats reflect authoritative MongoDB class/section counts and pagination envelope + headers work accurately'
    );

    assert(
      stdDetail.status === 200 &&
        Array.isArray(stdDetail.data?.timetable) &&
        stdDetail.data.timetable.some(t => t.room === 'Science Wing 201') &&
        teacherCls.status === 200 &&
        Array.isArray(teacherCls.data) &&
        teacherCls.data.length > 0 &&
        teacherTt.status === 200 &&
        teacherTt.data?.timetable?.some(t => t.room === 'Science Wing 201') &&
        teacherEx.status === 200 &&
        teacherEx.data?.some(e => e.id === newExId) &&
        studentAiTt.status === 200 &&
        String(studentAiTt.data?.text || '').includes('Science Wing 201'),
      'F2. Student detail, Student Portal AI, and Teacher Portal (classes, timetable, exams) reflect live MongoDB academic edits'
    );

    // Delete newly created records and verify removal
    const [delTt, delSubj, delSec, delEx, delCls] = await Promise.all([
      httpRequest(port2, 'DELETE', `/api/timetable/${newTtId}`, undefined, adminHeaders),
      httpRequest(port2, 'DELETE', `/api/subjects/${newSubjId}`, undefined, adminHeaders),
      httpRequest(port2, 'DELETE', `/api/sections/${newSecId}`, undefined, adminHeaders),
      httpRequest(port2, 'DELETE', `/api/exams/${newExId}`, undefined, adminHeaders),
      httpRequest(port2, 'DELETE', `/api/classes/${newClsId}`, undefined, adminHeaders),
    ]);
    assert(
      delTt.status === 200 &&
        delSubj.status === 200 &&
        delSec.status === 200 &&
        delEx.status === 200 &&
        delCls.status === 200,
      'F3. Admin deletes newly created Timetable, Subject, Section, Exam, and Class cleanly (all 200 OK)'
    );

    await stopProcess(srv2.child);
    srv2 = null;

    // =========================================================================
    // SECTION G: FAIL-CLOSED HTTP 503 WHEN MONGODB IS UNAVAILABLE & REAL DB SAFETY
    // =========================================================================
    console.log('\n--- SECTION G: FAIL-CLOSED HTTP 503 & REAL DATA SAFETY ---');

    const offlinePort = await getFreePort();
    const offlineScript = `
      import express from 'express';
      import http from 'http';
      import mongoose from 'mongoose';
      process.env.DB_FILE_PATH = ${JSON.stringify(tmpDbFile)};
      process.env.UPLOAD_STORAGE_DIR = ${JSON.stringify(tmpUploadsDir)};
      process.env.JWT_SECRET = 'phase8-academic-test-secret-key-2026-secure';
      const { router } = await import('./server/routes.ts');
      await mongoose.disconnect();
      const app = express();
      app.use(express.json());
      app.use('/api', router);
      const srv = http.createServer(app);
      srv.listen(${offlinePort}, '127.0.0.1', () => console.log('OFFLINE_READY'));
    `;

    const offlineChild = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', offlineScript], {
      cwd: ROOT_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Offline test server timeout')), 15000);
      offlineChild.stdout.on('data', d => {
        if (d.toString().includes('OFFLINE_READY')) {
          clearTimeout(t);
          resolve();
        }
      });
      offlineChild.stderr.on('data', () => {});
    });

    const offlineChecks = await Promise.all([
      httpRequest(offlinePort, 'GET', '/api/classes'),
      httpRequest(offlinePort, 'POST', '/api/classes', { name: 'Offline Class' }, adminHeaders),
      httpRequest(offlinePort, 'GET', '/api/sections'),
      httpRequest(offlinePort, 'POST', '/api/sections', { name: 'A', class_name: 'Grade 9 - Matric' }, adminHeaders),
      httpRequest(offlinePort, 'GET', '/api/subjects'),
      httpRequest(offlinePort, 'POST', '/api/subjects', { name: 'Math', class_name: 'Grade 9 - Matric' }, adminHeaders),
      httpRequest(offlinePort, 'GET', '/api/timetable'),
      httpRequest(offlinePort, 'POST', '/api/timetable', { class_name: 'Grade 9 - Matric', subject: 'Math', day: 'Monday', start_time: '08:00', end_time: '08:45' }, adminHeaders),
      httpRequest(offlinePort, 'GET', '/api/exams'),
      httpRequest(offlinePort, 'POST', '/api/exams', { title: 'Offline Exam', term: 'Mid' }, adminHeaders),
      httpRequest(offlinePort, 'GET', '/api/teacher/classes', undefined, teacherHeaders),
      httpRequest(offlinePort, 'GET', '/api/teacher/timetable', undefined, teacherHeaders),
      httpRequest(offlinePort, 'GET', '/api/teacher/exams', undefined, teacherHeaders),
    ]);

    await stopProcess(offlineChild);

    assert(
      offlineChecks.every(r => r.status === 503),
      'G1. Disconnected MongoDB fails closed with HTTP 503 across all 5 modules & teacher endpoints (zero db.json fallback)'
    );

    const realDbHashAfter = sha256File(REAL_DB_PATH);
    const realUploadsAfter = JSON.stringify(listDirSnapshot(REAL_UPLOADS_DIR));
    assert(
      realDbHashBefore === realDbHashAfter && realUploadsBefore === realUploadsAfter,
      'G2. Real data/db.json and data/uploads/ are 100% untouched (identical SHA-256 checksums)'
    );

    console.log('\n==================================================================');
    console.log(`PHASE 8 ACADEMIC MIGRATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('==================================================================');

    if (failed > 0) process.exitCode = 1;
  } catch (err) {
    console.error('\n[FATAL ERROR IN PHASE 8 TEST SUITE]:', err);
    process.exitCode = 1;
  } finally {
    if (srv1?.child) await stopProcess(srv1.child);
    if (srv2?.child) await stopProcess(srv2.child);
    if (memMongo) {
      try {
        await memMongo.stop();
      } catch {}
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    process.exit(process.exitCode || (failed > 0 ? 1 : 0));
  }
})();
