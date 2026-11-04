/**
 * PHASE 11 — FINAL RUNTIME VERIFICATION & PRODUCTION READINESS SUITE
 *
 * Strict Isolation Guarantees:
 * - Never touches real `data/db.json` (asserts identical SHA-256 before and after)
 * - Uses isolated `MongoMemoryServer` + temporary `DB_FILE_PATH` + temporary `UPLOAD_STORAGE_DIR`
 * - Executes real HTTP requests with real JWT authentication (zero mocked responses, zero auth bypass)
 * - Prints exact HTTP status codes for the full Role & IDOR Matrix
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ROOT = __dirname;
const REAL_DB_PATH = path.resolve(ROOT, 'data', 'db.json');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function httpRequest(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isRawString = typeof body === 'string';
    const payload = body !== undefined ? (isRawString ? body : JSON.stringify(body)) : undefined;
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
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
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

async function waitForHealth(port, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpRequest(port, 'GET', '/api/health');
      if (res.status === 200 && res.data && res.data.connected === true) return res;
    } catch {
      // retry
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server on port ${port} did not report healthy within ${timeoutMs}ms`);
}

function spawnIsolatedServer(port, envOverrides = {}) {
  const stdoutLines = [];
  const stderrLines = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: envOverrides.NODE_ENV || 'development',
      JWT_SECRET: envOverrides.JWT_SECRET || 'phase11_isolated_verification_secret_key_2026_shawan_998877',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => stdoutLines.push(d.toString()));
  child.stderr.on('data', d => stderrLines.push(d.toString()));
  return { child, stdoutLines, stderrLines };
}

async function stopChild(child) {
  if (!child || child.killed) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve();
    }, 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function hasNoSecretOrStackLeak(rawText, secret) {
  if (!rawText) return true;
  if (rawText.includes(secret)) return false;
  if (/mongodb(\+srv)?:\/\/[^*]+:[^@]+@/i.test(rawText)) return false;
  if (/\n\s+at\s+\S+/.test(rawText)) return false;
  return true;
}

async function main() {
  console.log('========================================================================');
  console.log('PHASE 11 — FINAL RUNTIME VERIFICATION & PRODUCTION READINESS SUITE');
  console.log('========================================================================\n');

  const initialRealDbHash = sha256File(REAL_DB_PATH);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shawan-phase11-'));
  const tmpDbPath = path.join(tmpDir, 'db.json');
  const tmpUploadsDir = path.join(tmpDir, 'uploads');
  fs.copyFileSync(REAL_DB_PATH, tmpDbPath);
  fs.mkdirSync(tmpUploadsDir, { recursive: true });
  const initialTmpDbHash = sha256File(tmpDbPath);

  const testSecret = 'phase11_isolated_verification_secret_key_2026_shawan_998877';

  let memServer = null;
  let mongoPort = await getFreePort();
  let serverPort = await getFreePort();
  let serverHandle = null;
  let inspectorConn = null;

  let passed = 0;
  let failed = 0;
  const matrixRecords = [];

  function assert(cond, label, detail = '') {
    if (cond) {
      console.log(`[PASS] ${label}`);
      passed++;
    } else {
      console.error(`[FAIL] ${label}${detail ? ' — ' + detail : ''}`);
      failed++;
    }
  }

  try {
    // 1. Start MongoMemoryServer on a fixed port so we can stop/restart on same URI to test 503 unavailability + reconnect
    memServer = await MongoMemoryServer.create({
      instance: { port: mongoPort, dbName: 'shawan_phase11_audit' },
    });
    const mongoUri = memServer.getUri('shawan_phase11_audit');

    serverHandle = spawnIsolatedServer(serverPort, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbPath,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
      JWT_SECRET: testSecret,
    });

    // =========================================================================
    // SECTION 2: BACKEND RUNTIME VERIFICATION
    // =========================================================================
    console.log('--- SECTION 2: BACKEND RUNTIME & HEALTH VERIFICATION ---');

    const healthOk = await waitForHealth(serverPort);
    assert(
      healthOk.status === 200 &&
        healthOk.data &&
        healthOk.data.status === 'ok' &&
        healthOk.data.connected === true &&
        healthOk.data.database?.connected === true &&
        healthOk.data.database?.state === 'connected',
      '2.1 Backend starts cleanly and GET /api/health reports connected=true (HTTP 200)',
      JSON.stringify(healthOk.data)
    );

    const combinedStartupStderr = serverHandle.stderrLines.join('');
    assert(
      !combinedStartupStderr.includes("the 'new' option for 'findOneAndUpdate()'"),
      '2.2 Zero Mongoose 9 findOneAndUpdate deprecation warnings during startup/seed',
      combinedStartupStderr.slice(0, 300)
    );

    const unknownApi = await httpRequest(serverPort, 'GET', '/api/unknown-phase11-endpoint');
    assert(
      unknownApi.status === 404 && unknownApi.data && unknownApi.data.error === 'API endpoint not found',
      '2.3 Unknown /api/* route returns HTTP 404 JSON (never SPA HTML)',
      `status=${unknownApi.status} raw=${String(unknownApi.raw).slice(0, 80)}`
    );

    const malformedJson = await httpRequest(serverPort, 'POST', '/api/auth/login', '{bad_json_payload', {
      'Content-Type': 'application/json',
    });
    assert(
      malformedJson.status === 400 &&
        malformedJson.data?.error &&
        hasNoSecretOrStackLeak(malformedJson.raw, testSecret),
      '2.4 Malformed JSON returns HTTP 400 sanitized error with zero stack trace or secret exposure',
      `status=${malformedJson.status} raw=${malformedJson.raw}`
    );

    // Static verification that no active .ts file imports ./db or calls db.getData/db.save/db.logAudit
    const activeServerFiles = [
      path.join(ROOT, 'server.ts'),
      path.join(ROOT, 'server', 'auth.ts'),
      path.join(ROOT, 'server', 'routes.ts'),
      path.join(ROOT, 'server', 'config', 'db.ts'),
      path.join(ROOT, 'server', 'config', 'seed.ts'),
      path.join(ROOT, 'server', 'services', 'aiAssistantService.ts'),
    ];
    let forbiddenDbRefs = [];
    for (const fPath of activeServerFiles) {
      const content = fs.readFileSync(fPath, 'utf8');
      if (/db\.(getData|save|logAudit)\s*\(|from\s+['"]\.\/db(\.ts)?['"]|from\s+['"]\.\.\/db(\.ts)?['"]/.test(content)) {
        forbiddenDbRefs.push(path.relative(ROOT, fPath));
      }
    }
    assert(
      forbiddenDbRefs.length === 0,
      '2.5 Zero active backend TypeScript files reference legacy db.ts (db.getData / db.save / db.logAudit)',
      forbiddenDbRefs.join(', ')
    );

    // Connect direct Mongoose inspector to verify real MongoDB documents
    inspectorConn = await mongoose.createConnection(mongoUri).asPromise();

    // Authenticate all 5 real role accounts
    const loginSuperAdmin = await httpRequest(serverPort, 'POST', '/api/auth/login', {
      email: 'admin@shawanschool.edu.pk',
      password: 'AdminPassword123!',
    });
    const loginAdmin = await httpRequest(serverPort, 'POST', '/api/auth/login', {
      email: 'office@shawanschool.edu.pk',
      password: 'AdminPassword123!',
    });
    const loginTeacher = await httpRequest(serverPort, 'POST', '/api/auth/login', {
      email: 'teacher@shawanschool.edu.pk',
      password: 'TeacherPassword123!',
    });
    const loginStudent = await httpRequest(serverPort, 'POST', '/api/auth/login', {
      email: 'student@shawanschool.edu.pk',
      password: 'StudentPassword123!',
    });
    const loginParent = await httpRequest(serverPort, 'POST', '/api/auth/login', {
      email: 'parent@shawanschool.edu.pk',
      password: 'ParentPassword123!',
    });

    assert(
      loginSuperAdmin.status === 200 &&
        loginAdmin.status === 200 &&
        loginTeacher.status === 200 &&
        loginStudent.status === 200 &&
        loginParent.status === 200,
      '2.6 Real JWT login succeeds for super_admin, admin, teacher, student, and parent'
    );

    const tokens = {
      super_admin: loginSuperAdmin.data.token,
      admin: loginAdmin.data.token,
      teacher: loginTeacher.data.token,
      student: loginStudent.data.token,
      parent: loginParent.data.token,
    };

    // =========================================================================
    // SECTION 3: ATTENDANCE VERIFICATION (MONGODB + API)
    // =========================================================================
    console.log('\n--- SECTION 3: ATTENDANCE VERIFICATION ---');

    const attTestDate = '2026-10-14';
    const createAtt = await httpRequest(
      serverPort,
      'POST',
      '/api/attendance/batch',
      {
        date: attTestDate,
        records: [
          {
            student_id: 'std_01',
            student_name: 'Muhammad Hamza',
            class_name: 'Grade 10 - Matric',
            section: 'A',
            status: 'Present',
            remarks: 'On time morning assembly',
          },
        ],
      },
      authHeader(tokens.admin)
    );
    assert(createAtt.status === 200, '3.1 Create attendance via POST /api/attendance/batch succeeds (HTTP 200)');

    const mongoAttDoc1 = await inspectorConn
      .collection('attendances')
      .findOne({ student_id: 'std_01', date: attTestDate });
    assert(
      Boolean(mongoAttDoc1 && mongoAttDoc1.record_id?.startsWith('att_') && mongoAttDoc1.status === 'Present'),
      '3.2 Attendance persisted in MongoDB attendances collection with legacy att_* record_id',
      JSON.stringify(mongoAttDoc1)
    );

    const getAtt = await httpRequest(
      serverPort,
      'GET',
      `/api/attendance?student_id=std_01&date=${attTestDate}`,
      undefined,
      authHeader(tokens.admin)
    );
    assert(
      getAtt.status === 200 &&
        Array.isArray(getAtt.data) &&
        getAtt.data.length === 1 &&
        getAtt.data[0].id === mongoAttDoc1.record_id &&
        getAtt.data[0].student_id === 'std_01' &&
        getAtt.data[0].status === 'Present' &&
        typeof getAtt.data[0].marked_by === 'string',
      '3.3 Retrieve attendance returns legacy id (att_*) and expected DTO fields'
    );

    // Update attendance in-place & verify duplicate prevention
    const updateAtt = await httpRequest(
      serverPort,
      'POST',
      '/api/teacher/attendance',
      {
        date: attTestDate,
        class_name: 'Grade 10 - Matric',
        section: 'A',
        records: [
          {
            student_id: 'std_01',
            student_name: 'Muhammad Hamza',
            status: 'Late',
            remarks: 'Arrived 10 mins late',
          },
        ],
      },
      authHeader(tokens.teacher)
    );
    const mongoAttCountAfterUpdate = await inspectorConn
      .collection('attendances')
      .countDocuments({ student_id: 'std_01', date: attTestDate });
    const mongoAttDocAfterUpdate = await inspectorConn
      .collection('attendances')
      .findOne({ student_id: 'std_01', date: attTestDate });

    assert(
      updateAtt.status === 200 &&
        mongoAttCountAfterUpdate === 1 &&
        mongoAttDocAfterUpdate.record_id === mongoAttDoc1.record_id &&
        mongoAttDocAfterUpdate.status === 'Late',
      '3.4 Updating attendance for (student_id, date) updates in-place without creating duplicates and preserves record_id'
    );

    // Direct MongoDB unique index check for (student_id, date)
    let dupAttErrCode = null;
    try {
      await inspectorConn.collection('attendances').insertOne({
        record_id: 'att_dup_direct_test',
        student_id: 'std_01',
        student_name: 'Muhammad Hamza',
        class_name: 'Grade 10 - Matric',
        section: 'A',
        date: attTestDate,
        status: 'Absent',
      });
    } catch (e) {
      dupAttErrCode = e.code;
    }
    assert(
      dupAttErrCode === 11000,
      '3.5 MongoDB unique compound index { student_id: 1, date: 1 } blocks duplicate attendance documents (E11000)'
    );

    // Unauthorized attendance modification checks
    const attUnauth = await httpRequest(serverPort, 'POST', '/api/attendance/batch', {
      date: attTestDate,
      records: [{ student_id: 'std_01', status: 'Present' }],
    });
    const attByStudent = await httpRequest(
      serverPort,
      'POST',
      '/api/attendance/batch',
      { date: attTestDate, records: [{ student_id: 'std_01', status: 'Present' }] },
      authHeader(tokens.student)
    );
    const attByParent = await httpRequest(
      serverPort,
      'POST',
      '/api/attendance/batch',
      { date: attTestDate, records: [{ student_id: 'std_01', status: 'Present' }] },
      authHeader(tokens.parent)
    );
    const attUnassignedTeacher = await httpRequest(
      serverPort,
      'POST',
      '/api/attendance/batch',
      {
        date: attTestDate,
        records: [{ student_id: 'std_05', class_name: 'Grade 7 - Middle', status: 'Present' }],
      },
      authHeader(tokens.teacher)
    );
    assert(
      attUnauth.status === 401 &&
        attByStudent.status === 403 &&
        attByParent.status === 403 &&
        attUnassignedTeacher.status === 403,
      `3.6 Unauthorized attendance writes blocked (unauth=${attUnauth.status}, student=${attByStudent.status}, parent=${attByParent.status}, unassignedTeacher=${attUnassignedTeacher.status})`
    );

    // =========================================================================
    // SECTION 4: EXAMINATION RESULTS VERIFICATION (MONGODB + API)
    // =========================================================================
    console.log('\n--- SECTION 4: EXAMINATION RESULTS VERIFICATION ---');

    const badExamResultAttempt = await httpRequest(
      serverPort,
      'POST',
      '/api/results',
      {
        exam_id: 'EX_NONEXISTENT_999',
        exam_title: 'Invalid Exam Reference',
        student_id: 'std_01',
        class_name: 'Grade 10 - Matric',
        subjects: [{ subject_name: 'Mathematics', total_marks: 100, obtained_marks: 90 }],
      },
      authHeader(tokens.admin)
    );
    assert(
      badExamResultAttempt.status === 400,
      '4.0 Result creation rejects nonexistent exam_id foreign key (HTTP 400)'
    );

    const createExamForP11 = await httpRequest(
      serverPort,
      'POST',
      '/api/exams',
      {
        title: 'Phase 11 Final Verification Exam 2026',
        class_name: 'Grade 10 - Matric',
        term: 'Final Term',
        start_date: '2026-11-01',
        end_date: '2026-11-10',
        status: 'Completed',
        total_marks: 250,
      },
      authHeader(tokens.admin)
    );
    const testExamId = createExamForP11.data?.id;

    const createRes = await httpRequest(
      serverPort,
      'POST',
      '/api/results',
      {
        exam_id: testExamId,
        exam_title: 'Phase 11 Final Verification Exam 2026',
        student_id: 'std_01',
        student_name: 'Muhammad Hamza',
        class_name: 'Grade 10 - Matric',
        section: 'A',
        subjects: [
          { subject_name: 'Mathematics', total_marks: 100, obtained_marks: 92 },
          { subject_name: 'Physics & Applied Science', total_marks: 100, obtained_marks: 84 },
          { subject_name: 'English', total_marks: 50, obtained_marks: 44 },
        ],
        remarks: 'Commendable analytical performance',
        published: true,
      },
      authHeader(tokens.admin)
    );
    // Expected: total = 250, obtained = 220, percentage = 88%, overall_grade = A1 (Distinction)
    assert(
      createRes.status === 201 &&
        createRes.data.id?.startsWith('res_') &&
        createRes.data.total_marks === 250 &&
        createRes.data.obtained_marks === 220 &&
        createRes.data.percentage === 88 &&
        createRes.data.overall_grade === 'A1 (Distinction)' &&
        Array.isArray(createRes.data.subjects) &&
        createRes.data.subjects.length === 3 &&
        createRes.data.subjects.every(s => s.grade === 'A1'),
      '4.1 Create result computes accurate subject grades (A1), total (250), obtained (220), percentage (88%), and overall grade (A1 (Distinction))',
      JSON.stringify(createRes.data)
    );

    const createdResultId = createRes.data.id;
    const mongoResDoc = await inspectorConn
      .collection('results')
      .findOne({ exam_id: testExamId, student_id: 'std_01' });
    assert(
      Boolean(mongoResDoc && mongoResDoc.record_id === createdResultId && mongoResDoc.obtained_marks === 220),
      '4.2 Result persisted in MongoDB results collection with matching record_id and subject breakdown'
    );

    // Teacher updates subject marks on same (exam_id, student_id)
    const teacherUpsertMarks = await httpRequest(
      serverPort,
      'POST',
      '/api/teacher/results',
      {
        exam_id: testExamId,
        exam_title: 'Phase 11 Final Verification Exam 2026',
        student_id: 'std_01',
        subject_name: 'Physics & Applied Science',
        total_marks: 100,
        obtained_marks: 89,
        remarks: 'Updated after practical lab review',
      },
      authHeader(tokens.teacher)
    );
    // Expected: obtained = 92 + 89 + 44 = 225 / 250 = 90%
    assert(
      teacherUpsertMarks.status === 200 &&
        teacherUpsertMarks.data?.result?.id === createdResultId &&
        teacherUpsertMarks.data?.result?.obtained_marks === 225 &&
        teacherUpsertMarks.data?.result?.percentage === 90,
      '4.3 Teacher subject marks update recalculates total/obtained/percentage (225/250 = 90%) in-place'
    );

    // Prevent duplicate result for (exam_id, student_id) via API and MongoDB unique index
    const duplicateApiRes = await httpRequest(
      serverPort,
      'POST',
      '/api/results',
      {
        exam_id: testExamId,
        exam_title: 'Phase 11 Final Verification Exam 2026',
        student_id: 'std_01',
        class_name: 'Grade 10 - Matric',
        section: 'A',
        subjects: [
          { subject_name: 'Mathematics', total_marks: 100, obtained_marks: 95 },
          { subject_name: 'Physics & Applied Science', total_marks: 100, obtained_marks: 90 },
          { subject_name: 'English', total_marks: 50, obtained_marks: 45 },
        ],
        published: true,
      },
      authHeader(tokens.admin)
    );
    const resCountForPair = await inspectorConn
      .collection('results')
      .countDocuments({ exam_id: testExamId, student_id: 'std_01' });
    let dupResErrCode = null;
    try {
      await inspectorConn.collection('results').insertOne({
        record_id: 'res_dup_direct_test',
        exam_id: testExamId,
        exam_title: 'Duplicate Direct Insert',
        student_id: 'std_01',
        student_name: 'Muhammad Hamza',
        class_name: 'Grade 10 - Matric',
        section: 'A',
        subjects: [{ subject_name: 'Math', total_marks: 100, obtained_marks: 80, grade: 'A' }],
        total_marks: 100,
        obtained_marks: 80,
        percentage: 80,
        overall_grade: 'A',
        published: true,
      });
    } catch (e) {
      dupResErrCode = e.code;
    }
    assert(
      (duplicateApiRes.status === 200 || duplicateApiRes.status === 201) &&
        resCountForPair === 1 &&
        duplicateApiRes.data.id === createdResultId &&
        dupResErrCode === 11000,
      '4.4 Duplicate (exam_id, student_id) updates in-place via API (count=1) and direct duplicate insert blocked by E11000 index'
    );

    // Toggle published=false -> verify hidden from student & parent APIs, dossier, and Portal AI, while visible to admin
    const unpublishRes = await httpRequest(
      serverPort,
      'PATCH',
      `/api/results/${createdResultId}/publish`,
      { published: false },
      authHeader(tokens.admin)
    );
    const studentResultsWhileDraft = await httpRequest(
      serverPort,
      'GET',
      '/api/results',
      undefined,
      authHeader(tokens.student)
    );
    const studentDossierWhileDraft = await httpRequest(
      serverPort,
      'GET',
      '/api/students/std_01',
      undefined,
      authHeader(tokens.student)
    );
    const parentResultsWhileDraft = await httpRequest(
      serverPort,
      'GET',
      '/api/results?student_id=std_01',
      undefined,
      authHeader(tokens.parent)
    );
    const studentAiWhileDraft = await httpRequest(
      serverPort,
      'POST',
      '/api/portal/ai/query',
      { prompt: 'Show my exam results' },
      authHeader(tokens.student)
    );
    const parentAiWhileDraft = await httpRequest(
      serverPort,
      'POST',
      '/api/portal/ai/query',
      { prompt: 'Show Muhammad Hamza exam results' },
      authHeader(tokens.parent)
    );
    const adminResultsWhileDraft = await httpRequest(
      serverPort,
      'GET',
      `/api/results?exam_id=${testExamId}`,
      undefined,
      authHeader(tokens.admin)
    );
    assert(
      unpublishRes.status === 200 &&
        unpublishRes.data?.published === false &&
        !studentResultsWhileDraft.data.some(r => r.id === createdResultId) &&
        !studentDossierWhileDraft.data.results.some(r => r.id === createdResultId) &&
        !parentResultsWhileDraft.data.some(r => r.id === createdResultId) &&
        !String(studentAiWhileDraft.data?.text || '').includes('Phase 11 Final Verification Exam 2026') &&
        !String(parentAiWhileDraft.data?.text || '').includes('Phase 11 Final Verification Exam 2026') &&
        adminResultsWhileDraft.data.some(r => r.id === createdResultId && r.published === false),
      '4.5 Unpublished (draft) result is strictly hidden from student & parent APIs, dossier, and Portal AI while visible to admin'
    );

    // Re-publish -> verify visible to student & parent
    const republishRes = await httpRequest(
      serverPort,
      'PATCH',
      `/api/results/${createdResultId}/publish`,
      { published: true },
      authHeader(tokens.admin)
    );
    const studentResultsAfterPublish = await httpRequest(
      serverPort,
      'GET',
      '/api/results',
      undefined,
      authHeader(tokens.student)
    );
    const parentResultsAfterPublish = await httpRequest(
      serverPort,
      'GET',
      '/api/results?student_id=std_01',
      undefined,
      authHeader(tokens.parent)
    );
    assert(
      republishRes.status === 200 &&
        studentResultsAfterPublish.data.some(r => r.id === createdResultId) &&
        parentResultsAfterPublish.data.some(r => r.id === createdResultId),
      '4.6 Re-publishing result makes it immediately visible to student and linked parent'
    );

    // Unauthorized modification & restricted viewing checks
    const studentWriteRes = await httpRequest(
      serverPort,
      'POST',
      '/api/results',
      { exam_id: 'EX_HACK', student_id: 'std_01', subjects: [{ subject_name: 'Math', total_marks: 100, obtained_marks: 100 }] },
      authHeader(tokens.student)
    );
    const parentWriteRes = await httpRequest(
      serverPort,
      'PATCH',
      `/api/results/${createdResultId}/publish`,
      { published: false },
      authHeader(tokens.parent)
    );
    const teacherUnassignedRes = await httpRequest(
      serverPort,
      'POST',
      '/api/teacher/results',
      { exam_id: testExamId, student_id: 'std_05', subject_name: 'Mathematics', total_marks: 100, obtained_marks: 80 },
      authHeader(tokens.teacher)
    );
    assert(
      studentWriteRes.status === 403 && parentWriteRes.status === 403 && teacherUnassignedRes.status === 403,
      `4.7 Unauthorized result writes blocked (student=${studentWriteRes.status}, parent=${parentWriteRes.status}, unassignedTeacher=${teacherUnassignedRes.status})`
    );

    // =========================================================================
    // SECTION 5: FEE MANAGEMENT VERIFICATION (MONGODB + API)
    // =========================================================================
    console.log('\n--- SECTION 5: FEE MANAGEMENT VERIFICATION ---');

    const createFee = await httpRequest(
      serverPort,
      'POST',
      '/api/fees',
      {
        student_id: 'std_01',
        fee_month: 'November',
        year: 2026,
        tuition_fee: 4000,
        admission_fee: 0,
        other_charges: 500,
        due_date: '2026-11-15',
      },
      authHeader(tokens.admin)
    );
    assert(
      createFee.status === 201 &&
        createFee.data.id?.startsWith('fee_') &&
        createFee.data.total_amount === 4500 &&
        createFee.data.paid_amount === 0 &&
        createFee.data.pending_amount === 4500 &&
        createFee.data.status === 'Unpaid',
      '5.1 Create fee voucher succeeds (HTTP 201) with accurate initial balances (total=4500, paid=0, pending=4500, status=Unpaid)'
    );
    const createdFeeId = createFee.data.id;

    // Case-insensitive duplicate billing cycle check
    const dupBillingCycle = await httpRequest(
      serverPort,
      'POST',
      '/api/fees',
      {
        student_id: 'std_01',
        fee_month: 'nOvEmBeR',
        year: 2026,
        tuition_fee: 4000,
      },
      authHeader(tokens.admin)
    );
    assert(
      dupBillingCycle.status === 409,
      '5.2 Duplicate billing cycle (case-insensitive fee_month + year + student_id) rejected with HTTP 409'
    );

    // Retrieve voucher
    const getStudentFees = await httpRequest(
      serverPort,
      'GET',
      '/api/fees?student_id=std_01',
      undefined,
      authHeader(tokens.student)
    );
    assert(
      getStudentFees.status === 200 && getStudentFees.data.some(f => f.id === createdFeeId),
      '5.3 Retrieve fee voucher returns newly created voucher with legacy id (fee_*)'
    );

    // Partial payment
    const partialPay = await httpRequest(
      serverPort,
      'PUT',
      `/api/fees/${createdFeeId}/pay`,
      {
        amount: 2000,
        method: 'Bank Transfer',
        transaction_id: 'TXN-PHASE11-PARTIAL-01',
        notes: 'First installment',
      },
      authHeader(tokens.admin)
    );
    assert(
      partialPay.status === 200 &&
        partialPay.data.fee.status === 'Partial' &&
        partialPay.data.fee.paid_amount === 2000 &&
        partialPay.data.fee.pending_amount === 2500 &&
        partialPay.data.fee.payment_history.length === 1,
      '5.4 Partial payment updates status=Partial, paid=2000, pending=2500, and appends payment_history'
    );

    // Overpayment rejection on Partial voucher (pending=2500, attempting 2600)
    const overPay = await httpRequest(
      serverPort,
      'PUT',
      `/api/fees/${createdFeeId}/pay`,
      {
        amount: 2600,
        method: 'Cash',
        transaction_id: 'TXN-PHASE11-OVERPAY',
      },
      authHeader(tokens.admin)
    );
    const feeDocAfterOverpay = await inspectorConn.collection('fees').findOne({ voucher_id: createdFeeId });
    const ledgerAfterOverpay = await inspectorConn
      .collection('feepayments')
      .find({ fee_id: createdFeeId })
      .toArray();
    assert(
      overPay.status === 400 &&
        feeDocAfterOverpay.paid_amount === 2000 &&
        feeDocAfterOverpay.pending_amount === 2500 &&
        ledgerAfterOverpay.length === 1,
      '5.5 Overpayment rejected (HTTP 400) with zero partial mutation in FeeModel or FeePaymentModel'
    );

    // Duplicate transaction_id rejection across vouchers
    const dupTxnPay = await httpRequest(
      serverPort,
      'PUT',
      '/api/fees/fee_ahmad_sep_2026/pay',
      {
        amount: 500,
        method: 'Bank Transfer',
        transaction_id: 'TXN-PHASE11-PARTIAL-01',
      },
      authHeader(tokens.admin)
    );
    const ahmadFeeDocCheck = await inspectorConn.collection('fees').findOne({ voucher_id: 'fee_ahmad_sep_2026' });
    assert(
      dupTxnPay.status === 409 && ahmadFeeDocCheck.paid_amount === 0 && ahmadFeeDocCheck.pending_amount === 3500,
      '5.6 Duplicate transaction_id rejected (HTTP 409) without altering target voucher balance'
    );

    // Full settlement of remaining balance (2500)
    const fullSettlePay = await httpRequest(
      serverPort,
      'PUT',
      `/api/fees/${createdFeeId}/pay`,
      {
        amount: 2500,
        method: 'Cash',
        transaction_id: 'TXN-PHASE11-SETTLE-02',
        notes: 'Final balance cleared',
      },
      authHeader(tokens.admin)
    );
    assert(
      fullSettlePay.status === 200 &&
        fullSettlePay.data.fee.status === 'Paid' &&
        fullSettlePay.data.fee.paid_amount === 4500 &&
        fullSettlePay.data.fee.pending_amount === 0 &&
        fullSettlePay.data.fee.payment_history.length === 2,
      '5.7 Full settlement transitions status=Paid, paid=4500, pending=0, with 2 receipts in payment_history'
    );

    // Payment on already settled voucher rejected
    const settledPayAttempt = await httpRequest(
      serverPort,
      'PUT',
      `/api/fees/${createdFeeId}/pay`,
      { amount: 100, method: 'Cash' },
      authHeader(tokens.admin)
    );
    assert(settledPayAttempt.status === 400, '5.8 Payment on already settled (Paid) voucher rejected with HTTP 400');

    // Deletion of voucher with payment history rejected (super_admin)
    const deletePaidVoucher = await httpRequest(
      serverPort,
      'DELETE',
      `/api/fees/${createdFeeId}`,
      undefined,
      authHeader(tokens.super_admin)
    );
    assert(
      deletePaidVoucher.status === 400,
      '5.9 Deleting a voucher with recorded payment history is strictly rejected (HTTP 400)'
    );

    // Create a disposable unpaid voucher and test concurrent settlement race + unpaid voucher deletion
    const raceVoucherRes = await httpRequest(
      serverPort,
      'POST',
      '/api/fees',
      { student_id: 'std_01', fee_month: 'December', year: 2026, tuition_fee: 3000 },
      authHeader(tokens.admin)
    );
    const raceVoucherId = raceVoucherRes.data.id;
    const [race1, race2] = await Promise.all([
      httpRequest(
        serverPort,
        'PUT',
        `/api/fees/${raceVoucherId}/pay`,
        { amount: 3000, method: 'Cash', transaction_id: 'TXN-P11-RACE-A' },
        authHeader(tokens.admin)
      ),
      httpRequest(
        serverPort,
        'PUT',
        `/api/fees/${raceVoucherId}/pay`,
        { amount: 3000, method: 'Cash', transaction_id: 'TXN-P11-RACE-B' },
        authHeader(tokens.admin)
      ),
    ]);
    const raceStatuses = [race1.status, race2.status].sort((a, b) => a - b);
    const raceVoucherDoc = await inspectorConn.collection('fees').findOne({ voucher_id: raceVoucherId });
    const raceLedgerDocs = await inspectorConn
      .collection('feepayments')
      .find({ fee_id: raceVoucherId })
      .toArray();
    const raceLedgerSum = raceLedgerDocs.reduce((s, d) => s + Number(d.amount || 0), 0);

    assert(
      raceStatuses[0] === 200 &&
        (raceStatuses[1] === 400 || raceStatuses[1] === 409) &&
        raceVoucherDoc.paid_amount === 3000 &&
        raceVoucherDoc.pending_amount === 0 &&
        raceLedgerDocs.length === 1 &&
        raceLedgerSum === 3000,
      `5.10 Concurrent payment race maintains atomic balance & FeePaymentModel consistency (statuses=${raceStatuses.join(',')}, ledgerCount=${raceLedgerDocs.length}, sum=${raceLedgerSum})`
    );

    // Verify FeeModel & FeePaymentModel consistency across createdFeeId as well
    const novFeeDoc = await inspectorConn.collection('fees').findOne({ voucher_id: createdFeeId });
    const novLedgerDocs = await inspectorConn
      .collection('feepayments')
      .find({ fee_id: createdFeeId })
      .toArray();
    const novLedgerSum = novLedgerDocs.reduce((s, d) => s + Number(d.amount || 0), 0);
    assert(
      novFeeDoc.paid_amount === 4500 &&
        novFeeDoc.pending_amount === 0 &&
        novLedgerDocs.length === 2 &&
        novLedgerSum === novFeeDoc.paid_amount,
      '5.11 FeeModel balance and FeePaymentModel ledger receipts match 100% after successes and failures'
    );

    // =========================================================================
    // SECTION 7: SECURITY, ROLE MATRIX & IDOR VERIFICATION (EXACT STATUS CODES)
    // =========================================================================
    console.log('\n--- SECTION 7: SECURITY, ROLE MATRIX & IDOR VERIFICATION ---');

    async function recordCheck(feature, actor, method, urlPath, body, token) {
      const res = await httpRequest(serverPort, method, urlPath, body, authHeader(token));
      matrixRecords.push({ feature, actor, method, urlPath, status: res.status });
      return res;
    }

    // 7.1 Attendance Read & Write Matrix + IDOR
    const mAttUnauth = await recordCheck('Attendance Read', 'unauthenticated', 'GET', '/api/attendance', undefined, null);
    const mAttSuper = await recordCheck('Attendance Read', 'super_admin', 'GET', '/api/attendance?limit=5', undefined, tokens.super_admin);
    const mAttAdmin = await recordCheck('Attendance Read', 'admin', 'GET', '/api/attendance?limit=5', undefined, tokens.admin);
    const mAttTeacherOwn = await recordCheck('Attendance Read (Assigned)', 'teacher', 'GET', '/api/attendance?class_name=Grade%2010%20-%20Matric', undefined, tokens.teacher);
    const mAttTeacherIdor = await recordCheck('Attendance Read (Unassigned IDOR)', 'teacher', 'GET', '/api/attendance?class_name=Grade%207%20-%20Middle', undefined, tokens.teacher);
    const mAttStudentOwn = await recordCheck('Attendance Read (Own)', 'student', 'GET', '/api/attendance/student/std_01', undefined, tokens.student);
    const mAttStudentIdor = await recordCheck('Attendance Read (Other Student IDOR)', 'student', 'GET', '/api/attendance/student/std_02', undefined, tokens.student);
    const mAttParentLinked = await recordCheck('Attendance Read (Linked Child)', 'parent', 'GET', '/api/attendance/student/std_01', undefined, tokens.parent);
    const mAttParentIdor = await recordCheck('Attendance Read (Unlinked Child IDOR)', 'parent', 'GET', '/api/attendance/student/std_02', undefined, tokens.parent);

    assert(
      mAttUnauth.status === 401 &&
        mAttSuper.status === 200 &&
        mAttAdmin.status === 200 &&
        mAttTeacherOwn.status === 200 &&
        mAttTeacherIdor.status === 403 &&
        mAttStudentOwn.status === 200 &&
        mAttStudentIdor.status === 403 &&
        mAttParentLinked.status === 200 &&
        mAttParentIdor.status === 403,
      `7.1 Attendance Role & IDOR Matrix verified (unauth=${mAttUnauth.status}, super=${mAttSuper.status}, admin=${mAttAdmin.status}, teacherAssigned=${mAttTeacherOwn.status}, teacherUnassigned=${mAttTeacherIdor.status}, studentOwn=${mAttStudentOwn.status}, studentIdor=${mAttStudentIdor.status}, parentLinked=${mAttParentLinked.status}, parentIdor=${mAttParentIdor.status})`
    );

    // 7.2 Results Read/Write Matrix + IDOR
    const mResUnauth = await recordCheck('Results Read', 'unauthenticated', 'GET', '/api/results', undefined, null);
    const mResSuper = await recordCheck('Results Read', 'super_admin', 'GET', '/api/results', undefined, tokens.super_admin);
    const mResAdmin = await recordCheck('Results Read', 'admin', 'GET', '/api/results', undefined, tokens.admin);
    const mResTeacherOwn = await recordCheck('Results Read (Assigned)', 'teacher', 'GET', '/api/results?class_name=Grade%2010%20-%20Matric', undefined, tokens.teacher);
    const mResTeacherIdor = await recordCheck('Results Read (Unassigned IDOR)', 'teacher', 'GET', '/api/results?class_name=Grade%207%20-%20Middle', undefined, tokens.teacher);
    const mResStudentOwn = await recordCheck('Results Read (Own)', 'student', 'GET', '/api/results?student_id=std_01', undefined, tokens.student);
    const mResStudentIdor = await recordCheck('Results Read (Other Student IDOR)', 'student', 'GET', '/api/results?student_id=std_02', undefined, tokens.student);
    const mResParentLinked = await recordCheck('Results Read (Linked Child)', 'parent', 'GET', '/api/results?student_id=std_01', undefined, tokens.parent);
    const mResParentIdor = await recordCheck('Results Read (Unlinked Child IDOR)', 'parent', 'GET', '/api/results?student_id=std_02', undefined, tokens.parent);

    assert(
      mResUnauth.status === 401 &&
        mResSuper.status === 200 &&
        mResAdmin.status === 200 &&
        mResTeacherOwn.status === 200 &&
        mResTeacherIdor.status === 403 &&
        mResStudentOwn.status === 200 &&
        mResStudentIdor.status === 403 &&
        mResParentLinked.status === 200 &&
        mResParentIdor.status === 403,
      `7.2 Results Role & IDOR Matrix verified (unauth=${mResUnauth.status}, super=${mResSuper.status}, admin=${mResAdmin.status}, teacherAssigned=${mResTeacherOwn.status}, teacherUnassigned=${mResTeacherIdor.status}, studentOwn=${mResStudentOwn.status}, studentIdor=${mResStudentIdor.status}, parentLinked=${mResParentLinked.status}, parentIdor=${mResParentIdor.status})`
    );

    // 7.3 Fees Read/Write Matrix + IDOR
    const disposableFeeRes = await httpRequest(
      serverPort,
      'POST',
      '/api/fees',
      { student_id: 'std_01', fee_month: 'October', year: 2027, tuition_fee: 2500 },
      authHeader(tokens.admin)
    );
    const disposableFeeId = disposableFeeRes.data?.id;

    const mFeeUnauth = await recordCheck('Fees Read', 'unauthenticated', 'GET', '/api/fees', undefined, null);
    const mFeeSuper = await recordCheck('Fees Read', 'super_admin', 'GET', '/api/fees', undefined, tokens.super_admin);
    const mFeeAdmin = await recordCheck('Fees Read', 'admin', 'GET', '/api/fees', undefined, tokens.admin);
    const mFeeTeacher = await recordCheck('Fees Read (Denied)', 'teacher', 'GET', '/api/fees', undefined, tokens.teacher);
    const mFeeTeacherWrite = await recordCheck('Fees Write (Denied)', 'teacher', 'POST', '/api/fees', { student_id: 'std_01', fee_month: 'Jan', year: 2027, tuition_fee: 3000 }, tokens.teacher);
    const mFeeTeacherDelete = await recordCheck('Fees Delete (Denied)', 'teacher', 'DELETE', `/api/fees/${disposableFeeId}`, undefined, tokens.teacher);
    const mFeeStudentOwn = await recordCheck('Fees Read (Own)', 'student', 'GET', '/api/fees?student_id=std_01', undefined, tokens.student);
    const mFeeStudentIdor = await recordCheck('Fees Read (Other Student IDOR)', 'student', 'GET', '/api/fees?student_id=std_02', undefined, tokens.student);
    const mFeeStudentPay = await recordCheck('Fees Pay (Denied)', 'student', 'PUT', '/api/fees/fee_ahmad_sep_2026/pay', { amount: 100, method: 'Cash' }, tokens.student);
    const mFeeParentLinked = await recordCheck('Fees Read (Linked Child)', 'parent', 'GET', '/api/fees?student_id=std_01', undefined, tokens.parent);
    const mFeeParentIdor = await recordCheck('Fees Read (Unlinked Child IDOR)', 'parent', 'GET', '/api/fees?student_id=std_02', undefined, tokens.parent);
    const mFeeParentPay = await recordCheck('Fees Pay (Denied)', 'parent', 'PUT', '/api/fees/fee_ahmad_sep_2026/pay', { amount: 100, method: 'Cash' }, tokens.parent);
    const mFeeAdminDelete = await recordCheck('Fees Delete (Unpaid Voucher)', 'admin', 'DELETE', `/api/fees/${disposableFeeId}`, undefined, tokens.admin);

    assert(
      mFeeUnauth.status === 401 &&
        mFeeSuper.status === 200 &&
        mFeeAdmin.status === 200 &&
        mFeeTeacher.status === 403 &&
        mFeeTeacherWrite.status === 403 &&
        mFeeTeacherDelete.status === 403 &&
        mFeeStudentOwn.status === 200 &&
        mFeeStudentIdor.status === 403 &&
        mFeeStudentPay.status === 403 &&
        mFeeParentLinked.status === 200 &&
        mFeeParentIdor.status === 403 &&
        mFeeParentPay.status === 403 &&
        mFeeAdminDelete.status === 200,
      `7.3 Fees Role & IDOR Matrix verified (unauth=${mFeeUnauth.status}, super=${mFeeSuper.status}, admin=${mFeeAdmin.status}, teacherRead=${mFeeTeacher.status}, teacherWrite=${mFeeTeacherWrite.status}, teacherDelete=${mFeeTeacherDelete.status}, studentOwn=${mFeeStudentOwn.status}, studentIdor=${mFeeStudentIdor.status}, studentPay=${mFeeStudentPay.status}, parentLinked=${mFeeParentLinked.status}, parentIdor=${mFeeParentIdor.status}, parentPay=${mFeeParentPay.status}, adminDeleteUnpaid=${mFeeAdminDelete.status})`
    );

    // 7.4 Dashboard Statistics Matrix (Teacher receives redacted non-financial overview; Student & Parent denied)
    const mDashUnauth = await recordCheck('Dashboard Stats', 'unauthenticated', 'GET', '/api/dashboard/stats', undefined, null);
    const mDashSuper = await recordCheck('Dashboard Stats', 'super_admin', 'GET', '/api/dashboard/stats', undefined, tokens.super_admin);
    const mDashAdmin = await recordCheck('Dashboard Stats', 'admin', 'GET', '/api/dashboard/stats', undefined, tokens.admin);
    const mDashTeacher = await recordCheck('Dashboard Stats (Scoped)', 'teacher', 'GET', '/api/dashboard/stats', undefined, tokens.teacher);
    const mDashStudent = await recordCheck('Dashboard Stats', 'student', 'GET', '/api/dashboard/stats', undefined, tokens.student);
    const mDashParent = await recordCheck('Dashboard Stats', 'parent', 'GET', '/api/dashboard/stats', undefined, tokens.parent);

    assert(
      mDashUnauth.status === 401 &&
        mDashSuper.status === 200 &&
        mDashAdmin.status === 200 &&
        mDashTeacher.status === 200 &&
        mDashTeacher.data?.totalPendingFee === 0 &&
        mDashTeacher.data?.totalCollectedFee === 0 &&
        Array.isArray(mDashTeacher.data?.recentFees) &&
        mDashTeacher.data.recentFees.length === 0 &&
        Array.isArray(mDashTeacher.data?.recentAdmissions) &&
        mDashTeacher.data.recentAdmissions.length === 0 &&
        mDashStudent.status === 403 &&
        mDashParent.status === 403,
      `7.4 Dashboard Statistics Matrix verified with financial/admission redaction for teacher (unauth=${mDashUnauth.status}, super=${mDashSuper.status}, admin=${mDashAdmin.status}, teacher=${mDashTeacher.status}, student=${mDashStudent.status}, parent=${mDashParent.status})`
    );

    // 7.5 Student Details (/api/students/:id) Matrix + IDOR
    const mStdUnauth = await recordCheck('Student Details', 'unauthenticated', 'GET', '/api/students/std_01', undefined, null);
    const mStdSuper = await recordCheck('Student Details', 'super_admin', 'GET', '/api/students/std_01', undefined, tokens.super_admin);
    const mStdAdmin = await recordCheck('Student Details', 'admin', 'GET', '/api/students/std_01', undefined, tokens.admin);
    const mStdTeacherOwn = await recordCheck('Student Details (Assigned)', 'teacher', 'GET', '/api/students/std_01', undefined, tokens.teacher);
    const mStdTeacherIdor = await recordCheck('Student Details (Unassigned IDOR)', 'teacher', 'GET', '/api/students/std_05', undefined, tokens.teacher);
    const mStdStudentOwn = await recordCheck('Student Details (Own)', 'student', 'GET', '/api/students/std_01', undefined, tokens.student);
    const mStdStudentIdor = await recordCheck('Student Details (Other Student IDOR)', 'student', 'GET', '/api/students/std_02', undefined, tokens.student);
    const mStdParentLinked = await recordCheck('Student Details (Linked Child)', 'parent', 'GET', '/api/students/std_01', undefined, tokens.parent);
    const mStdParentIdor = await recordCheck('Student Details (Unlinked Child IDOR)', 'parent', 'GET', '/api/students/std_02', undefined, tokens.parent);

    assert(
      mStdUnauth.status === 401 &&
        mStdSuper.status === 200 &&
        mStdAdmin.status === 200 &&
        mStdTeacherOwn.status === 200 &&
        mStdTeacherIdor.status === 403 &&
        mStdStudentOwn.status === 200 &&
        mStdStudentIdor.status === 403 &&
        mStdParentLinked.status === 200 &&
        mStdParentIdor.status === 403,
      `7.5 Student Details Role & IDOR Matrix verified (unauth=${mStdUnauth.status}, super=${mStdSuper.status}, admin=${mStdAdmin.status}, teacherAssigned=${mStdTeacherOwn.status}, teacherUnassigned=${mStdTeacherIdor.status}, studentOwn=${mStdStudentOwn.status}, studentIdor=${mStdStudentIdor.status}, parentLinked=${mStdParentLinked.status}, parentIdor=${mStdParentIdor.status})`
    );

    // 7.6 Audit Logs (/api/audit-logs) Matrix
    const mAudUnauth = await recordCheck('Audit Logs', 'unauthenticated', 'GET', '/api/audit-logs', undefined, null);
    const mAudSuper = await recordCheck('Audit Logs', 'super_admin', 'GET', '/api/audit-logs', undefined, tokens.super_admin);
    const mAudAdmin = await recordCheck('Audit Logs', 'admin', 'GET', '/api/audit-logs', undefined, tokens.admin);
    const mAudTeacher = await recordCheck('Audit Logs', 'teacher', 'GET', '/api/audit-logs', undefined, tokens.teacher);
    const mAudStudent = await recordCheck('Audit Logs', 'student', 'GET', '/api/audit-logs', undefined, tokens.student);
    const mAudParent = await recordCheck('Audit Logs', 'parent', 'GET', '/api/audit-logs', undefined, tokens.parent);

    assert(
      mAudUnauth.status === 401 &&
        mAudSuper.status === 200 &&
        mAudAdmin.status === 200 &&
        mAudTeacher.status === 403 &&
        mAudStudent.status === 403 &&
        mAudParent.status === 403,
      `7.6 Audit Logs Role Matrix verified (unauth=${mAudUnauth.status}, super=${mAudSuper.status}, admin=${mAudAdmin.status}, teacher=${mAudTeacher.status}, student=${mAudStudent.status}, parent=${mAudParent.status})`
    );

    // 7.7 AI Endpoints Matrix (/api/admin/ai/query, /api/teacher/ai/query, /api/portal/ai/query) + IDOR
    const mAiAdminUnauth = await recordCheck('Admin AI', 'unauthenticated', 'POST', '/api/admin/ai/query', { prompt: 'Give me the school overview.' }, null);
    const mAiAdminSuper = await recordCheck('Admin AI', 'super_admin', 'POST', '/api/admin/ai/query', { prompt: 'Give me the school overview.' }, tokens.super_admin);
    const mAiAdminAdmin = await recordCheck('Admin AI', 'admin', 'POST', '/api/admin/ai/query', { prompt: 'Give me the school overview.' }, tokens.admin);
    const mAiAdminTeacher = await recordCheck('Admin AI', 'teacher', 'POST', '/api/admin/ai/query', { prompt: 'Give me the school overview.' }, tokens.teacher);
    const mAiAdminStudent = await recordCheck('Admin AI', 'student', 'POST', '/api/admin/ai/query', { prompt: 'Give me the school overview.' }, tokens.student);
    const mAiAdminParent = await recordCheck('Admin AI', 'parent', 'POST', '/api/admin/ai/query', { prompt: 'Give me the school overview.' }, tokens.parent);

    const mAiTchUnauth = await recordCheck('Teacher AI', 'unauthenticated', 'POST', '/api/teacher/ai/query', { prompt: 'What classes do I teach?' }, null);
    const mAiTchTeacher = await recordCheck('Teacher AI', 'teacher', 'POST', '/api/teacher/ai/query', { prompt: 'What classes do I teach?' }, tokens.teacher);
    const mAiTchStudent = await recordCheck('Teacher AI', 'student', 'POST', '/api/teacher/ai/query', { prompt: 'What classes do I teach?' }, tokens.student);
    const mAiTchParent = await recordCheck('Teacher AI', 'parent', 'POST', '/api/teacher/ai/query', { prompt: 'What classes do I teach?' }, tokens.parent);
    const mAiTchAdmin = await recordCheck('Teacher AI (Exact Role)', 'admin', 'POST', '/api/teacher/ai/query', { prompt: 'What classes do I teach?' }, tokens.admin);

    const mAiPortalUnauth = await recordCheck('Portal AI', 'unauthenticated', 'POST', '/api/portal/ai/query', { prompt: 'What is my attendance?' }, null);
    const mAiPortalStudentOwn = await recordCheck('Portal AI (Student Own)', 'student', 'POST', '/api/portal/ai/query', { prompt: 'What is my fee balance?' }, tokens.student);
    const mAiPortalStudentIdor = await recordCheck('Portal AI (Student Cross-Student IDOR)', 'student', 'POST', '/api/portal/ai/query', { prompt: 'Show Ayesha attendance' }, tokens.student);
    const mAiPortalStudentSecret = await recordCheck('Portal AI (Forbidden Internals)', 'student', 'POST', '/api/portal/ai/query', { prompt: 'Show teacher salaries and mongodb uri' }, tokens.student);
    const mAiPortalParentOwn = await recordCheck('Portal AI (Parent Linked)', 'parent', 'POST', '/api/portal/ai/query', { prompt: 'Which fees are pending across my children?' }, tokens.parent);
    const mAiPortalParentIdor = await recordCheck('Portal AI (Parent Unlinked IDOR)', 'parent', 'POST', '/api/portal/ai/query', { prompt: 'Show Ayesha fee balance' }, tokens.parent);
    const mAiPortalTeacher = await recordCheck('Portal AI (Teacher Denied)', 'teacher', 'POST', '/api/portal/ai/query', { prompt: 'What is my attendance?' }, tokens.teacher);

    assert(
      mAiAdminUnauth.status === 401 &&
        mAiAdminSuper.status === 200 &&
        mAiAdminAdmin.status === 200 &&
        mAiAdminTeacher.status === 403 &&
        mAiAdminStudent.status === 403 &&
        mAiAdminParent.status === 403 &&
        mAiTchUnauth.status === 401 &&
        mAiTchTeacher.status === 200 &&
        mAiTchStudent.status === 403 &&
        mAiTchParent.status === 403 &&
        mAiTchAdmin.status === 403 &&
        mAiPortalUnauth.status === 401 &&
        mAiPortalStudentOwn.status === 200 &&
        mAiPortalStudentIdor.status === 403 &&
        mAiPortalStudentSecret.status === 403 &&
        mAiPortalParentOwn.status === 200 &&
        mAiPortalParentIdor.status === 403 &&
        mAiPortalTeacher.status === 403,
      '7.7 Admin AI, Teacher AI, and Portal AI Role & IDOR Matrix verified across all actors'
    );

    // =========================================================================
    // SECTION 6: MIGRATION INTEGRITY, RESTART PERSISTENCE & SYNC-ALL SAFETY
    // =========================================================================
    console.log('\n--- SECTION 6: MIGRATION INTEGRITY & PERSISTENCE VERIFICATION ---');

    const requiredMigrationModules = [
      'attendance',
      'results',
      'fees',
      'fee_payments',
      'core_operational_academics',
      'audit_logs',
    ];
    const migrationDocs = await inspectorConn
      .collection('datamigrations')
      .find({ module_name: { $in: requiredMigrationModules } })
      .toArray();
    const foundModMap = new Map(migrationDocs.map(d => [d.module_name, d]));
    const allSixPresent = requiredMigrationModules.every(m => {
      const doc = foundModMap.get(m);
      return doc && Array.isArray(doc.migrated_keys) && doc.migrated_keys.length > 0;
    });
    assert(
      allSixPresent,
      `6.1 DataMigrationModel ledger entries exist with non-empty migrated_keys for all 6 required modules (${requiredMigrationModules.map(m => `${m}:${foundModMap.get(m)?.migrated_keys?.length || 0}`).join(', ')})`
    );

    // Edit a seeded record (att_01 -> Leave) and delete a seeded result (res_02) in MongoDB via API,
    // then run POST /api/mongodb/sync-all AND full backend restart to prove zero resurrection and zero overwrite!
    const editSeededAtt = await httpRequest(
      serverPort,
      'POST',
      '/api/attendance/batch',
      {
        date: '2026-09-28',
        records: [
          {
            student_id: 'std_01',
            student_name: 'Muhammad Hamza',
            class_name: 'Grade 10 - Matric',
            section: 'A',
            status: 'Leave',
            remarks: 'Approved medical leave persisted in MongoDB',
          },
        ],
      },
      authHeader(tokens.admin)
    );
    const deleteSeededRes = await httpRequest(
      serverPort,
      'DELETE',
      '/api/results/res_02',
      undefined,
      authHeader(tokens.admin)
    );
    assert(
      editSeededAtt.status === 200 && deleteSeededRes.status === 200,
      '6.2 Prepared MongoDB edits on seeded attendance (att_01 -> Leave) and deleted seeded result (res_02)'
    );

    // Run POST /api/mongodb/sync-all
    const syncAllRes = await httpRequest(
      serverPort,
      'POST',
      '/api/mongodb/sync-all',
      {},
      authHeader(tokens.super_admin)
    );
    const att01AfterSync = await inspectorConn.collection('attendances').findOne({ record_id: 'att_01' });
    const res02AfterSync = await inspectorConn.collection('results').findOne({ record_id: 'res_02' });
    const novFeeAfterSync = await inspectorConn.collection('fees').findOne({ voucher_id: createdFeeId });

    assert(
      syncAllRes.status === 200 &&
        att01AfterSync?.status === 'Leave' &&
        res02AfterSync === null &&
        novFeeAfterSync?.status === 'Paid',
      '6.3 POST /api/mongodb/sync-all preserves MongoDB edits and does NOT resurrect deleted migrated records'
    );

    // Restart backend server against the same MongoDB instance and verify persistence
    await stopChild(serverHandle.child);
    serverPort = await getFreePort();
    serverHandle = spawnIsolatedServer(serverPort, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbPath,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
      JWT_SECRET: testSecret,
    });
    await waitForHealth(serverPort);

    const loginAdminAfterRestart = await httpRequest(serverPort, 'POST', '/api/auth/login', {
      email: 'office@shawanschool.edu.pk',
      password: 'AdminPassword123!',
    });
    const restartAdminToken = loginAdminAfterRestart.data.token;

    const attAfterRestart = await httpRequest(
      serverPort,
      'GET',
      '/api/attendance?student_id=std_01&date=2026-09-28',
      undefined,
      authHeader(restartAdminToken)
    );
    const resAfterRestart = await httpRequest(
      serverPort,
      'GET',
      '/api/results',
      undefined,
      authHeader(restartAdminToken)
    );
    const feesAfterRestart = await httpRequest(
      serverPort,
      'GET',
      '/api/fees?student_id=std_01',
      undefined,
      authHeader(restartAdminToken)
    );

    assert(
      attAfterRestart.status === 200 &&
        attAfterRestart.data[0]?.status === 'Leave' &&
        !resAfterRestart.data.some(r => r.id === 'res_02') &&
        resAfterRestart.data.some(r => r.id === createdResultId) &&
        feesAfterRestart.data.some(f => f.id === createdFeeId && f.status === 'Paid' && f.paid_amount === 4500),
      '6.4 Backend restart preserves MongoDB edits, new records, payments, and deletions without reverting to db.json',
      `attStatus=${attAfterRestart.data?.[0]?.status}, hasRes02=${resAfterRestart.data?.some?.(r => r.id === 'res_02')}, hasCreatedRes=${resAfterRestart.data?.some?.(r => r.id === createdResultId)}, hasPaidFee=${feesAfterRestart.data?.some?.(f => f.id === createdFeeId && f.status === 'Paid')}`
    );

    // =========================================================================
    // SECTION 2 (CONTINUED): MONGODB UNAVAILABILITY -> HTTP 503 FAIL-CLOSED
    // =========================================================================
    console.log('\n--- SECTION 2B: MONGODB OFFLINE FAIL-CLOSED (HTTP 503) VERIFICATION ---');

    await inspectorConn.close();
    inspectorConn = null;
    await memServer.stop();
    memServer = null;

    // Wait briefly for Mongoose connection state to detect disconnect
    await new Promise(r => setTimeout(r, 800));

    const healthWhenOffline = await httpRequest(serverPort, 'GET', '/api/health');
    assert(
      healthWhenOffline.status === 503 &&
        healthWhenOffline.data?.connected === false &&
        healthWhenOffline.data?.status === 'degraded' &&
        hasNoSecretOrStackLeak(healthWhenOffline.raw, testSecret),
      '2.7 GET /api/health returns HTTP 503 (connected=false, status=degraded) when MongoDB is unavailable',
      JSON.stringify(healthWhenOffline.data)
    );

    const offlineChecks = await Promise.all([
      httpRequest(serverPort, 'GET', '/api/attendance', undefined, authHeader(restartAdminToken)),
      httpRequest(
        serverPort,
        'POST',
        '/api/attendance/batch',
        { date: '2026-10-20', records: [{ student_id: 'std_01', status: 'Present' }] },
        authHeader(restartAdminToken)
      ),
      httpRequest(serverPort, 'GET', '/api/results', undefined, authHeader(restartAdminToken)),
      httpRequest(serverPort, 'GET', '/api/fees', undefined, authHeader(restartAdminToken)),
      httpRequest(
        serverPort,
        'PUT',
        '/api/fees/fee_ahmad_sep_2026/pay',
        { amount: 500, method: 'Cash' },
        authHeader(restartAdminToken)
      ),
      httpRequest(serverPort, 'GET', '/api/dashboard/stats', undefined, authHeader(restartAdminToken)),
      httpRequest(serverPort, 'GET', '/api/students/std_01', undefined, authHeader(restartAdminToken)),
      httpRequest(serverPort, 'GET', '/api/audit-logs', undefined, authHeader(restartAdminToken)),
      httpRequest(serverPort, 'POST', '/api/mongodb/sync-all', {}, authHeader(restartAdminToken)),
    ]);

    const all503 = offlineChecks.every(
      r => r.status === 503 && hasNoSecretOrStackLeak(r.raw, testSecret)
    );
    assert(
      all503,
      `2.8 Protected operational endpoints return HTTP 503 with sanitized errors when MongoDB is unavailable (${offlineChecks.map(r => r.status).join(',')})`
    );

    // Confirm neither temporary db.json nor real data/db.json was modified at any point
    const finalTmpDbHash = sha256File(tmpDbPath);
    const finalRealDbHash = sha256File(REAL_DB_PATH);
    assert(
      finalTmpDbHash === initialTmpDbHash && finalRealDbHash === initialRealDbHash,
      `6.5 Zero runtime writes to db.json (real data/db.json SHA-256 unchanged: ${finalRealDbHash})`
    );

    console.log('\n--- EXECUTED ROLE & IDOR HTTP STATUS SUMMARY ---');
    for (const row of matrixRecords) {
      console.log(`  [${row.status}] ${row.actor.padEnd(15)} | ${row.method.padEnd(6)} ${row.urlPath} (${row.feature})`);
    }
  } finally {
    if (inspectorConn) {
      await inspectorConn.close().catch(() => {});
    }
    if (serverHandle) {
      await stopChild(serverHandle.child);
    }
    if (memServer) {
      await memServer.stop().catch(() => {});
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('\n========================================================================');
  console.log(`PHASE 11 FINAL VERIFICATION SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('========================================================================');
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in Phase 11 verification suite:', err);
  process.exit(1);
});
