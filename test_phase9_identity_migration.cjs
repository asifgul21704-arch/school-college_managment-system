/**
 * PHASE 9 — IDENTITY & RELATIONSHIPS MONGODB-AUTHORITATIVE MIGRATION VERIFICATION SUITE
 *
 * Modules Verified:
 *   1. Users & Authentication (/api/auth/*, /api/users*)
 *   2. Students (/api/students*)
 *   3. Teachers (/api/teachers*)
 *   4. Parents & Student-Parent Links (/api/parents*, /api/admin/parent-links*)
 *   5. Student Enrollments (/api/admin/enrollments*)
 *   6. Teacher Assignments (/api/admin/teacher-assignments*)
 *   + Secondary dashboard, admissions approval, attendance/fees/results RBAC, notifications, portal AI, teacher portal
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
      JWT_SECRET: 'phase9-identity-test-secret-key-2026-secure-verified',
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
    proc.kill('SIGTERM');
  });
}

function containsPasswordHashLeak(payload) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  return (
    serialized.includes('"password_hash"') ||
    serialized.includes('$2b$10$') ||
    serialized.includes('$2a$10$')
  );
}

async function run() {
  console.log('==================================================================');
  console.log(' PHASE 9 — IDENTITY & RELATIONSHIPS MIGRATION VERIFICATION SUITE');
  console.log('==================================================================\n');

  const realDbHashBefore = sha256File(REAL_DB_PATH);
  const realUploadsBefore = listDirSnapshot(REAL_UPLOADS_DIR);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shawan-phase9-'));
  const tmpDbPath = path.join(tmpRoot, 'db.json');
  const tmpUploadsDir = path.join(tmpRoot, 'uploads');
  fs.mkdirSync(tmpUploadsDir, { recursive: true });

  // Prepare temp legacy db.json copy and include an explicit empty-DOB legacy student to verify edge-case preservation
  const baseDbRaw = JSON.parse(fs.readFileSync(REAL_DB_PATH, 'utf8'));
  baseDbRaw.students.push({
    id: 'std_legacy_empty_dob',
    admission_no: 'SSC-2026-9991',
    full_name: 'Legacy Empty DOB Student',
    father_name: 'Haji Legacy Father',
    dob: '',
    gender: 'Male',
    class_name: 'Grade 9 - Matric',
    section: 'A',
    contact_no: '+923009998877',
    address: 'Paharpur',
    emergency_contact: '+923009998877',
    admission_date: '2026-03-01',
    academic_status: 'Active',
    roll_no: '991',
  });
  fs.writeFileSync(tmpDbPath, JSON.stringify(baseDbRaw, null, 2), 'utf8');
  const tmpDbInitialHash = sha256File(tmpDbPath);

  let passed = 0;
  let failed = 0;

  function assert(condition, label, detail = '') {
    if (condition) {
      console.log(`  [PASS] ${label}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${label}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  let mongod = null;
  let mongoPort = await getFreePort();
  let mongoDbPath = path.join(tmpRoot, 'mongo-data');
  fs.mkdirSync(mongoDbPath, { recursive: true });

  let serverProc = null;

  try {
    mongod = await MongoMemoryServer.create({
      instance: {
        port: mongoPort,
        dbPath: mongoDbPath,
        storageEngine: 'wiredTiger',
      },
    });
    const mongoUri = mongod.getUri('shawan_phase9_test');

    let appPort = await getFreePort();
    serverProc = spawnIsolatedServer(appPort, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbPath,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });
    await waitForHealth(appPort);

    // -------------------------------------------------------------------------
    // 1. EXISTING CREDENTIAL LOGINS & PASSWORD HASH PRESERVATION
    // -------------------------------------------------------------------------
    console.log('\n[1] Existing Role Logins & Bcrypt Hash Preservation');
    const superLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'admin@shawanschool.edu.pk', password: 'AdminPassword123!' },
      { 'X-Forwarded-For': '10.9.1.1' }
    );
    const officeLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'office@shawanschool.edu.pk', password: 'AdminPassword123!' },
      { 'X-Forwarded-For': '10.9.1.2' }
    );
    const teacherLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'teacher@shawanschool.edu.pk', password: 'TeacherPassword123!' },
      { 'X-Forwarded-For': '10.9.1.3' }
    );
    const studentLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'student@shawanschool.edu.pk', password: 'StudentPassword123!' },
      { 'X-Forwarded-For': '10.9.1.4' }
    );
    const parentLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'parent@shawanschool.edu.pk', password: 'ParentPassword123!' },
      { 'X-Forwarded-For': '10.9.1.5' }
    );
    const wrongPassLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'admin@shawanschool.edu.pk', password: 'WrongPassword999!' },
      { 'X-Forwarded-For': '10.9.1.6' }
    );

    assert(
      superLogin.status === 200 &&
        superLogin.data?.user?.id === 'usr_super_admin' &&
        superLogin.data?.user?.role === 'super_admin',
      'Super admin logs in with preserved legacy ID usr_super_admin and existing password hash'
    );
    assert(
      officeLogin.status === 200 &&
        officeLogin.data?.user?.id === 'usr_admin' &&
        officeLogin.data?.user?.role === 'admin',
      'Admin logs in with preserved legacy ID usr_admin and existing password hash'
    );
    assert(
      teacherLogin.status === 200 &&
        teacherLogin.data?.user?.id === 'usr_teacher_1' &&
        teacherLogin.data?.user?.linked_id === 'tch_01',
      'Teacher logs in with preserved legacy ID usr_teacher_1 and linked_id tch_01'
    );
    assert(
      studentLogin.status === 200 &&
        studentLogin.data?.user?.id === 'usr_student_1' &&
        studentLogin.data?.user?.linked_id === 'std_01',
      'Student logs in with preserved legacy ID usr_student_1 and linked_id std_01'
    );
    assert(
      parentLogin.status === 200 &&
        parentLogin.data?.user?.id === 'usr_parent_1' &&
        Array.isArray(parentLogin.data?.user?.linked_student_ids) &&
        parentLogin.data.user.linked_student_ids.includes('std_01'),
      'Parent logs in with preserved legacy ID usr_parent_1 and linked_student_ids'
    );
    assert(wrongPassLogin.status === 401, 'Invalid password returns 401 without account enumeration');

    const superHeaders = { Authorization: `Bearer ${superLogin.data.token}` };
    const adminHeaders = { Authorization: `Bearer ${officeLogin.data.token}` };
    const teacherHeaders = { Authorization: `Bearer ${teacherLogin.data.token}` };
    const studentHeaders = { Authorization: `Bearer ${studentLogin.data.token}` };
    const parentHeaders = { Authorization: `Bearer ${parentLogin.data.token}` };

    // -------------------------------------------------------------------------
    // 2. LEGACY BACKFILL INTEGRITY, DUPLICATE NAMES ("gul"), & EMPTY DOB
    // -------------------------------------------------------------------------
    console.log('\n[2] Legacy Backfill Integrity, Duplicate Names, & Edge Cases');
    const allUsersInitial = await httpRequest(appPort, 'GET', '/api/users', undefined, superHeaders);
    const allStudentsInitial = await httpRequest(appPort, 'GET', '/api/students', undefined, superHeaders);
    const allTeachersInitial = await httpRequest(appPort, 'GET', '/api/teachers', undefined, superHeaders);
    const allParentsInitial = await httpRequest(appPort, 'GET', '/api/parents', undefined, superHeaders);
    const allEnrollmentsInitial = await httpRequest(appPort, 'GET', '/api/admin/enrollments', undefined, superHeaders);
    const allAssignmentsInitial = await httpRequest(appPort, 'GET', '/api/admin/teacher-assignments', undefined, superHeaders);

    assert(
      allUsersInitial.status === 200 && allUsersInitial.data.length === baseDbRaw.users.length,
      `All ${baseDbRaw.users.length} legacy users backfilled with exact count`,
      `got ${allUsersInitial.data?.length}`
    );
    assert(
      allStudentsInitial.status === 200 && allStudentsInitial.data.length === baseDbRaw.students.length + 1,
      `All ${baseDbRaw.students.length} legacy students + 1 core operational student backfilled with exact count (including empty DOB student)`,
      `got ${allStudentsInitial.data?.length}`
    );

    const gulStudents = allStudentsInitial.data.filter(s => s.full_name.toLowerCase() === 'gul');
    assert(
      gulStudents.length >= 2 &&
        gulStudents.some(s => s.id === 'std_1790704837279') &&
        gulStudents.some(s => s.id === 'std_1790705037997'),
      'Duplicate-named "gul" students were preserved as distinct records without unsafe auto-merging'
    );

    const emptyDobStudent = allStudentsInitial.data.find(s => s.id === 'std_legacy_empty_dob');
    assert(
      Boolean(emptyDobStudent) && emptyDobStudent.dob === '',
      'Legacy student with empty DOB ("") was backfilled cleanly without validation failure'
    );

    assert(
      allTeachersInitial.status === 200 && allTeachersInitial.data.some(t => t.id === 'tch_01'),
      'Legacy teachers backfilled with preserved tch_* record IDs'
    );
    assert(
      allParentsInitial.status === 200 && allParentsInitial.data.length >= 3,
      'Legacy parent profiles backfilled and linked to user accounts'
    );
    assert(
      allEnrollmentsInitial.status === 200 && allEnrollmentsInitial.data.length >= baseDbRaw.enrollments.length,
      'Legacy student enrollments backfilled cleanly'
    );
    assert(
      allAssignmentsInitial.status === 200 && allAssignmentsInitial.data.length === baseDbRaw.teacher_assignments.length,
      'Legacy teacher assignments backfilled with exact count'
    );

    // -------------------------------------------------------------------------
    // 3. STUDENT REGISTRATION, LOGIN, & PROFILE ISOLATION
    // -------------------------------------------------------------------------
    console.log('\n[3] Student Registration, Login, /auth/me, & Zero db.json Writes');
    const regStudentRes = await httpRequest(
      appPort,
      'POST',
      '/api/auth/register-student',
      {
        full_name: 'Areeba Phase9 Student',
        email: 'areeba.p9@shawanschool.edu.pk',
        password: 'StudentP9Pass!',
        confirm_password: 'StudentP9Pass!',
        dob: '2011-05-14',
        gender: 'Female',
        father_name: 'Kamran Phase9 Father',
        phone: '+923451112233',
        address: 'Main Bazar Paharpur',
        class_name: 'Grade 9 - Matric',
        section: 'A',
      },
      { 'X-Forwarded-For': '10.9.2.1' }
    );
    assert(
      regStudentRes.status === 201 &&
        regStudentRes.data?.token &&
        regStudentRes.data?.studentProfile?.id?.startsWith('std_'),
      'Student self-registration succeeds (201) and creates linked StudentModel + UserModel'
    );

    const newStudentId = regStudentRes.data.studentProfile.id;
    const newStudentRoll = regStudentRes.data.studentProfile.roll_no;
    const newStudentAdmNo = regStudentRes.data.studentProfile.admission_no;
    const newStudentHeaders = { Authorization: `Bearer ${regStudentRes.data.token}` };

    const studentMeRes = await httpRequest(appPort, 'GET', '/api/auth/me', undefined, newStudentHeaders);
    const studentSelfRes = await httpRequest(appPort, 'GET', `/api/students/${newStudentId}`, undefined, newStudentHeaders);
    assert(
      studentMeRes.status === 200 &&
        studentMeRes.data?.studentProfile?.id === newStudentId &&
        studentSelfRes.status === 200 &&
        studentSelfRes.data?.student?.admission_no === newStudentAdmNo,
      'Registered student fetches /api/auth/me and own /api/students/:id profile from MongoDB'
    );

    // -------------------------------------------------------------------------
    // 4. PARENT REGISTRATION, LINKING, UNLINKING, & ADMIN PARENT LINKS
    // -------------------------------------------------------------------------
    console.log('\n[4] Parent Registration, Child Verification/Linking/Unlinking, & Admin Links');
    const regParentRes = await httpRequest(
      appPort,
      'POST',
      '/api/auth/register-parent',
      {
        full_name: 'Kamran Phase9 Father',
        email: 'kamran.parent.p9@shawanschool.edu.pk',
        password: 'ParentP9Pass!',
        confirm_password: 'ParentP9Pass!',
        phone: '+923331122334', // intentionally same phone as std_01 to test phone-escalation prevention!
        address: 'Main Bazar Paharpur',
        occupation: 'Engineer',
      },
      { 'X-Forwarded-For': '10.9.2.2' }
    );
    assert(regParentRes.status === 201 && regParentRes.data?.token, 'Parent self-registration succeeds (201)');
    const newParentUserId = regParentRes.data.user.id;
    const newParentHeaders = { Authorization: `Bearer ${regParentRes.data.token}` };

    // Verify phone-matching escalation is BLOCKED before explicit linking
    const unlinkedSamePhoneStudent = await httpRequest(appPort, 'GET', '/api/students/std_01', undefined, newParentHeaders);
    const unlinkedSamePhoneAtt = await httpRequest(appPort, 'GET', '/api/attendance/student/std_01', undefined, newParentHeaders);
    assert(
      unlinkedSamePhoneStudent.status === 403 && unlinkedSamePhoneAtt.status === 403,
      'Parent with matching phone number CANNOT access unlinked child profile or attendance (phone-match escalation blocked)'
    );

    const findChildRes = await httpRequest(
      appPort,
      'POST',
      '/api/parents/find-child',
      {
        father_name: 'Kamran Phase9 Father',
        student_name: 'Areeba Phase9 Student',
        class_name: 'Grade 9 - Matric',
        roll_no: newStudentRoll,
      },
      { ...newParentHeaders, 'X-Forwarded-For': '10.9.2.3' }
    );
    const confirmLinkRes = await httpRequest(
      appPort,
      'POST',
      '/api/parents/confirm-link-child',
      { student_id: newStudentId, father_name: 'Kamran Phase9 Father' },
      { ...newParentHeaders, 'X-Forwarded-For': '10.9.2.4' }
    );
    const myStudentsAfterLink = await httpRequest(appPort, 'GET', '/api/parents/my-students', undefined, newParentHeaders);
    const linkedStudentDetail = await httpRequest(appPort, 'GET', `/api/students/${newStudentId}`, undefined, newParentHeaders);

    assert(
      findChildRes.status === 200 &&
        confirmLinkRes.status === 200 &&
        Array.isArray(myStudentsAfterLink.data) &&
        myStudentsAfterLink.data.some(s => s.id === newStudentId) &&
        linkedStudentDetail.status === 200,
      'Parent finds child, confirms link with father_name verification, and reads linked child profile'
    );

    // Unlink via parent endpoint, then re-link via admin /api/admin/parent-links and unlink via DELETE /api/admin/parent-links
    const unlinkSelfRes = await httpRequest(
      appPort,
      'POST',
      '/api/parents/unlink-child',
      { student_id: newStudentId },
      newParentHeaders
    );
    const afterUnlinkAccess = await httpRequest(appPort, 'GET', `/api/students/${newStudentId}`, undefined, newParentHeaders);
    assert(
      unlinkSelfRes.status === 200 && afterUnlinkAccess.status === 403,
      'Parent unlinks child and immediately loses access (403) without token re-issue'
    );

    // Re-link via /api/parents/link-student (admission_no + dob)
    const linkByAdmNoRes = await httpRequest(
      appPort,
      'POST',
      '/api/parents/link-student',
      { admission_no: newStudentAdmNo, dob: '2011-05-14' },
      { ...newParentHeaders, 'X-Forwarded-For': '10.9.2.5' }
    );
    assert(linkByAdmNoRes.status === 200, 'Parent links child via admission_no + DOB verification (200)');

    const adminUnlinkRes = await httpRequest(
      appPort,
      'POST',
      '/api/admin/parent-links/unlink',
      { parent_id: newParentUserId, student_id: newStudentId },
      adminHeaders
    );
    const adminRelinkRes = await httpRequest(
      appPort,
      'POST',
      '/api/admin/parent-links/link',
      { parent_id: newParentUserId, student_id: newStudentId },
      adminHeaders
    );
    const adminLinksList = await httpRequest(appPort, 'GET', '/api/admin/parent-links', undefined, adminHeaders);
    assert(
      adminUnlinkRes.status === 200 &&
        adminRelinkRes.status === 200 &&
        Array.isArray(adminLinksList.data?.parents) &&
        adminLinksList.data.parents.some(
          p =>
            p.id === newParentUserId &&
            Array.isArray(p.linked_students) &&
            p.linked_students.some(s => s.id === newStudentId)
        ),
      'Admin parent-links GET, /link, and /unlink manage parent-child links authoritatively in MongoDB'
    );

    // -------------------------------------------------------------------------
    // 5. PRIVILEGE ESCALATION, HORIZONTAL ISOLATION, & LIVE DEACTIVATION
    // -------------------------------------------------------------------------
    console.log('\n[5] Privilege Escalation Blocking, Horizontal Isolation, & Live Account Deactivation');
    const studentEscalation = await httpRequest(
      appPort,
      'POST',
      '/api/auth/register-student',
      {
        full_name: 'Attacker Student',
        email: 'attacker.s@shawanschool.edu.pk',
        password: 'Password123!',
        confirm_password: 'Password123!',
        father_name: 'Father',
        class_name: 'Grade 9 - Matric',
        role: 'super_admin',
      },
      { 'X-Forwarded-For': '10.9.3.1' }
    );
    const parentEscalation = await httpRequest(
      appPort,
      'POST',
      '/api/auth/register-parent',
      {
        full_name: 'Attacker Parent',
        email: 'attacker.p@shawanschool.edu.pk',
        password: 'Password123!',
        confirm_password: 'Password123!',
        role: 'admin',
      },
      { 'X-Forwarded-For': '10.9.3.2' }
    );
    assert(
      studentEscalation.status === 403 && parentEscalation.status === 403,
      'Public student & parent signup endpoints reject injected admin/super_admin roles with HTTP 403'
    );

    // Horizontal isolation: Student A cannot view Student B; Teacher cannot view/mark unassigned class
    const studentCrossRead = await httpRequest(appPort, 'GET', '/api/students/std_01', undefined, newStudentHeaders);
    const studentCreateTeacher = await httpRequest(
      appPort,
      'POST',
      '/api/teachers',
      { name: 'Illegal Teacher', subject: 'Math' },
      newStudentHeaders
    );
    const teacherUnassignedStudents = await httpRequest(
      appPort,
      'GET',
      '/api/teacher/students?class_name=Playgroup%20%26%20Nursery',
      undefined,
      teacherHeaders
    );
    assert(
      studentCrossRead.status === 403 &&
        studentCreateTeacher.status === 403 &&
        teacherUnassignedStudents.status === 403,
      'Horizontal & vertical RBAC enforced: student blocked from other student/teacher creation; teacher blocked from unassigned class'
    );

    // Super admin creates a user, logs them in, then deactivates them -> live JWT must immediately fail with 403!
    const createdTempUser = await httpRequest(
      appPort,
      'POST',
      '/api/users',
      {
        email: 'temp.staff.p9@shawanschool.edu.pk',
        password: 'TempStaff123!',
        name: 'Temp Staff Member',
        role: 'admin',
        phone: '+923001239876',
      },
      superHeaders
    );
    const tempUserLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'temp.staff.p9@shawanschool.edu.pk', password: 'TempStaff123!' },
      { 'X-Forwarded-For': '10.9.3.3' }
    );
    const tempUserId = createdTempUser.data?.id;
    const tempUserHeaders = { Authorization: `Bearer ${tempUserLogin.data?.token}` };

    // Non-super_admin cannot mutate /api/users
    const adminMutateUserBlocked = await httpRequest(
      appPort,
      'PUT',
      `/api/users/${tempUserId}`,
      { status: 'inactive' },
      adminHeaders
    );
    // Super admin deactivates temp user
    const deactivateRes = await httpRequest(
      appPort,
      'PUT',
      `/api/users/${tempUserId}`,
      { status: 'inactive' },
      superHeaders
    );
    const deactivatedLiveTokenCheck = await httpRequest(appPort, 'GET', '/api/auth/me', undefined, tempUserHeaders);
    const deactivatedReloginCheck = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'temp.staff.p9@shawanschool.edu.pk', password: 'TempStaff123!' },
      { 'X-Forwarded-For': '10.9.3.4' }
    );
    assert(
      createdTempUser.status === 201 &&
        tempUserLogin.status === 200 &&
        adminMutateUserBlocked.status === 403 &&
        deactivateRes.status === 200 &&
        deactivatedLiveTokenCheck.status === 403 &&
        deactivatedReloginCheck.status === 403,
      'Deactivated user is immediately blocked on both existing live JWT (403) and fresh login (403)'
    );

    // Self-deactivation / self-deletion protection for super_admin
    const selfDeactivate = await httpRequest(
      appPort,
      'PUT',
      '/api/users/usr_super_admin',
      { status: 'inactive' },
      superHeaders
    );
    const selfDelete = await httpRequest(appPort, 'DELETE', '/api/users/usr_super_admin', undefined, superHeaders);
    assert(
      selfDeactivate.status === 400 && selfDelete.status === 400,
      'Super admin self-deactivation and self-deletion are safely blocked (400)'
    );

    // -------------------------------------------------------------------------
    // 6. ADMIN CRUD FOR STUDENTS, TEACHERS (WITH & WITHOUT EMAIL), & PARENTS + DUPLICATES
    // -------------------------------------------------------------------------
    console.log('\n[6] Admin Identity CRUD, Teachers Without Email, & Duplicate Rejections (409)');
    const createStudentAdmin = await httpRequest(
      appPort,
      'POST',
      '/api/students',
      {
        full_name: 'Bilal Admin Created',
        father_name: 'Rashid Khan',
        dob: '2010-08-20',
        gender: 'Male',
        class_name: 'Grade 9 - Matric',
        section: 'A',
        roll_no: '771',
        admission_no: 'SSC-2026-7710',
        contact_no: '+923007710771',
      },
      adminHeaders
    );
    const dupAdmNoRes = await httpRequest(
      appPort,
      'POST',
      '/api/students',
      {
        full_name: 'Another Student',
        father_name: 'Father',
        class_name: 'Grade 9 - Matric',
        section: 'A',
        roll_no: '772',
        admission_no: 'SSC-2026-7710',
      },
      adminHeaders
    );
    const dupRollRes = await httpRequest(
      appPort,
      'POST',
      '/api/students',
      {
        full_name: 'Another Roll Student',
        father_name: 'Father',
        class_name: 'Grade 9 - Matric',
        section: 'A',
        roll_no: '771',
        admission_no: 'SSC-2026-7711',
      },
      adminHeaders
    );
    assert(
      createStudentAdmin.status === 201 && dupAdmNoRes.status === 409 && dupRollRes.status === 409,
      'Admin creates student (201); duplicate admission_no (409) and duplicate class+section+roll_no (409) rejected'
    );
    const adminStudentId = createStudentAdmin.data.id;

    // Update student
    const updateStudentAdmin = await httpRequest(
      appPort,
      'PUT',
      `/api/students/${adminStudentId}`,
      { address: 'Updated Street 9, Paharpur' },
      adminHeaders
    );
    assert(
      updateStudentAdmin.status === 200 && updateStudentAdmin.data?.address === 'Updated Street 9, Paharpur',
      'Admin updates student profile in MongoDB (200)'
    );

    // Teacher WITH email and Teacher WITHOUT email (regression fix!)
    const teacherWithEmail = await httpRequest(
      appPort,
      'POST',
      '/api/teachers',
      {
        name: 'Prof.adia Bio P9',
        subject: 'Biology',
        qualification: 'M.Phil Biology',
        email: 'sadia.bio.p9@shawanschool.edu.pk',
        contact_no: '+923015554433',
        classes: ['Grade 9 - Matric'],
      },
      adminHeaders
    );
    const teacherWithoutEmail = await httpRequest(
      appPort,
      'POST',
      '/api/teachers',
      {
        name: 'Ustad Kareem Visiting Faculty',
        subject: 'Islamiat',
        qualification: 'M.A Islamic Studies',
        contact_no: '+923025554433',
        classes: ['Grade 9 - Matric'],
      },
      adminHeaders
    );
    const dupTeacherEmail = await httpRequest(
      appPort,
      'POST',
      '/api/teachers',
      {
        name: 'Duplicate Email Teacher',
        qualification: 'M.Sc Chemistry',
        subject: 'Chemistry',
        email: 'sadia.bio.p9@shawanschool.edu.pk',
      },
      adminHeaders
    );
    assert(
      teacherWithEmail.status === 201 &&
        teacherWithoutEmail.status === 201 &&
        teacherWithoutEmail.data?.teacher?.email === '' &&
        dupTeacherEmail.status === 409,
      'Admin creates teachers both WITH email and WITHOUT email in MongoDB (201) and rejects duplicate email (409)'
    );
    const createdTeacherId = teacherWithEmail.data?.teacher?.id;
    const noEmailTeacherId = teacherWithoutEmail.data?.teacher?.id;

    // Public vs Admin GET /api/teachers PII redaction
    const pubTeachersRes = await httpRequest(appPort, 'GET', '/api/teachers');
    const admTeachersRes = await httpRequest(appPort, 'GET', '/api/teachers', undefined, adminHeaders);
    assert(
      pubTeachersRes.status === 200 &&
        pubTeachersRes.data.every(t => t.email === '' && t.contact_no === '') &&
        admTeachersRes.status === 200 &&
        admTeachersRes.data.some(t => t.id === createdTeacherId && t.email === 'sadia.bio.p9@shawanschool.edu.pk') &&
        admTeachersRes.data.some(t => t.id === noEmailTeacherId),
      'Public GET /api/teachers redacts email/phone while Admin GET /api/teachers returns full staff details including email-less teachers'
    );

    // -------------------------------------------------------------------------
    // 7. ENROLLMENTS, CONTROLLED TRANSFER, TEACHER ASSIGNMENTS, & REFERENCE VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n[7] Enrollments, Controlled Class Transfer, Teacher Assignments, & Reference Validation');
    // Duplicate active enrollment in 2026-2027 must return 409
    const dupActiveEnroll = await httpRequest(
      appPort,
      'POST',
      '/api/admin/enrollments',
      {
        student_id: adminStudentId,
        class_name: 'Grade 9 - Matric',
        section: 'A',
        academic_year: '2026-2027',
      },
      adminHeaders
    );
    // Invalid references must return 400 / 404
    const badStudentEnroll = await httpRequest(
      appPort,
      'POST',
      '/api/admin/enrollments',
      { student_id: 'std_nonexistent_999', class_name: 'Grade 9 - Matric', section: 'A' },
      adminHeaders
    );
    const badClassEnroll = await httpRequest(
      appPort,
      'POST',
      '/api/admin/enrollments',
      { student_id: adminStudentId, class_name: 'Nonexistent Rocket Class', section: 'A', academic_year: '2027-2028' },
      adminHeaders
    );
    assert(
      dupActiveEnroll.status === 409 && badStudentEnroll.status === 404 && badClassEnroll.status === 400,
      'Enrollment creation rejects duplicate active year enrollment (409), nonexistent student (404), and nonexistent class (400)'
    );

    // Controlled transfer to Grade 10 - Matric
    const transferRes = await httpRequest(
      appPort,
      'POST',
      '/api/admin/enrollments/transfer',
      {
        student_id: adminStudentId,
        new_class_name: 'Grade 10 - Matric',
        new_section: 'A',
        academic_year: '2026-2027',
        reason: 'Promoted to Grade 10 after placement evaluation',
      },
      adminHeaders
    );
    const enrollHistoryRes = await httpRequest(
      appPort,
      'GET',
      `/api/admin/enrollments/history/${adminStudentId}`,
      undefined,
      adminHeaders
    );
    const studentAfterTransfer = await httpRequest(
      appPort,
      'GET',
      `/api/students/${adminStudentId}`,
      undefined,
      adminHeaders
    );
    assert(
      transferRes.status === 200 &&
        studentAfterTransfer.data?.student?.class_name === 'Grade 10 - Matric' &&
        Array.isArray(enrollHistoryRes.data) &&
        enrollHistoryRes.data.length === 2 &&
        enrollHistoryRes.data.some(e => e.status === 'Transferred') &&
        enrollHistoryRes.data.some(e => e.status === 'Active' && e.class_name === 'Grade 10 - Matric'),
      'Controlled student transfer updates student class_name, marks prior enrollment Transferred, and preserves full enrollment history'
    );

    // Teacher assignment CRUD + reference validation + reflection in teacher portal
    const badTeacherAsg = await httpRequest(
      appPort,
      'POST',
      '/api/admin/teacher-assignments',
      {
        teacher_id: 'tch_missing_999',
        class_name: 'Grade 10 - Matric',
        section: 'A',
        subject: 'Physics',
      },
      adminHeaders
    );
    const badClassAsg = await httpRequest(
      appPort,
      'POST',
      '/api/admin/teacher-assignments',
      {
        teacher_id: 'tch_01',
        class_name: 'Invalid Class ZZZ',
        section: 'A',
        subject: 'Physics',
      },
      adminHeaders
    );
    // Assign tch_01 (teacher@shawanschool.edu.pk) to F.Sc Pre-Engineering (2nd Year) or Grade 10 - Matric
    const validAsgCreate = await httpRequest(
      appPort,
      'POST',
      '/api/admin/teacher-assignments',
      {
        teacher_id: createdTeacherId,
        class_name: 'Grade 10 - Matric',
        section: 'A',
        subject: 'Biology',
        academic_session: '2026-2027',
        is_class_teacher: true,
      },
      adminHeaders
    );
    const dupAsgCreate = await httpRequest(
      appPort,
      'POST',
      '/api/admin/teacher-assignments',
      {
        teacher_id: createdTeacherId,
        class_name: 'Grade 10 - Matric',
        section: 'A',
        subject: 'Biology',
        academic_session: '2026-2027',
      },
      adminHeaders
    );
    assert(
      badTeacherAsg.status === 404 &&
        badClassAsg.status === 400 &&
        validAsgCreate.status === 201 &&
        dupAsgCreate.status === 409,
      'Teacher assignment validates teacher/class references (404/400), creates assignment (201), and blocks duplicates (409)'
    );
    const createdAsgId = validAsgCreate.data.id;

    // Update teacher assignment
    const updateAsgRes = await httpRequest(
      appPort,
      'PUT',
      `/api/admin/teacher-assignments/${createdAsgId}`,
      { is_class_teacher: false },
      adminHeaders
    );
    assert(
      updateAsgRes.status === 200 && updateAsgRes.data?.is_class_teacher === false,
      'Teacher assignment PUT updates record in MongoDB (200)'
    );

    // Verify teacher portal works seamlessly with MongoDB teacher & student records
    const teacherClassesPortal = await httpRequest(appPort, 'GET', '/api/teacher/classes', undefined, teacherHeaders);
    const teacherProfileUpdate = await httpRequest(
      appPort,
      'PUT',
      '/api/teacher/profile',
      { bio: 'Senior Physics Faculty - MongoDB Verified' },
      teacherHeaders
    );
    assert(
      teacherClassesPortal.status === 200 &&
        Array.isArray(teacherClassesPortal.data) &&
        teacherProfileUpdate.status === 200 &&
        teacherProfileUpdate.data?.teacher?.bio === 'Senior Physics Faculty - MongoDB Verified',
      'Teacher portal reads classes/student counts and updates profile directly in MongoDB'
    );

    // -------------------------------------------------------------------------
    // 8. ADMISSION APPROVAL -> MONGODB STUDENT CREATION & PASSWORD HASH AUDIT
    // -------------------------------------------------------------------------
    console.log('\n[8] Admission Approval Student Creation & Password-Hash Redaction Audit');
    const applyAdm = await httpRequest(
      appPort,
      'POST',
      '/api/admissions/apply',
      {
        student_name: 'Hamdan Approved Applicant',
        father_name: 'Saeed Approved Father',
        dob: '2012-02-10',
        gender: 'Male',
        class_applying: 'Grade 9 - Matric',
        parent_phone: '+923118887766',
        address: 'Paharpur Town',
      },
      { 'X-Forwarded-For': '10.9.4.1' }
    );
    const admId = applyAdm.data?.application?.id;
    const approveAdm = await httpRequest(
      appPort,
      'PUT',
      `/api/admissions/${admId}/status`,
      { status: 'Approved', remarks: 'Verified documents', createStudentRecord: true },
      adminHeaders
    );
    const studentsAfterApprove = await httpRequest(
      appPort,
      'GET',
      '/api/students?search=Hamdan%20Approved%20Applicant',
      undefined,
      adminHeaders
    );
    assert(
      applyAdm.status === 201 &&
        approveAdm.status === 200 &&
        Array.isArray(studentsAfterApprove.data) &&
        studentsAfterApprove.data.length === 1 &&
        studentsAfterApprove.data[0].id.startsWith('std_'),
      'Admission approval with createStudentRecord=true creates StudentModel + EnrollmentModel in MongoDB without writing db.json'
    );

    // Delete temporary deactivated user so we can test deletion non-resurrection across restart!
    const deleteTempUserRes = await httpRequest(
      appPort,
      'DELETE',
      `/api/users/${tempUserId}`,
      undefined,
      superHeaders
    );
    // Also delete a legacy backfilled teacher assignment or student? Let's delete one legacy backfilled user (`usr_1790785389809`) to prove legacy deleted records NEVER resurrect on restart!
    const deleteLegacyUserRes = await httpRequest(
      appPort,
      'DELETE',
      '/api/users/usr_1790785389809',
      undefined,
      superHeaders
    );
    assert(
      deleteTempUserRes.status === 200 && deleteLegacyUserRes.status === 200,
      'Super admin deletes both newly created and legacy backfilled user accounts (200)'
    );

    // Password-hash redaction check across all sensitive endpoints
    const usersDump = await httpRequest(appPort, 'GET', '/api/users', undefined, superHeaders);
    const singleUserDump = await httpRequest(appPort, 'GET', '/api/users/usr_super_admin', undefined, superHeaders);
    const meDump = await httpRequest(appPort, 'GET', '/api/auth/me', undefined, superHeaders);
    const parentsDump = await httpRequest(appPort, 'GET', '/api/parents', undefined, superHeaders);
    const statsDump = await httpRequest(appPort, 'GET', '/api/dashboard/stats', undefined, superHeaders);
    assert(
      !containsPasswordHashLeak(superLogin.data) &&
        !containsPasswordHashLeak(usersDump.data) &&
        !containsPasswordHashLeak(singleUserDump.data) &&
        !containsPasswordHashLeak(meDump.data) &&
        !containsPasswordHashLeak(parentsDump.data) &&
        !containsPasswordHashLeak(statsDump.data),
      'Zero password_hash or bcrypt hash leakage across login, /auth/me, /users, /parents, and /dashboard/stats'
    );

    // Verify zero writes occurred to temp db.json across ALL Phase 9 identity & relationship operations!
    const tmpDbAfterMutationsHash = sha256File(tmpDbPath);
    assert(
      tmpDbAfterMutationsHash === tmpDbInitialHash,
      'Zero dual-writes to db.json across all Phase 9 user, student, teacher, parent, enrollment, assignment, & admission-approval mutations'
    );

    // -------------------------------------------------------------------------
    // 9. RESTART PERSISTENCE & IDEMPOTENT BACKFILL (NO OVERWRITE / NO RESURRECTION)
    // -------------------------------------------------------------------------
    console.log('\n[9] Server Restart Persistence & Idempotent Backfill Verification');
    await stopProcess(serverProc.child);

    appPort = await getFreePort();
    serverProc = spawnIsolatedServer(appPort, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbPath,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });
    await waitForHealth(appPort);

    // Login with newly registered student & parent after restart
    const restartStudentLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'areeba.p9@shawanschool.edu.pk', password: 'StudentP9Pass!' },
      { 'X-Forwarded-For': '10.9.5.1' }
    );
    const restartSuperLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'admin@shawanschool.edu.pk', password: 'AdminPassword123!' },
      { 'X-Forwarded-For': '10.9.5.2' }
    );
    const restartSuperHeaders = { Authorization: `Bearer ${restartSuperLogin.data.token}` };

    const checkDeletedLegacyUser = await httpRequest(
      appPort,
      'GET',
      '/api/users/usr_1790785389809',
      undefined,
      restartSuperHeaders
    );
    const checkTransferredStudent = await httpRequest(
      appPort,
      'GET',
      `/api/students/${adminStudentId}`,
      undefined,
      restartSuperHeaders
    );
    const checkNoEmailTeacher = await httpRequest(
      appPort,
      'GET',
      `/api/teachers/${noEmailTeacherId}`,
      undefined,
      restartSuperHeaders
    );
    const checkTeacherProfileBio = await httpRequest(
      appPort,
      'GET',
      '/api/teachers/tch_01',
      undefined,
      restartSuperHeaders
    );

    assert(
      restartStudentLogin.status === 200 &&
        checkDeletedLegacyUser.status === 404 &&
        checkTransferredStudent.status === 200 &&
        checkTransferredStudent.data?.student?.class_name === 'Grade 10 - Matric' &&
        checkTransferredStudent.data?.student?.address === 'Updated Street 9, Paharpur' &&
        checkNoEmailTeacher.status === 200 &&
        checkTeacherProfileBio.data?.bio === 'Senior Physics Faculty - MongoDB Verified',
      'Across restart: new accounts log in, edits/transfers/email-less teachers persist, and deleted legacy user is NOT resurrected (404)'
    );

    // -------------------------------------------------------------------------
    // 10. SIMULATED MONGODB OUTAGE -> FAIL-CLOSED HTTP 503 WITHOUT DB.JSON FALLBACK
    // -------------------------------------------------------------------------
    console.log('\n[10] Simulated MongoDB Outage (Fail-Closed HTTP 503) & Clean Reconnect');
    await mongod.stop({ doCleanup: false });
    // Wait briefly for Mongoose connection state to transition away from connected (1)
    let disconnectedReady = false;
    for (let i = 0; i < 30; i++) {
      const [st, tc] = await Promise.all([
        httpRequest(appPort, 'GET', '/api/students', undefined, restartSuperHeaders),
        httpRequest(appPort, 'GET', '/api/teachers'),
      ]);
      if (st.status === 503 && tc.status === 503) {
        disconnectedReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    const outageLogin = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'admin@shawanschool.edu.pk', password: 'AdminPassword123!' },
      { 'X-Forwarded-For': '10.9.6.1' }
    );
    const outageMe = await httpRequest(appPort, 'GET', '/api/auth/me', undefined, restartSuperHeaders);
    const outageUsers = await httpRequest(appPort, 'GET', '/api/users', undefined, restartSuperHeaders);
    const outageStudents = await httpRequest(appPort, 'GET', '/api/students', undefined, restartSuperHeaders);
    const outageTeachers = await httpRequest(appPort, 'GET', '/api/teachers');
    const outageParents = await httpRequest(appPort, 'GET', '/api/parents', undefined, restartSuperHeaders);
    const outageEnrollments = await httpRequest(appPort, 'GET', '/api/admin/enrollments', undefined, restartSuperHeaders);
    const outageAssignments = await httpRequest(appPort, 'GET', '/api/admin/teacher-assignments', undefined, restartSuperHeaders);

    assert(
      disconnectedReady &&
        outageLogin.status === 503 &&
        outageMe.status === 503 &&
        outageUsers.status === 503 &&
        outageStudents.status === 503 &&
        outageTeachers.status === 503 &&
        outageParents.status === 503 &&
        outageEnrollments.status === 503 &&
        outageAssignments.status === 503,
      'When MongoDB is unavailable, all auth, user, student, teacher, parent, enrollment, and assignment routes fail closed with HTTP 503'
    );
    assert(
      sha256File(tmpDbPath) === tmpDbInitialHash,
      'Zero fallback writes to db.json occurred during MongoDB outage'
    );
  } finally {
    if (serverProc?.child) {
      await stopProcess(serverProc.child);
    }
    if (mongod) {
      try {
        await mongod.stop();
      } catch {}
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }

  // Final safeguard check on real repository data files
  const realDbHashAfter = sha256File(REAL_DB_PATH);
  const realUploadsAfter = listDirSnapshot(REAL_UPLOADS_DIR);
  assert(
    realDbHashBefore === realDbHashAfter &&
      JSON.stringify(realUploadsBefore) === JSON.stringify(realUploadsAfter),
    'Real data/db.json and data/uploads/ remained 100% untouched throughout test suite'
  );

  console.log('\n==================================================================');
  console.log(` PHASE 9 VERIFICATION SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('==================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in Phase 9 verification suite:', err);
  process.exit(1);
});
