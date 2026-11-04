/**
 * PHASE 10 — ATTENDANCE, EXAMINATION RESULTS & FEE MANAGEMENT
 * MONGODB-AUTHORITATIVE MIGRATION VERIFICATION SUITE
 *
 * Modules Verified:
 *   1. Attendance (/api/attendance*, /api/teacher/attendance*)
 *   2. Examination Results (/api/results*, /api/teacher/results*)
 *   3. Fee Vouchers & Fee Payment Ledger (/api/fees*, FeeModel + FeePaymentModel)
 *   4. Cross-Module Operational Consumers (/api/dashboard/stats, /api/students/:id,
 *      /api/audit-logs, /api/portal/ai/query, /api/teacher/*, /api/admin/ai/query)
 *   5. Complete Runtime Retirement of server/db.ts
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
      JWT_SECRET: 'phase10-operational-test-secret-key-2026-secure-verified',
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

async function run() {
  console.log('=========================================================================');
  console.log(' PHASE 10 — ATTENDANCE, RESULTS & FEES MONGODB MIGRATION VERIFICATION');
  console.log('=========================================================================\n');

  const realDbHashBefore = sha256File(REAL_DB_PATH);
  const realUploadsBefore = listDirSnapshot(REAL_UPLOADS_DIR);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shawan-phase10-'));
  const tmpDbPath = path.join(tmpRoot, 'db.json');
  const tmpUploadsDir = path.join(tmpRoot, 'uploads');
  fs.mkdirSync(tmpUploadsDir, { recursive: true });

  // Copy real db.json to temp path and include a legacy Unpaid voucher + legacy Partial voucher to verify full backfill & deletion non-resurrection
  const baseDbRaw = JSON.parse(fs.readFileSync(REAL_DB_PATH, 'utf8'));
  baseDbRaw.fees.push(
    {
      id: 'fee_legacy_partial',
      student_id: 'std_04',
      student_name: 'Fatima Bibi',
      class_name: '2nd Year (ICS Computer Science)',
      fee_month: 'October',
      year: 2026,
      tuition_fee: 4000,
      admission_fee: 0,
      other_charges: 500,
      total_amount: 4500,
      paid_amount: 1500,
      pending_amount: 3000,
      due_date: '2026-10-15',
      status: 'Partial',
      payment_history: [
        {
          receipt_no: 'REC-LEG-9901',
          date: '2026-10-05',
          amount: 1500,
          method: 'Cash',
          notes: 'Legacy partial installment',
        },
      ],
    },
    {
      id: 'fee_legacy_unpaid_del',
      student_id: 'std_05',
      student_name: 'Bilal Khan',
      class_name: 'Grade 7 - Middle',
      fee_month: 'October',
      year: 2026,
      tuition_fee: 2600,
      admission_fee: 0,
      other_charges: 0,
      total_amount: 2600,
      paid_amount: 0,
      pending_amount: 2600,
      due_date: '2026-10-15',
      status: 'Unpaid',
      payment_history: [],
    }
  );
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
  let serverProc = null;

  try {
    // 0. Static code audit: ensure zero server/db.ts imports or runtime calls in server/routes.ts
    console.log('[0] Static Runtime Code Audit (Retirement of server/db.ts)');
    const routesSrc = fs.readFileSync(path.resolve(ROOT_DIR, 'server', 'routes.ts'), 'utf8');
    const hasDbImport = /from\s+['"]\.\/db(?:\.ts)?['"]/.test(routesSrc);
    const hasDbCall = /\bdb\.(getData|save|logAudit)\b/.test(routesSrc);
    assert(!hasDbImport && !hasDbCall, 'server/routes.ts has zero imports or runtime calls to server/db.ts');

    const mongoPort = await getFreePort();
    const mongoDbPath = path.join(tmpRoot, 'mongo-data');
    fs.mkdirSync(mongoDbPath, { recursive: true });

    mongod = await MongoMemoryServer.create({
      instance: {
        port: mongoPort,
        dbPath: mongoDbPath,
        storageEngine: 'wiredTiger',
      },
    });
    const mongoUri = mongod.getUri('shawan_phase10_test');

    let appPort = await getFreePort();
    serverProc = spawnIsolatedServer(appPort, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbPath,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });
    await waitForHealth(appPort);

    // Authenticate all 5 roles
    // usr_teacher_1 -> tch_01 (Grade 9 - Matric, Grade 10 - Matric, 1st Year F.Sc, 2nd Year F.Sc; Physics)
    // usr_student_1 -> std_01 (Muhammad Hamza, Grade 10 - Matric)
    // usr_parent_1  -> linked to std_01 & std_1790704405564
    const [superLogin, adminLogin, teacherLogin, studentLogin, parentLogin] = await Promise.all([
      httpRequest(appPort, 'POST', '/api/auth/login', { email: 'admin@shawanschool.edu.pk', password: 'AdminPassword123!' }, { 'X-Forwarded-For': '10.10.1.1' }),
      httpRequest(appPort, 'POST', '/api/auth/login', { email: 'office@shawanschool.edu.pk', password: 'AdminPassword123!' }, { 'X-Forwarded-For': '10.10.1.2' }),
      httpRequest(appPort, 'POST', '/api/auth/login', { email: 'teacher@shawanschool.edu.pk', password: 'TeacherPassword123!' }, { 'X-Forwarded-For': '10.10.1.3' }),
      httpRequest(appPort, 'POST', '/api/auth/login', { email: 'student@shawanschool.edu.pk', password: 'StudentPassword123!' }, { 'X-Forwarded-For': '10.10.1.4' }),
      httpRequest(appPort, 'POST', '/api/auth/login', { email: 'parent@shawanschool.edu.pk', password: 'ParentPassword123!' }, { 'X-Forwarded-For': '10.10.1.5' }),
    ]);

    const adminHdr = { Authorization: `Bearer ${adminLogin.data.token}` };
    const teacherHdr = { Authorization: `Bearer ${teacherLogin.data.token}` };

    assert(
      superLogin.status === 200 && adminLogin.status === 200 && teacherLogin.status === 200 && studentLogin.status === 200 && parentLogin.status === 200,
      'All 5 role accounts authenticate cleanly against MongoDB'
    );

    // -------------------------------------------------------------------------
    // 1. LEGACY BACKFILL & DTO CONTRACT VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n[1] Legacy Backfill & API DTO Contract Verification');
    const attListRes = await httpRequest(appPort, 'GET', '/api/attendance?paginate=true&limit=50', undefined, adminHdr);
    assert(
      attListRes.status === 200 &&
        Array.isArray(attListRes.data?.data) &&
        attListRes.data.pagination.total >= 13 &&
        attListRes.headers['x-total-count'] !== undefined,
      'GET /api/attendance returns MongoDB-backfilled attendance with pagination headers and envelope'
    );

    const legacyAtt01 = attListRes.data.data.find(a => a.id === 'att_01');
    assert(
      Boolean(legacyAtt01 && legacyAtt01.student_id === 'std_01' && legacyAtt01.date === '2026-09-28' && legacyAtt01.status === 'Present'),
      'Legacy attendance record ID att_01 (std_01 on 2026-09-28) and fields preserved in MongoDB DTO'
    );

    const resListRes = await httpRequest(appPort, 'GET', '/api/results', undefined, adminHdr);
    const legacyRes01 = Array.isArray(resListRes.data) ? resListRes.data.find(r => r.id === 'res_01') : null;
    const legacyRes02 = Array.isArray(resListRes.data) ? resListRes.data.find(r => r.id === 'res_02') : null;
    assert(
      resListRes.status === 200 && Boolean(legacyRes01) && Boolean(legacyRes02) && Array.isArray(legacyRes01.subjects),
      'GET /api/results returns backfilled legacy results res_01 and res_02 with subject breakdowns'
    );

    const feesListRes = await httpRequest(appPort, 'GET', '/api/fees', undefined, adminHdr);
    const legacyFee01 = Array.isArray(feesListRes.data) ? feesListRes.data.find(f => f.id === 'fee_01') : null;
    const legacyFee03 = Array.isArray(feesListRes.data) ? feesListRes.data.find(f => f.id === 'fee_03') : null;
    const legacyPartial = Array.isArray(feesListRes.data) ? feesListRes.data.find(f => f.id === 'fee_legacy_partial') : null;
    const legacyUnpaid = Array.isArray(feesListRes.data) ? feesListRes.data.find(f => f.id === 'fee_legacy_unpaid_del') : null;
    assert(
      feesListRes.status === 200 &&
        Boolean(legacyFee01 && legacyFee01.status === 'Paid' && legacyFee01.payment_history.length === 1) &&
        Boolean(legacyFee03 && legacyFee03.status === 'Paid' && legacyFee03.payment_history.length === 2) &&
        Boolean(legacyPartial && legacyPartial.status === 'Partial' && legacyPartial.pending_amount === 3000) &&
        Boolean(legacyUnpaid && legacyUnpaid.status === 'Unpaid' && legacyUnpaid.pending_amount === 2600),
      'GET /api/fees preserves Paid, Partial, and Unpaid legacy vouchers with full payment_history'
    );

    // -------------------------------------------------------------------------
    // 2. CRUD MUTATIONS & ZERO DUAL-WRITE TO db.json
    // -------------------------------------------------------------------------
    console.log('\n[2] Operational Writes & Zero Dual-Write Verification');

    // 2a. Update existing legacy attendance att_01 (std_01 on 2026-09-28 -> Late) + mark new date 2026-10-12
    const batchAttRes = await httpRequest(
      appPort,
      'POST',
      '/api/attendance/batch',
      {
        date: '2026-09-28',
        records: [
          {
            student_id: 'std_01',
            student_name: 'Muhammad Hamza',
            class_name: 'Grade 10 - Matric',
            section: 'A (Science)',
            status: 'Late',
            remarks: 'Bus delay verified in Phase 10',
          },
        ],
      },
      adminHdr
    );
    assert(batchAttRes.status === 200, 'POST /api/attendance/batch updates existing student/date attendance in MongoDB');

    const teacherMarkAttRes = await httpRequest(
      appPort,
      'POST',
      '/api/teacher/attendance',
      {
        date: '2026-10-12',
        class_name: 'Grade 10 - Matric',
        section: 'A',
        records: [
          {
            student_id: 'std_01',
            student_name: 'Muhammad Hamza',
            status: 'Present',
            remarks: 'On time',
          },
        ],
      },
      teacherHdr
    );
    assert(teacherMarkAttRes.status === 200 && teacherMarkAttRes.data?.success === true, 'POST /api/teacher/attendance saves assigned class attendance to MongoDB');

    // 2b. Create a new result for std_01 on ex_01, update via teacher marks, toggle publish, and delete legacy res_02
    const examsRes = await httpRequest(appPort, 'GET', '/api/exams', undefined, adminHdr);
    const targetExam = examsRes.data.find(e => e.id === 'ex_01') || examsRes.data[0];
    const createResResp = await httpRequest(
      appPort,
      'POST',
      '/api/results',
      {
        exam_id: targetExam.id,
        exam_title: targetExam.title,
        student_id: 'std_01',
        subjects: [
          { subject_name: 'Physics', total_marks: 100, obtained_marks: 88 },
          { subject_name: 'Mathematics', total_marks: 100, obtained_marks: 92 },
        ],
        remarks: 'Outstanding Phase 10 performance',
        published: true,
      },
      adminHdr
    );
    assert(
      createResResp.status === 201 && createResResp.data?.percentage === 90 && createResResp.data?.id,
      'POST /api/results calculates marks/grade and persists result in MongoDB'
    );
    const std01NewResultId = createResResp.data.id;

    // Teacher records Physics marks for std_01 on targetExam
    const teacherResPost = await httpRequest(
      appPort,
      'POST',
      '/api/teacher/results',
      {
        exam_id: targetExam.id,
        exam_title: targetExam.title,
        student_id: 'std_01',
        subject_name: 'Physics',
        total_marks: 100,
        obtained_marks: 94,
        remarks: 'Excellent lab work',
      },
      teacherHdr
    );
    assert(
      teacherResPost.status === 200 && teacherResPost.data?.result?.obtained_marks === 186,
      'POST /api/teacher/results upserts subject marks in MongoDB and recalculates total (94 + 92 = 186)'
    );

    // Unpublish legacy res_01 to verify state persistence across restart
    const unpubRes01 = await httpRequest(appPort, 'PATCH', '/api/results/res_01/publish', { published: false }, adminHdr);
    assert(unpubRes01.status === 200 && unpubRes01.data?.published === false, 'PATCH /api/results/res_01/publish sets published=false in MongoDB');

    // Delete legacy res_02 to verify non-resurrection across restart
    const delRes02 = await httpRequest(appPort, 'DELETE', '/api/results/res_02', undefined, adminHdr);
    assert(delRes02.status === 200 && delRes02.data?.item?.id === 'res_02', 'DELETE /api/results/res_02 removes result from MongoDB');

    // 2c. Issue a new fee voucher for std_01, pay partial, settle legacy partial voucher, and delete legacy unpaid voucher
    const createFeePayable = await httpRequest(
      appPort,
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
      adminHdr
    );
    assert(
      createFeePayable.status === 201 &&
        createFeePayable.data?.total_amount === 4500 &&
        createFeePayable.data?.pending_amount === 4500 &&
        createFeePayable.data?.status === 'Unpaid',
      'POST /api/fees creates new Unpaid voucher in MongoDB'
    );
    const novVoucherId = createFeePayable.data.id;

    // Partial payment of 2000 on novVoucherId
    const partialPayRes = await httpRequest(
      appPort,
      'PUT',
      `/api/fees/${novVoucherId}/pay`,
      {
        amount: 2000,
        method: 'Bank Transfer',
        transaction_id: 'TXN-PH10-NOV-001',
        notes: 'First installment',
      },
      adminHdr
    );
    assert(
      partialPayRes.status === 200 &&
        partialPayRes.data?.fee?.status === 'Partial' &&
        partialPayRes.data?.fee?.paid_amount === 2000 &&
        partialPayRes.data?.fee?.pending_amount === 2500,
      'PUT /api/fees/:id/pay records partial payment and updates balance to Partial (paid=2000, pending=2500)'
    );

    // Settle legacy partial voucher fee_legacy_partial remaining 3000 balance to verify legacy voucher payment survives restart
    const settleLegacyPartial = await httpRequest(
      appPort,
      'PUT',
      '/api/fees/fee_legacy_partial/pay',
      {
        amount: 3000,
        method: 'Cash',
        transaction_id: 'TXN-PH10-LEG-SETTLE',
        notes: 'Final settlement of fee_legacy_partial',
      },
      adminHdr
    );
    assert(
      settleLegacyPartial.status === 200 &&
        settleLegacyPartial.data?.fee?.status === 'Paid' &&
        settleLegacyPartial.data?.fee?.pending_amount === 0 &&
        settleLegacyPartial.data?.fee?.payment_history?.length === 2,
      'PUT /api/fees/fee_legacy_partial/pay settles legacy partial voucher to Paid with 2 payment_history entries'
    );

    // Delete unpaid legacy voucher fee_legacy_unpaid_del to verify non-resurrection across restart
    const delUnpaidLegacy = await httpRequest(appPort, 'DELETE', '/api/fees/fee_legacy_unpaid_del', undefined, adminHdr);
    assert(
      delUnpaidLegacy.status === 200 && delUnpaidLegacy.data?.item?.id === 'fee_legacy_unpaid_del',
      'DELETE /api/fees/fee_legacy_unpaid_del deletes unpaid voucher cleanly'
    );

    // Confirm tmpDbPath was NOT touched by any operational mutation!
    assert(
      sha256File(tmpDbPath) === tmpDbInitialHash,
      'Zero dual-write verified: temporary db.json checksum is 100% unchanged after attendance, result, fee, and payment writes'
    );

    // -------------------------------------------------------------------------
    // 3. SERVER RESTART + /api/mongodb/sync-all IDEMPOTENCY
    // -------------------------------------------------------------------------
    console.log('\n[3] Full Server Restart & Sync-All Idempotency Verification');
    await stopProcess(serverProc.child);

    appPort = await getFreePort();
    serverProc = spawnIsolatedServer(appPort, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbPath,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });
    await waitForHealth(appPort);

    const superLogin2 = await httpRequest(
      appPort,
      'POST',
      '/api/auth/login',
      { email: 'admin@shawanschool.edu.pk', password: 'AdminPassword123!' },
      { 'X-Forwarded-For': '10.10.2.1' }
    );
    const superHdr2 = { Authorization: `Bearer ${superLogin2.data.token}` };

    const syncAllRes = await httpRequest(appPort, 'POST', '/api/mongodb/sync-all', {}, superHdr2);
    assert(syncAllRes.status === 200, 'POST /api/mongodb/sync-all succeeds idempotently after operational edits');

    // Verify attendance edits & new records survived restart + sync-all without legacy clobbering
    const std01AttAfter = await httpRequest(appPort, 'GET', '/api/attendance/student/std_01', undefined, superHdr2);
    const attSept28After = std01AttAfter.data?.records?.find(r => r.date === '2026-09-28');
    const attOct12After = std01AttAfter.data?.records?.find(r => r.date === '2026-10-12');
    assert(
      attSept28After?.status === 'Late' && attSept28After?.id === 'att_01' && attOct12After?.status === 'Present',
      'Attendance update (att_01 2026-09-28=Late) and new entry (2026-10-12=Present) survive server restart and sync-all'
    );

    // Verify result edits, unpublish state, and deletion survived restart + sync-all
    const resultsAfter = await httpRequest(appPort, 'GET', '/api/results', undefined, superHdr2);
    const res01After = resultsAfter.data.find(r => r.id === 'res_01');
    const res02After = resultsAfter.data.find(r => r.id === 'res_02');
    const std01NewResAfter = resultsAfter.data.find(r => r.id === std01NewResultId);
    assert(
      res01After?.published === false && !res02After && std01NewResAfter?.obtained_marks === 186,
      'Result publish state (res_01=false), deletion (res_02 not resurrected), and updated marks persist across restart'
    );

    // Verify fee payments, balances, and unpaid voucher deletion survived restart + sync-all
    const feesAfter = await httpRequest(appPort, 'GET', '/api/fees', undefined, superHdr2);
    const partialAfter = feesAfter.data.find(f => f.id === 'fee_legacy_partial');
    const unpaidDelAfter = feesAfter.data.find(f => f.id === 'fee_legacy_unpaid_del');
    const novFeeAfter = feesAfter.data.find(f => f.id === novVoucherId);
    assert(
      partialAfter?.status === 'Paid' &&
        partialAfter?.pending_amount === 0 &&
        !unpaidDelAfter &&
        novFeeAfter?.status === 'Partial' &&
        novFeeAfter?.paid_amount === 2000 &&
        novFeeAfter?.pending_amount === 2500,
      'Fee payments (fee_legacy_partial=Paid, novVoucher=Partial) and deleted unpaid voucher (absent) survive restart & sync-all'
    );

    // Verify dashboard stats and student dossier reflect authoritative MongoDB values
    const dashStats = await httpRequest(appPort, 'GET', '/api/dashboard/stats', undefined, superHdr2);
    const expectedPendingTotal = feesAfter.data.reduce((s, f) => s + (f.pending_amount || 0), 0);
    const expectedCollectedTotal = feesAfter.data.reduce((s, f) => s + (f.paid_amount || 0), 0);
    assert(
      dashStats.status === 200 &&
        dashStats.data?.totalPendingFee === expectedPendingTotal &&
        dashStats.data?.totalCollectedFee === expectedCollectedTotal,
      'GET /api/dashboard/stats computes fee totals directly from authoritative MongoDB FeeModel'
    );

    const std01Dossier = await httpRequest(appPort, 'GET', '/api/students/std_01', undefined, superHdr2);
    assert(
      std01Dossier.status === 200 &&
        std01Dossier.data?.feeSummary?.pending_amount === 2500 &&
        Array.isArray(std01Dossier.data?.attendance) &&
        std01Dossier.data.attendance.some(a => a.date === '2026-10-12'),
      'GET /api/students/std_01 dossier reflects MongoDB attendance, fees, and results'
    );

    const auditRes = await httpRequest(appPort, 'GET', '/api/audit-logs?limit=50', undefined, superHdr2);
    assert(
      auditRes.status === 200 &&
        Array.isArray(auditRes.data) &&
        auditRes.data.some(l => l.target_type === 'Fee') &&
        auditRes.data.some(l => l.target_type === 'Attendance') &&
        auditRes.data.some(l => l.target_type === 'Result'),
      'GET /api/audit-logs contains MongoDB audit entries for Attendance, Result, and Fee mutations'
    );

    // -------------------------------------------------------------------------
    // 4. VALIDATION, UNIQUENESS, CONCURRENCY & LEDGER PROTECTION
    // -------------------------------------------------------------------------
    console.log('\n[4] Validation, Uniqueness, Concurrency & Financial Ledger Integrity');

    // Invalid attendance date & status & unknown student
    const badAttDate = await httpRequest(
      appPort,
      'POST',
      '/api/attendance/batch',
      { date: '2026-02-30', records: [{ student_id: 'std_01', status: 'Present' }] },
      superHdr2
    );
    const badAttStatus = await httpRequest(
      appPort,
      'POST',
      '/api/attendance/batch',
      { date: '2026-10-15', records: [{ student_id: 'std_01', status: 'Truant' }] },
      superHdr2
    );
    const badAttStudent = await httpRequest(
      appPort,
      'POST',
      '/api/attendance/batch',
      { date: '2026-10-15', records: [{ student_id: 'std_nonexistent_999', status: 'Present' }] },
      superHdr2
    );
    assert(
      badAttDate.status === 400 && badAttStatus.status === 400 && badAttStudent.status === 400,
      'Attendance validation rejects impossible date (2026-02-30), invalid status, and unknown student_id with 400'
    );

    // Invalid result marks & unknown exam
    const badResMarks = await httpRequest(
      appPort,
      'POST',
      '/api/results',
      {
        exam_id: targetExam.id,
        student_id: 'std_01',
        subjects: [{ subject_name: 'Physics', total_marks: 100, obtained_marks: 105 }],
      },
      superHdr2
    );
    const badResNeg = await httpRequest(
      appPort,
      'POST',
      '/api/results',
      {
        exam_id: targetExam.id,
        student_id: 'std_01',
        subjects: [{ subject_name: 'Physics', total_marks: 100, obtained_marks: -5 }],
      },
      superHdr2
    );
    const badResExam = await httpRequest(
      appPort,
      'POST',
      '/api/results',
      {
        exam_id: 'ex_missing_999',
        student_id: 'std_01',
        subjects: [{ subject_name: 'Physics', total_marks: 100, obtained_marks: 80 }],
      },
      superHdr2
    );
    assert(
      badResMarks.status === 400 && badResNeg.status === 400 && badResExam.status === 400,
      'Result validation rejects obtained > total, negative marks, and nonexistent exam_id with 400'
    );

    // Duplicate fee voucher check (case-insensitive month) + concurrent creation race
    const dupFeeCase = await httpRequest(
      appPort,
      'POST',
      '/api/fees',
      { student_id: 'std_01', fee_month: 'november', year: 2026, tuition_fee: 4000 },
      superHdr2
    );
    assert(dupFeeCase.status === 409, 'POST /api/fees rejects case-insensitive duplicate (student_id, fee_month, year) with 409');

    const [raceFeeA, raceFeeB] = await Promise.all([
      httpRequest(appPort, 'POST', '/api/fees', { student_id: 'std_01', fee_month: 'December', year: 2026, tuition_fee: 4200 }, superHdr2),
      httpRequest(appPort, 'POST', '/api/fees', { student_id: 'std_01', fee_month: 'December', year: 2026, tuition_fee: 4200 }, superHdr2),
    ]);
    const feeStatuses = [raceFeeA.status, raceFeeB.status].sort((a, b) => a - b);
    assert(
      feeStatuses[0] === 201 && feeStatuses[1] === 409,
      'Concurrent duplicate fee voucher race allows exactly one 201 and rejects duplicate with 409'
    );

    // Fee payment validations: overpayment, duplicate transaction_id, payment on Paid voucher, concurrent final payment race, paid-voucher delete block
    const overPay = await httpRequest(
      appPort,
      'PUT',
      `/api/fees/${novVoucherId}/pay`,
      { amount: 9999, method: 'Cash' },
      superHdr2
    );
    const dupTxnPay = await httpRequest(
      appPort,
      'PUT',
      `/api/fees/${novVoucherId}/pay`,
      { amount: 500, method: 'Bank Transfer', transaction_id: 'TXN-PH10-NOV-001' },
      superHdr2
    );
    const settledPay = await httpRequest(
      appPort,
      'PUT',
      '/api/fees/fee_01/pay',
      { amount: 100, method: 'Cash' },
      superHdr2
    );
    assert(
      overPay.status === 400 && dupTxnPay.status === 409 && settledPay.status === 400,
      'Payment validation rejects overpayment (400), duplicate transaction_id (409), and payment on Paid voucher (400)'
    );

    // Concurrent final payment race on novVoucherId (remaining pending = 2500)
    const [concPay1, concPay2] = await Promise.all([
      httpRequest(appPort, 'PUT', `/api/fees/${novVoucherId}/pay`, { amount: 2500, method: 'Cash', transaction_id: 'TXN-CONC-1' }, superHdr2),
      httpRequest(appPort, 'PUT', `/api/fees/${novVoucherId}/pay`, { amount: 2500, method: 'Cash', transaction_id: 'TXN-CONC-2' }, superHdr2),
    ]);
    const payRaceStatuses = [concPay1.status, concPay2.status].sort((a, b) => a - b);
    const checkNovAfterRace = await httpRequest(appPort, 'GET', '/api/fees?student_id=std_01&month=November', undefined, superHdr2);
    const settledNov = checkNovAfterRace.data?.[0];
    assert(
      payRaceStatuses[0] === 200 &&
        (payRaceStatuses[1] === 400 || payRaceStatuses[1] === 409) &&
        settledNov?.paid_amount === 4500 &&
        settledNov?.pending_amount === 0 &&
        settledNov?.status === 'Paid' &&
        settledNov?.payment_history?.length === 2,
      'Concurrent full-balance payments allow exactly one 200 and prevent double-crediting'
    );

    const delPaidVoucher = await httpRequest(appPort, 'DELETE', `/api/fees/${novVoucherId}`, undefined, superHdr2);
    const delLegacyPaid = await httpRequest(appPort, 'DELETE', '/api/fees/fee_03', undefined, superHdr2);
    assert(
      delPaidVoucher.status === 400 && delLegacyPaid.status === 400,
      'DELETE /api/fees/:id blocks deletion of vouchers with recorded payment history (400)'
    );

    // -------------------------------------------------------------------------
    // 5. ROLE & OBJECT-LEVEL RBAC ACROSS ALL ROLES
    // -------------------------------------------------------------------------
    console.log('\n[5] Role & Object-Level Authorization (Teacher, Student, Parent, Unauthenticated)');

    const [tLogin2, sLogin2, pLogin2] = await Promise.all([
      httpRequest(appPort, 'POST', '/api/auth/login', { email: 'teacher@shawanschool.edu.pk', password: 'TeacherPassword123!' }, { 'X-Forwarded-For': '10.10.3.1' }),
      httpRequest(appPort, 'POST', '/api/auth/login', { email: 'student@shawanschool.edu.pk', password: 'StudentPassword123!' }, { 'X-Forwarded-For': '10.10.3.2' }),
      httpRequest(appPort, 'POST', '/api/auth/login', { email: 'parent@shawanschool.edu.pk', password: 'ParentPassword123!' }, { 'X-Forwarded-For': '10.10.3.3' }),
    ]);
    const tHdr2 = { Authorization: `Bearer ${tLogin2.data.token}` };
    const sHdr2 = { Authorization: `Bearer ${sLogin2.data.token}` };
    const pHdr2 = { Authorization: `Bearer ${pLogin2.data.token}` };

    const unauthAtt = await httpRequest(appPort, 'GET', '/api/attendance');
    const unauthFees = await httpRequest(appPort, 'GET', '/api/fees');
    const unauthRes = await httpRequest(appPort, 'GET', '/api/results');
    assert(
      unauthAtt.status === 401 && unauthFees.status === 401 && unauthRes.status === 401,
      'Unauthenticated requests to /api/attendance, /api/fees, and /api/results are blocked with 401'
    );

    // Teacher RBAC: tch_01 is assigned to Grade 9/10 Matric & 1st/2nd Year F.Sc (Physics), NOT Grade 7 - Middle (std_05) or ICS (std_04)
    const tUnassignedAtt = await httpRequest(appPort, 'GET', '/api/attendance?class_name=Grade%207%20-%20Middle', undefined, tHdr2);
    const tUnassignedPostAtt = await httpRequest(
      appPort,
      'POST',
      '/api/teacher/attendance',
      {
        date: '2026-10-16',
        class_name: 'Grade 7 - Middle',
        records: [{ student_id: 'std_05', status: 'Present' }],
      },
      tHdr2
    );
    const tUnassignedRes = await httpRequest(
      appPort,
      'POST',
      '/api/results',
      {
        exam_id: targetExam.id,
        student_id: 'std_05',
        subjects: [{ subject_name: 'Physics', total_marks: 100, obtained_marks: 85 }],
      },
      tHdr2
    );
    const tWrongSubj = await httpRequest(
      appPort,
      'POST',
      '/api/teacher/results',
      {
        exam_id: targetExam.id,
        student_id: 'std_01',
        subject_name: 'Urdu Literature',
        total_marks: 100,
        obtained_marks: 80,
      },
      tHdr2
    );
    const tFeesGet = await httpRequest(appPort, 'GET', '/api/fees', undefined, tHdr2);
    const tDashStats = await httpRequest(appPort, 'GET', '/api/dashboard/stats', undefined, tHdr2);
    assert(
      tUnassignedAtt.status === 403 &&
        tUnassignedPostAtt.status === 403 &&
        tUnassignedRes.status === 403 &&
        tWrongSubj.status === 403 &&
        tFeesGet.status === 403 &&
        tDashStats.data?.totalPendingFee === 0 &&
        tDashStats.data?.recentFees?.length === 0,
      'Teacher is strictly restricted to assigned classes/subjects and blocked (403) from fee routes and unassigned classes'
    );

    // Student RBAC & Unpublished Result Visibility (usr_student_1 -> std_01)
    await httpRequest(appPort, 'PATCH', `/api/results/${std01NewResultId}/publish`, { published: false }, superHdr2);
    const sResHidden = await httpRequest(appPort, 'GET', '/api/results', undefined, sHdr2);
    const hiddenFound = Array.isArray(sResHidden.data) && sResHidden.data.some(r => r.id === std01NewResultId);
    await httpRequest(appPort, 'PATCH', `/api/results/${std01NewResultId}/publish`, { published: true }, superHdr2);
    const sResVisible = await httpRequest(appPort, 'GET', '/api/results', undefined, sHdr2);
    const visibleFound = Array.isArray(sResVisible.data) && sResVisible.data.some(r => r.id === std01NewResultId);

    const sOwnAtt = await httpRequest(appPort, 'GET', '/api/attendance/student/std_01', undefined, sHdr2);
    const sOwnFees = await httpRequest(appPort, 'GET', '/api/fees?student_id=std_01', undefined, sHdr2);
    const sOtherAtt = await httpRequest(appPort, 'GET', '/api/attendance/student/std_02', undefined, sHdr2);
    const sOtherFees = await httpRequest(appPort, 'GET', '/api/fees?student_id=std_02', undefined, sHdr2);
    const sWriteFee = await httpRequest(appPort, 'POST', '/api/fees', { student_id: 'std_01', fee_month: 'May', year: 2027 }, sHdr2);
    const sPortalAi = await httpRequest(appPort, 'POST', '/api/portal/ai/query', { prompt: 'Show my attendance and exam result' }, sHdr2);
    assert(
      sOwnAtt.status === 200 &&
        sOwnFees.status === 200 &&
        !hiddenFound &&
        visibleFound &&
        sOtherAtt.status === 403 &&
        sOtherFees.status === 403 &&
        sWriteFee.status === 403 &&
        sPortalAi.status === 200,
      'Student sees only own records and published results, is blocked (403) from other students/writes, and Portal AI works from MongoDB'
    );

    // Parent RBAC (usr_parent_1 -> linked to std_01, NOT linked to std_02)
    const pLinkedAtt = await httpRequest(appPort, 'GET', '/api/attendance/student/std_01', undefined, pHdr2);
    const pLinkedFees = await httpRequest(appPort, 'GET', '/api/fees?student_id=std_01', undefined, pHdr2);
    const pUnlinkedAtt = await httpRequest(appPort, 'GET', '/api/attendance/student/std_02', undefined, pHdr2);
    const pUnlinkedFees = await httpRequest(appPort, 'GET', '/api/fees?student_id=std_02', undefined, pHdr2);
    const pUnlinkedRes = await httpRequest(appPort, 'GET', '/api/results?student_id=std_02', undefined, pHdr2);
    const pPortalAi = await httpRequest(appPort, 'POST', '/api/portal/ai/query', { prompt: 'Which fees are pending?' }, pHdr2);
    assert(
      pLinkedAtt.status === 200 &&
        pLinkedFees.status === 200 &&
        pUnlinkedAtt.status === 403 &&
        pUnlinkedFees.status === 403 &&
        pUnlinkedRes.status === 403 &&
        pPortalAi.status === 200,
      'Parent accesses linked child attendance/fees/AI (200) and is blocked (403) from unlinked students'
    );

    // Admin AI Assistant consistency check
    const adminAiRes = await httpRequest(
      appPort,
      'POST',
      '/api/admin/ai/query',
      { prompt: 'Give me a summary of pending fees.' },
      superHdr2
    );
    assert(
      adminAiRes.status === 200 && typeof adminAiRes.data?.text === 'string' && adminAiRes.data.text.length > 10,
      'POST /api/admin/ai/query reads authoritative MongoDB operational collections cleanly'
    );

    // -------------------------------------------------------------------------
    // 6. FAIL-CLOSED 503 WHEN MONGODB IS UNAVAILABLE
    // -------------------------------------------------------------------------
    console.log('\n[6] Fail-Closed 503 Behavior When MongoDB Is Disconnected');
    await mongod.stop();
    mongod = null;

    const waitDisconnectStart = Date.now();
    while (Date.now() - waitDisconnectStart < 6000) {
      const checkRes = await httpRequest(appPort, 'GET', '/api/attendance', undefined, superHdr2);
      if (checkRes.status === 503) break;
      await new Promise(r => setTimeout(r, 200));
    }

    const [downAttGet, downAttPost, downResGet, downResPost, downFeeGet, downFeePost, downFeePay, downAuditGet] =
      await Promise.all([
        httpRequest(appPort, 'GET', '/api/attendance', undefined, superHdr2),
        httpRequest(appPort, 'POST', '/api/attendance/batch', { date: '2026-10-19', records: [{ student_id: 'std_01', status: 'Present' }] }, superHdr2),
        httpRequest(appPort, 'GET', '/api/results', undefined, superHdr2),
        httpRequest(appPort, 'POST', '/api/results', { exam_id: targetExam.id, student_id: 'std_01', subjects: [{ subject_name: 'Physics', total_marks: 100, obtained_marks: 80 }] }, superHdr2),
        httpRequest(appPort, 'GET', '/api/fees', undefined, superHdr2),
        httpRequest(appPort, 'POST', '/api/fees', { student_id: 'std_01', fee_month: 'January', year: 2027, tuition_fee: 4000 }, superHdr2),
        httpRequest(appPort, 'PUT', '/api/fees/fee_01/pay', { amount: 500, method: 'Cash' }, superHdr2),
        httpRequest(appPort, 'GET', '/api/audit-logs', undefined, superHdr2),
      ]);

    assert(
      downAttGet.status === 503 &&
        downAttPost.status === 503 &&
        downResGet.status === 503 &&
        downResPost.status === 503 &&
        downFeeGet.status === 503 &&
        downFeePost.status === 503 &&
        downFeePay.status === 503 &&
        downAuditGet.status === 503,
      'All Attendance, Results, Fees, Payments, and Audit Log endpoints fail closed with HTTP 503 when MongoDB is unavailable'
    );

    assert(
      sha256File(tmpDbPath) === tmpDbInitialHash,
      'Temporary db.json remained completely untouched even during MongoDB outage'
    );
  } finally {
    if (serverProc) {
      await stopProcess(serverProc.child);
    }
    if (mongod) {
      await mongod.stop();
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  // Verify real repository data/db.json and data/uploads/ were never mutated
  console.log('\n[7] Repository Data Integrity Guarantee');
  const realDbHashAfter = sha256File(REAL_DB_PATH);
  const realUploadsAfter = listDirSnapshot(REAL_UPLOADS_DIR);
  assert(
    realDbHashAfter === realDbHashBefore,
    `Real data/db.json SHA-256 unchanged (${realDbHashAfter.slice(0, 16)}...)`
  );
  assert(
    JSON.stringify(realUploadsAfter) === JSON.stringify(realUploadsBefore),
    'Real data/uploads/ directory snapshot unchanged'
  );

  console.log('\n=========================================================================');
  console.log(` PHASE 10 SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in Phase 10 verification suite:', err);
  process.exit(1);
});
