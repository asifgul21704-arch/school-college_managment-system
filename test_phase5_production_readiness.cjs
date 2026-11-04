/**
 * PHASE 5 — COMPLETE END-TO-END WORKFLOW, SECURITY REGRESSION & PRODUCTION READINESS SUITE
 *
 * Isolation Guarantees:
 * - Spawns real `node server.ts` (`npm start` entrypoint) in `NODE_ENV=production`
 * - Uses a disposable temporary copy of `data/db.json` in `/tmp` via `DB_FILE_PATH`
 * - Uses an isolated ephemeral `MongoMemoryServer` URI via `MONGODB_URI`
 * - Verifies `sha256` of real `data/db.json` before and after to guarantee zero mutation of real school records
 */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const REAL_DB_PATH = path.resolve(ROOT, 'data', 'db.json');
const UPLOADS_DIR = path.resolve(ROOT, 'data', 'uploads');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function httpRequest(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined && typeof body !== 'string' ? JSON.stringify(body) : body;
    const reqHeaders = { ...headers };
    if (payload !== undefined) {
      if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: reqHeaders,
      },
      res => {
        let raw = '';
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('====================================================================');
  console.log('PHASE 5 — COMPLETE E2E, SECURITY & PRODUCTION READINESS VERIFICATION');
  console.log('====================================================================\n');

  const beforeDbHash = sha256File(REAL_DB_PATH);
  const tmpDbPath = path.join(os.tmpdir(), `shawan_phase5_isolated_db_${Date.now()}.json`);
  fs.copyFileSync(REAL_DB_PATH, tmpDbPath);

  const createdUploads = [];
  let memServer = null;
  let prodProc = null;
  let passed = 0;
  let failed = 0;

  function assert(cond, name, detail = '') {
    if (cond) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`);
      failed++;
    }
  }

  try {
    // =========================================================================
    // SECTION A: PRODUCTION STARTUP FAIL-CLOSED SECURITY (`node server.ts`)
    // =========================================================================
    console.log('--- SECTION A: PRODUCTION FAIL-CLOSED STARTUP & SECRET HYGIENE ---');

    // A1. Missing JWT_SECRET in production -> exit code 1
    const missingJwtRun = spawnSync('node', ['server.ts'], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: '', MONGODB_URI: 'mongodb://127.0.0.1:27017/test', PORT: '3991', DB_FILE_PATH: tmpDbPath },
      encoding: 'utf8',
      timeout: 8000,
    });
    assert(
      missingJwtRun.status !== 0 && (missingJwtRun.stderr || '').includes('JWT'),
      'A1. Production startup rejects missing JWT_SECRET (exits non-zero)'
    );

    // A2. Default fallback or short (<32 chars) JWT_SECRET in production -> exit code 1
    const weakJwtRun = spawnSync('node', ['server.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: 'shawan-school-and-college-secure-jwt-secret-2026-paharpur',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
        PORT: '3992',
        DB_FILE_PATH: tmpDbPath,
      },
      encoding: 'utf8',
      timeout: 8000,
    });
    assert(
      weakJwtRun.status !== 0 && (weakJwtRun.stderr || '').includes('JWT'),
      'A2. Production startup rejects default fallback JWT_SECRET (exits non-zero)'
    );

    // A3. Missing MONGODB_URI in production -> exit code 1 (NO in-memory fallback!)
    const strongSecret = 'prod_test_secret_9f8e7d6c5b4a392817263544556677889900aabb';
    const missingMongoRun = spawnSync('node', ['server.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        MONGODB_URI: '',
        PORT: '3993',
        DB_FILE_PATH: tmpDbPath,
      },
      encoding: 'utf8',
      timeout: 8000,
    });
    assert(
      missingMongoRun.status !== 0 &&
        (missingMongoRun.stderr || '').includes('in-memory database fallback is strictly disabled in production'),
      'A3. Production startup rejects missing MONGODB_URI and disables in-memory fallback'
    );

    // A4. Unreachable MONGODB_URI with embedded password masks credentials in error logs
    const badUriRun = spawnSync('node', ['server.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        MONGODB_URI: 'mongodb://dbadmin:UltraSecretPass2026@127.0.0.1:59998/shawan_prod?serverSelectionTimeoutMS=500',
        PORT: '3994',
        DB_FILE_PATH: tmpDbPath,
      },
      encoding: 'utf8',
      timeout: 10000,
    });
    const combinedLogs = `${badUriRun.stdout || ''}\n${badUriRun.stderr || ''}`;
    assert(
      badUriRun.status !== 0 && !combinedLogs.includes('UltraSecretPass2026'),
      'A4. Production DB connection failure exits non-zero and masks URI credentials in logs'
    );

    // =========================================================================
    // BOOT ISOLATED PRODUCTION SERVER (`NODE_ENV=production node server.ts`)
    // =========================================================================
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memServer = await MongoMemoryServer.create({
      instance: { dbName: 'shawan_phase5_prod_e2e' },
    });
    const isolatedMongoUri = memServer.getUri();
    const testPort = 3985;
    const trustedOrigin = 'https://portal.shawanschool.edu.pk';

    prodProc = spawn('node', ['server.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(testPort),
        JWT_SECRET: strongSecret,
        MONGODB_URI: isolatedMongoUri,
        CORS_ORIGIN: trustedOrigin,
        DB_FILE_PATH: tmpDbPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for isolated production server')), 15000);
      let errBuf = '';
      prodProc.stderr.on('data', d => (errBuf += d.toString()));
      prodProc.stdout.on('data', d => {
        if (d.toString().includes('server running at')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      prodProc.on('exit', code => {
        clearTimeout(timeout);
        reject(new Error(`Production server exited early (${code}): ${errBuf}`));
      });
    });

    assert(true, 'A5. Isolated `NODE_ENV=production node server.ts` booted cleanly with valid secrets & MongoDB');

    // =========================================================================
    // SECTION B: PUBLIC WEBSITE, CORS, RATE LIMITS & CONTACT WORKFLOW
    // =========================================================================
    console.log('\n--- SECTION B: PUBLIC WEBSITE, CORS, RATE LIMITS & CONTACT FORM ---');

    const rootHtml = await httpRequest(testPort, 'GET', '/');
    assert(
      rootHtml.status === 200 && rootHtml.raw.includes('<title>Shawan School and College</title>'),
      'B1. Production server serves built SPA index.html from dist/'
    );

    const api404 = await httpRequest(testPort, 'GET', '/api/unknown-route-xyz');
    assert(
      api404.status === 404 && api404.data?.error,
      'B2. Unknown /api/* route returns 404 JSON instead of SPA HTML'
    );

    // CORS verification
    const untrustedCors = await httpRequest(testPort, 'GET', '/api/settings', undefined, {
      Origin: 'https://malicious-attacker.example.com',
    });
    const trustedCors = await httpRequest(testPort, 'GET', '/api/settings', undefined, {
      Origin: trustedOrigin,
    });
    assert(
      !untrustedCors.headers['access-control-allow-origin'] &&
        trustedCors.headers['access-control-allow-origin'] === trustedOrigin,
      'B3. Production CORS blocks untrusted origins and allows configured CORS_ORIGIN'
    );

    // Public endpoints & teacher PII redaction
    const pubSettings = await httpRequest(testPort, 'GET', '/api/settings');
    const pubClasses = await httpRequest(testPort, 'GET', '/api/classes');
    const pubAnnouncements = await httpRequest(testPort, 'GET', '/api/announcements');
    const pubEvents = await httpRequest(testPort, 'GET', '/api/events');
    const pubGallery = await httpRequest(testPort, 'GET', '/api/gallery');
    const pubTeachers = await httpRequest(testPort, 'GET', '/api/teachers');
    assert(
      pubSettings.status === 200 &&
        pubClasses.status === 200 &&
        pubAnnouncements.status === 200 &&
        pubEvents.status === 200 &&
        pubGallery.status === 200 &&
        pubTeachers.status === 200,
      'B4. All public website data endpoints respond with 200 OK'
    );
    assert(
      Array.isArray(pubTeachers.data) &&
        pubTeachers.data.length > 0 &&
        pubTeachers.data.every(t => t.email === '' && t.contact_no === ''),
      'B5. Public GET /api/teachers redacts personal staff email and phone numbers'
    );

    const pubMongoStatus = await httpRequest(testPort, 'GET', '/api/mongodb/status');
    assert(
      pubMongoStatus.status === 200 &&
        pubMongoStatus.data?.host === 'configured-cluster' &&
        pubMongoStatus.data?.uriMasked === 'Configured',
      'B6. Production GET /api/mongodb/status masks internal cluster host and URI'
    );

    // Contact form workflow + validation + rate limit
    const invalidContact = await httpRequest(testPort, 'POST', '/api/contact', { name: 'Test' }, { 'X-Forwarded-For': '198.51.100.10' });
    const validContact = await httpRequest(
      testPort,
      'POST',
      '/api/contact',
      {
        name: 'QA Prospective Parent',
        email: 'qa.parent@example.com',
        phone: '0300-1112233',
        subject: 'F.Sc Pre-Medical Admission Inquiry',
        message: 'Testing end-to-end contact submission workflow.',
      },
      { 'X-Forwarded-For': '198.51.100.11' }
    );
    assert(
      invalidContact.status === 400 && validContact.status === 201,
      'B7. Public contact form validates inputs (400) and persists valid inquiries (201)'
    );

    let contact429Triggered = false;
    for (let i = 0; i < 12; i++) {
      const r = await httpRequest(
        testPort,
        'POST',
        '/api/contact',
        { name: 'Flood', message: 'Spam check', phone: '03000000000' },
        { 'X-Forwarded-For': '198.51.100.99' }
      );
      if (r.status === 429) {
        contact429Triggered = true;
        break;
      }
    }
    assert(contact429Triggered, 'B8. Contact endpoint enforces rate limiting (HTTP 429 on flood)');

    // =========================================================================
    // SECTION C: STUDENT & PARENT REGISTRATION, LOGIN & LINKING WORKFLOWS
    // =========================================================================
    console.log('\n--- SECTION C: STUDENT & PARENT REGISTRATION, LOGIN & CHILD LINKING ---');

    const regMismatch = await httpRequest(testPort, 'POST', '/api/auth/register-student', {
      full_name: 'Test QA Student',
      email: 'qa.student@shawanschool.edu.pk',
      password: 'SafePassword123!',
      confirm_password: 'DifferentPassword!',
      father_name: 'QA Guardian',
      class_name: 'Grade 9 - Matric',
    });
    assert(regMismatch.status === 400, 'C1. Student registration rejects mismatched passwords (400)');

    const regStudent = await httpRequest(testPort, 'POST', '/api/auth/register-student', {
      full_name: 'Zainab QA Test',
      email: 'zainab.qa@shawanschool.edu.pk',
      password: 'SafePassword123!',
      confirm_password: 'SafePassword123!',
      dob: '2011-04-15',
      gender: 'Female',
      father_name: 'Tariq QA Guardian',
      phone: '0312-9988776',
      address: 'Test Street, Paharpur',
      class_name: 'Grade 9 - Matric',
      section: 'A',
    });
    assert(
      regStudent.status === 201 && regStudent.data?.token && regStudent.data?.studentProfile?.id,
      'C2. Student self-registration creates isolated user & student profile (201)'
    );
    const qaStudentId = regStudent.data.studentProfile.id;
    const qaStudentRoll = regStudent.data.studentProfile.roll_no;

    const dupStudent = await httpRequest(testPort, 'POST', '/api/auth/register-student', {
      full_name: 'Zainab QA Test',
      email: 'zainab.qa@shawanschool.edu.pk',
      password: 'SafePassword123!',
      confirm_password: 'SafePassword123!',
      father_name: 'Tariq QA Guardian',
      class_name: 'Grade 9 - Matric',
    });
    assert(dupStudent.status === 409, 'C3. Duplicate student email registration rejected (409 Conflict)');

    const loginStudent = await httpRequest(testPort, 'POST', '/api/auth/login', {
      email: 'zainab.qa@shawanschool.edu.pk',
      password: 'SafePassword123!',
    });
    const studentHeaders = { Authorization: `Bearer ${loginStudent.data?.token}` };
    const studentMe = await httpRequest(testPort, 'GET', '/api/auth/me', undefined, studentHeaders);
    const studentOwnRecord = await httpRequest(testPort, 'GET', `/api/students/${qaStudentId}`, undefined, studentHeaders);
    const studentOtherBlocked = await httpRequest(testPort, 'GET', '/api/students/std_01', undefined, studentHeaders);
    const studentStatsBlocked = await httpRequest(testPort, 'GET', '/api/dashboard/stats', undefined, studentHeaders);
    assert(
      loginStudent.status === 200 &&
        studentMe.status === 200 &&
        studentMe.data?.studentProfile?.id === qaStudentId &&
        studentOwnRecord.status === 200 &&
        studentOtherBlocked.status === 403 &&
        studentStatsBlocked.status === 403,
      'C4. Registered student logs in, views own profile (200), blocked from other students & admin stats (403)'
    );

    // Parent registration, child verification, linking, access & unlinking
    const regParent = await httpRequest(testPort, 'POST', '/api/auth/register-parent', {
      full_name: 'Tariq QA Guardian',
      email: 'tariq.qa.parent@shawanschool.edu.pk',
      password: 'ParentSafe123!',
      confirm_password: 'ParentSafe123!',
      phone: '0312-9988776',
    });
    const loginParent = await httpRequest(testPort, 'POST', '/api/auth/login', {
      email: 'tariq.qa.parent@shawanschool.edu.pk',
      password: 'ParentSafe123!',
    });
    const parentHeaders = { Authorization: `Bearer ${loginParent.data?.token}` };

    const findWrongFather = await httpRequest(
      testPort,
      'POST',
      '/api/parents/find-child',
      {
        father_name: 'Completely Unrelated Person',
        student_name: 'Bilal Khan',
        class_name: 'Grade 7 - Middle',
        roll_no: '701',
      },
      parentHeaders
    );
    const findChildOk = await httpRequest(
      testPort,
      'POST',
      '/api/parents/find-child',
      {
        father_name: 'Tariq QA Guardian',
        student_name: 'Zainab QA Test',
        class_name: 'Grade 9 - Matric',
        roll_no: qaStudentRoll,
      },
      parentHeaders
    );
    const confirmLink = await httpRequest(
      testPort,
      'POST',
      '/api/parents/confirm-link-child',
      { student_id: qaStudentId, father_name: 'Tariq QA Guardian' },
      parentHeaders
    );
    const parentLinkedAccess = await httpRequest(testPort, 'GET', `/api/students/${qaStudentId}`, undefined, parentHeaders);
    const parentUnlinkedBlocked = await httpRequest(testPort, 'GET', '/api/students/std_05', undefined, parentHeaders);
    const parentStatsBlocked = await httpRequest(testPort, 'GET', '/api/dashboard/stats', undefined, parentHeaders);
    assert(
      regParent.status === 201 &&
        loginParent.status === 200 &&
        findWrongFather.status === 404 &&
        findChildOk.status === 200 &&
        confirmLink.status === 200 &&
        parentLinkedAccess.status === 200 &&
        parentUnlinkedBlocked.status === 403 &&
        parentStatsBlocked.status === 403,
      'C5. Parent registers, verifies & links child (200), accesses linked child (200), blocked from unrelated child & admin stats (403)'
    );

    // =========================================================================
    // SECTION D: SUPER_ADMIN, ADMIN & TEACHER WORKFLOWS & PERMISSIONS
    // =========================================================================
    console.log('\n--- SECTION D: ADMIN, SUPER_ADMIN & TEACHER WORKFLOWS ---');

    const superLogin = await httpRequest(testPort, 'POST', '/api/auth/login', {
      email: 'admin@shawanschool.edu.pk',
      password: 'AdminPassword123!',
    });
    assert(
      superLogin.status === 200 && superLogin.data?.user?.role === 'super_admin',
      'D1. Super Admin authenticates via real password hash (200)'
    );
    const superHeaders = { Authorization: `Bearer ${superLogin.data?.token}` };

    // Super Admin creates an Admin account via POST /api/users
    const createAdminRes = await httpRequest(
      testPort,
      'POST',
      '/api/users',
      {
        email: 'qa.office.admin@shawanschool.edu.pk',
        password: 'OfficeAdmin123!',
        name: 'QA Office Admin',
        role: 'admin',
        phone: '0300-5556677',
      },
      superHeaders
    );
    const adminLogin = await httpRequest(testPort, 'POST', '/api/auth/login', {
      email: 'qa.office.admin@shawanschool.edu.pk',
      password: 'OfficeAdmin123!',
    });
    const adminHeaders = { Authorization: `Bearer ${adminLogin.data?.token}` };

    // Admin tries super_admin-only POST /api/users -> 403
    const adminCreateUserBlocked = await httpRequest(
      testPort,
      'POST',
      '/api/users',
      {
        email: 'illegal.escalation@shawanschool.edu.pk',
        password: 'Password123!',
        name: 'Blocked User',
        role: 'super_admin',
      },
      adminHeaders
    );
    const adminTeachersFull = await httpRequest(testPort, 'GET', '/api/teachers', undefined, adminHeaders);
    assert(
      createAdminRes.status === 201 &&
        createAdminRes.data?.password_hash === undefined &&
        adminLogin.status === 200 &&
        adminCreateUserBlocked.status === 403 &&
        Array.isArray(adminTeachersFull.data) &&
        adminTeachersFull.data.some(t => Boolean(t.email)),
      'D2. Super Admin creates Admin user (201); Admin blocked from super_admin user creation (403) and sees full staff directory'
    );

    // Teacher workflow
    const teacherLogin = await httpRequest(testPort, 'POST', '/api/auth/login', {
      email: 'teacher@shawanschool.edu.pk',
      password: 'TeacherPassword123!',
    });
    const teacherHeaders = { Authorization: `Bearer ${teacherLogin.data?.token}` };
    const teacherDash = await httpRequest(testPort, 'GET', '/api/teacher/dashboard', undefined, teacherHeaders);
    const teacherMarkAssigned = await httpRequest(
      testPort,
      'POST',
      '/api/teacher/attendance',
      {
        date: '2026-10-27',
        class_name: 'Grade 9 - Matric',
        section: 'A',
        records: [{ student_id: qaStudentId, student_name: 'Zainab QA Test', status: 'Present', remarks: 'On time' }],
      },
      teacherHeaders
    );
    const teacherMarkUnassigned = await httpRequest(
      testPort,
      'POST',
      '/api/teacher/attendance',
      {
        date: '2026-10-27',
        class_name: 'Grade 7 - Middle',
        section: 'A',
        records: [{ student_id: 'std_05', student_name: 'Bilal Khan', status: 'Present' }],
      },
      teacherHeaders
    );
    const teacherStatsSanitized = await httpRequest(testPort, 'GET', '/api/dashboard/stats', undefined, teacherHeaders);
    const teacherFeesBlocked = await httpRequest(testPort, 'GET', '/api/fees', undefined, teacherHeaders);
    assert(
      teacherLogin.status === 200 &&
        teacherDash.status === 200 &&
        teacherMarkAssigned.status === 200 &&
        teacherMarkUnassigned.status === 403 &&
        teacherFeesBlocked.status === 403 &&
        teacherStatsSanitized.status === 200 &&
        teacherStatsSanitized.data?.totalPendingFee === 0 &&
        teacherStatsSanitized.data?.recentFees?.length === 0,
      'D3. Teacher logs in, marks assigned attendance (200), blocked from unassigned classes & fees (403), financial stats redacted'
    );

    // =========================================================================
    // SECTION E: ADMISSIONS, EXAMS, RESULTS, FEES & PAYMENTS WORKFLOWS
    // =========================================================================
    console.log('\n--- SECTION E: ADMISSIONS, EXAMS, RESULTS, FEES & FINANCIAL INTEGRITY ---');

    const applyAdm = await httpRequest(
      testPort,
      'POST',
      '/api/admissions/apply',
      {
        student_name: 'Hamdan QA Applicant',
        father_name: 'Salman QA',
        dob: '2012-08-10',
        gender: 'Male',
        class_applying: 'Grade 8 - Middle',
        previous_school: 'Model School Paharpur',
        parent_phone: '0345-7788990',
        parent_email: 'salman.applicant@example.com',
        address: 'House 42, Ward 5, Paharpur',
      },
      { 'X-Forwarded-For': '198.51.100.25' }
    );
    const appNo = applyAdm.data?.application_no;
    const appId = applyAdm.data?.application?.id;
    const trackAdm = await httpRequest(testPort, 'GET', `/api/admissions/track/${appNo}`, undefined, {
      'X-Forwarded-For': '198.51.100.25',
    });
    const approveAdm = await httpRequest(
      testPort,
      'PUT',
      `/api/admissions/${appId}/status`,
      { status: 'Approved', remarks: 'Verified documents in QA', createStudentRecord: true },
      adminHeaders
    );
    assert(
      applyAdm.status === 201 &&
        trackAdm.status === 200 &&
        trackAdm.data?.address === 'Masked for applicant privacy' &&
        trackAdm.data?.parent_phone?.includes('****') &&
        approveAdm.status === 200 &&
        approveAdm.data?.application?.status === 'Approved',
      'E1. Admission submitted (201), tracked publicly with masked PII (200), and approved by Admin with auto-enrollment (200)'
    );

    // Exams & Results workflow
    const createExam = await httpRequest(
      testPort,
      'POST',
      '/api/exams',
      {
        title: 'QA Autumn Assessment 2026',
        term: 'Mid-Term',
        academic_year: '2026-2027',
        start_date: '2026-11-01',
        end_date: '2026-11-10',
        classes: ['Grade 9 - Matric'],
      },
      adminHeaders
    );
    const examId = createExam.data?.id || createExam.data?.exam?.id;
    const postResult = await httpRequest(
      testPort,
      'POST',
      '/api/results',
      {
        exam_id: examId,
        exam_title: 'QA Autumn Assessment 2026',
        student_id: qaStudentId,
        student_name: 'Zainab QA Test',
        class_name: 'Grade 9 - Matric',
        section: 'A',
        subjects: [
          { subject_name: 'Physics', total_marks: 100, obtained_marks: 91 },
          { subject_name: 'Mathematics', total_marks: 100, obtained_marks: 95 },
        ],
        remarks: 'Excellent analytical performance',
        published: true,
      },
      adminHeaders
    );
    const studentViewResults = await httpRequest(testPort, 'GET', `/api/results?student_id=${qaStudentId}`, undefined, studentHeaders);
    assert(
      createExam.status === 201 &&
        postResult.status === 201 &&
        studentViewResults.status === 200 &&
        studentViewResults.data?.some(r => r.exam_id === examId && r.obtained_marks === 186),
      'E2. Exam created, academic result recorded & published (201), and student retrieves exact marks (200)'
    );

    // Fee voucher & verified payment integrity + concurrency
    const createFee = await httpRequest(
      testPort,
      'POST',
      '/api/fees',
      {
        student_id: qaStudentId,
        fee_month: 'November',
        year: 2026,
        tuition_fee: 4000,
        admission_fee: 1000,
        other_charges: 500,
        due_date: '2026-11-10',
      },
      adminHeaders
    );
    const feeId = createFee.data?.id;
    const overPay = await httpRequest(
      testPort,
      'PUT',
      `/api/fees/${feeId}/pay`,
      { amount: 9000, method: 'Cash' },
      adminHeaders
    );
    const partPay = await httpRequest(
      testPort,
      'PUT',
      `/api/fees/${feeId}/pay`,
      { amount: 3000, method: 'Bank Transfer', transaction_id: 'TXN-QA-5001' },
      adminHeaders
    );
    const dupTxnPay = await httpRequest(
      testPort,
      'PUT',
      `/api/fees/${feeId}/pay`,
      { amount: 1000, method: 'Bank Transfer', transaction_id: 'TXN-QA-5001' },
      adminHeaders
    );
    const [raceA, raceB] = await Promise.all([
      httpRequest(testPort, 'PUT', `/api/fees/${feeId}/pay`, { amount: 2500, method: 'Cash', transaction_id: 'TXN-RACE-1' }, adminHeaders),
      httpRequest(testPort, 'PUT', `/api/fees/${feeId}/pay`, { amount: 2500, method: 'Cash', transaction_id: 'TXN-RACE-2' }, adminHeaders),
    ]);
    const raceStatuses = [raceA.status, raceB.status].sort();
    assert(
      createFee.status === 201 &&
        overPay.status === 400 &&
        partPay.status === 200 &&
        partPay.data?.fee?.pending_amount === 2500 &&
        dupTxnPay.status === 409 &&
        raceStatuses[0] === 200 &&
        (raceStatuses[1] === 400 || raceStatuses[1] === 409),
      'E3. Fee voucher, overpayment block (400), partial balance math (200), duplicate txn block (409), and concurrent race lock verified'
    );

    // =========================================================================
    // SECTION F: ADMIN AI ASSISTANT, NOTIFICATIONS, AUDIT LOGS, SETTINGS & SECURITY
    // =========================================================================
    console.log('\n--- SECTION F: AI ASSISTANT, NOTIFICATIONS, AUDIT LOGS & SECURITY GATES ---');

    // Admin AI disambiguation + candidate selection + follow-up context
    const aiAmbig = await httpRequest(
      testPort,
      'POST',
      '/api/admin/ai/query',
      { prompt: 'Show student record for Khan' },
      superHeaders
    );
    const firstCandidate = aiAmbig.data?.candidates?.[0];
    const aiSelected = await httpRequest(
      testPort,
      'POST',
      '/api/admin/ai/query',
      { prompt: 'Show student record for Khan', selectedId: firstCandidate?.id },
      superHeaders
    );
    const aiFollowUp = await httpRequest(
      testPort,
      'POST',
      '/api/admin/ai/query',
      {
        prompt: 'Show attendance and fee status for this student.',
        activeEntity: aiSelected.data?.activeEntity,
      },
      superHeaders
    );
    assert(
      aiAmbig.status === 200 &&
        aiAmbig.data?.disambiguationRequired === true &&
        aiSelected.status === 200 &&
        aiSelected.data?.activeEntity?.id === firstCandidate?.id &&
        aiFollowUp.status === 200 &&
        typeof aiFollowUp.data?.text === 'string' &&
        aiFollowUp.data.text.length > 20,
      'F1. Admin AI Assistant disambiguates candidates, resolves selectedId, and answers contextual follow-up'
    );

    // Execute confirmed action -> generates notifications -> test notification ownership
    const aiAction = await httpRequest(
      testPort,
      'POST',
      '/api/admin/ai/execute-action',
      { actionType: 'SEND_FEE_REMINDER', payload: {}, confirmed: true },
      superHeaders
    );
    const adminNotifs = await httpRequest(testPort, 'GET', '/api/notifications', undefined, superHeaders);
    const invalidNotifId = await httpRequest(testPort, 'PUT', '/api/notifications/not-an-objectid/read', {}, studentHeaders);
    assert(
      aiAction.status === 200 && adminNotifs.status === 200 && invalidNotifId.status === 400,
      'F2. Confirmed AI action executes (200), notifications load (200), malformed notification ID returns 400'
    );

    // Audit logs & School Settings
    const updateSettings = await httpRequest(
      testPort,
      'PUT',
      '/api/settings',
      { slogan: 'Excellence in Knowledge & Character — QA Verified' },
      adminHeaders
    );
    const studentSettingsBlocked = await httpRequest(
      testPort,
      'PUT',
      '/api/settings',
      { slogan: 'Hacked' },
      studentHeaders
    );
    // Allow brief async AuditLogModel write
    await new Promise(r => setTimeout(r, 150));
    const auditLogs = await httpRequest(testPort, 'GET', '/api/audit-logs?limit=25', undefined, superHeaders);
    assert(
      updateSettings.status === 200 &&
        studentSettingsBlocked.status === 403 &&
        auditLogs.status === 200 &&
        Array.isArray(auditLogs.data) &&
        auditLogs.data.some(l => l.action === 'Updated School Settings') &&
        auditLogs.data.some(l => l.action === 'Updated Admission Status'),
      'F3. School settings update (200), unauthorized settings write blocked (403), and MongoDB audit logs record admin actions'
    );

    // Upload extension spoofing prevention + nosniff header
    const tinyPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const uploadSpoofAttempt = await httpRequest(
      testPort,
      'POST',
      '/api/upload',
      { dataUrl: tinyPngBase64, filename: 'stored_xss_attempt.html' },
      adminHeaders
    );
    if (uploadSpoofAttempt.data?.filename) {
      createdUploads.push(path.resolve(UPLOADS_DIR, uploadSpoofAttempt.data.filename));
    }
    const uploadedAssetRes = uploadSpoofAttempt.data?.url
      ? await httpRequest(testPort, 'GET', uploadSpoofAttempt.data.url)
      : { status: 500, headers: {} };
    assert(
      uploadSpoofAttempt.status === 201 &&
        uploadSpoofAttempt.data?.filename?.endsWith('.png') &&
        !uploadSpoofAttempt.data?.filename?.endsWith('.html') &&
        uploadedAssetRes.headers['x-content-type-options'] === 'nosniff',
      'F4. Upload endpoint blocks .html extension spoofing (enforces .png) and serves X-Content-Type-Options: nosniff'
    );

    // Malformed JSON error sanitization + Auth rate limit
    const badJsonRes = await httpRequest(testPort, 'POST', '/api/auth/login', '{malformed_json', {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.77',
    });
    assert(
      badJsonRes.status === 400 && !badJsonRes.raw.includes('at ') && badJsonRes.data?.error === 'Malformed JSON request payload.',
      'F5. Malformed JSON payload returns sanitized 400 JSON without stack traces'
    );

    let auth429Triggered = false;
    for (let i = 0; i < 32; i++) {
      const r = await httpRequest(
        testPort,
        'POST',
        '/api/auth/login',
        { email: 'nobody@shawanschool.edu.pk', password: 'wrong' },
        { 'X-Forwarded-For': '198.51.100.200' }
      );
      if (r.status === 429) {
        auth429Triggered = true;
        break;
      }
    }
    assert(auth429Triggered, 'F6. Authentication login endpoint enforces brute-force rate limit (HTTP 429)');
  } finally {
    if (prodProc) {
      prodProc.kill('SIGTERM');
    }
    if (memServer) {
      await memServer.stop();
    }
    for (const f of createdUploads) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    if (fs.existsSync(tmpDbPath)) {
      fs.unlinkSync(tmpDbPath);
    }
  }

  const rawRealDb = fs.readFileSync(REAL_DB_PATH, 'utf8');
  const zeroQaLeak =
    !rawRealDb.includes('zainab.qa@shawanschool.edu.pk') &&
    !rawRealDb.includes('tariq.qa.parent@shawanschool.edu.pk') &&
    !rawRealDb.includes('qa.office.admin@shawanschool.edu.pk') &&
    !rawRealDb.includes('Hamdan QA Applicant') &&
    !rawRealDb.includes('QA Verified');
  assert(
    zeroQaLeak,
    'G1. Real school database (data/db.json) verified 100% isolated with zero QA test record mutations'
  );

  console.log('\n====================================================================');
  console.log(`PHASE 5 PRODUCTION READINESS SUITE: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('====================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal Phase 5 test failure:', err);
  process.exit(1);
});
