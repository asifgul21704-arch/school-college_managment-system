/**
 * PHASE 6 — PERSISTENT DATA ARCHITECTURE & DEPLOYMENT SAFETY VERIFICATION
 *
 * Verifies in complete isolation (dedicated MongoMemoryServer + temp DB_FILE_PATH + temp UPLOAD_STORAGE_DIR):
 *   A. Idempotent one-time backfill from db.json -> MongoDB preserving IDs, timestamps, and fields,
 *      with zero dual-writes back to db.json for the migrated Admissions module.
 *   B. True persistence across full OS server restarts (Process #1 -> Process #2 on same MONGODB_URI):
 *      creates persist, status/remark updates are NOT overwritten by stale db.json, and deleted
 *      records are NOT resurrected on restart or sync-all.
 *   C. Concurrent duplicate-application race protection (atomic partial unique index), rejection
 *      re-application lifecycle, input validation, and offline-DB failed-write safety (503, no false 200/201).
 *   D. Two-tier upload & document storage security: public school media vs private student/admission
 *      documents, blocking unauthenticated /uploads access and enforcing RBAC + ownership on /api/documents/:filename.
 *   E. Zero mutation or leakage into real data/db.json or data/uploads/.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const REAL_DB_PATH = path.resolve(ROOT, 'data', 'db.json');
const REAL_UPLOADS_DIR = path.resolve(ROOT, 'data', 'uploads');

const runId = Date.now();
const tmpDbFile = path.join(os.tmpdir(), `shawan_phase6_db_${runId}.json`);
const tmpUploadsDir = path.join(os.tmpdir(), `shawan_phase6_uploads_${runId}`);
const STRONG_PROD_JWT_SECRET = 'Phase6_Prod_Persistence_Verified_Jwt_Secret_2026_99887766!';

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

function httpRequest(port, method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const reqHeaders = { ...headers };
    if (payload !== undefined && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (payload !== undefined) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      { hostname: '127.0.0.1', port, path: reqPath, method, headers: reqHeaders },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const raw = buf.toString('utf8');
          let data = raw;
          try {
            data = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 500, headers: res.headers, data, raw, buffer: buf });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function bootServerProcess(port, envOverrides) {
  const proc = spawn('node', ['server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      JWT_SECRET: STRONG_PROD_JWT_SECRET,
      CORS_ORIGIN: 'https://portal.shawanschool.edu.pk',
      DB_FILE_PATH: tmpDbFile,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  proc.stdout.on('data', d => {
    logs += d.toString();
  });
  proc.stderr.on('data', d => {
    logs += d.toString();
  });

  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Server process exited prematurely (${proc.exitCode}):\n${logs}`);
    }
    try {
      const ping = await httpRequest(port, 'GET', '/api/settings');
      if (ping.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }

  if (!ready) {
    proc.kill('SIGTERM');
    throw new Error(`Timed out waiting for server on port ${port}:\n${logs}`);
  }

  return {
    proc,
    getLogs: () => logs,
    stop: () =>
      new Promise(resolve => {
        if (proc.exitCode !== null) return resolve();
        proc.once('exit', () => resolve());
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill('SIGKILL');
          resolve();
        }, 3000);
      }),
  };
}

async function run() {
  console.log('==================================================================');
  console.log('PHASE 6 — PERSISTENT DATA ARCHITECTURE & DEPLOYMENT SAFETY SUITE');
  console.log('==================================================================\n');

  const beforeRealUploads = fs.existsSync(REAL_UPLOADS_DIR) ? fs.readdirSync(REAL_UPLOADS_DIR) : [];

  // Build isolated seed db.json fixture (deterministic synthetic fixture, NOT mutating real school records)
  const rawTemplate = JSON.parse(fs.readFileSync(REAL_DB_PATH, 'utf8'));
  const fixtureData = {
    ...rawTemplate,
    admissions: [
      {
        id: 'adm_seed_01',
        application_no: 'ADM-2026-7001',
        student_name: 'Zainab Persistence Seed',
        father_name: 'Khalid Mahmood',
        dob: '2011-03-15',
        gender: 'Female',
        class_applying: 'Grade 9 - Matric',
        previous_school: 'Model School Paharpur',
        parent_phone: '+92 300 7001001',
        parent_email: 'khalid.seed1@example.com',
        address: 'Rangpur Road, Paharpur',
        documents: [{ title: 'B-Form', filename: 'bform_seed1.pdf', verified: true }],
        status: 'Approved',
        remarks: 'Initial approved seed record',
        created_at: '2026-09-10T09:00:00.000Z',
      },
      {
        id: 'adm_seed_02',
        application_no: 'ADM-2026-7002',
        student_name: 'Omar Persistence Seed',
        father_name: 'Farooq Shah',
        dob: '2010-08-20',
        gender: 'Male',
        class_applying: 'Grade 10 - Matric',
        previous_school: 'Allied Campus DI Khan',
        parent_phone: '+92 300 7002002',
        parent_email: 'farooq.seed2@example.com',
        address: 'Main Bazaar, Paharpur',
        documents: [],
        status: 'Under Review',
        remarks: 'Initial under-review seed record',
        created_at: '2026-09-18T11:30:00.000Z',
      },
      {
        id: 'adm_seed_03',
        application_no: 'ADM-2026-7003',
        student_name: 'Haris Delete Seed',
        father_name: 'Nadeem Iqbal',
        dob: '2014-01-12',
        gender: 'Male',
        class_applying: 'Grade 5 (Primary)',
        previous_school: 'City Primary Paharpur',
        parent_phone: '+92 300 7003003',
        parent_email: 'nadeem.seed3@example.com',
        address: 'Canal Colony, Paharpur',
        documents: [],
        status: 'Pending',
        remarks: 'To be deleted in Server #1 and verified absent after restart',
        created_at: '2026-09-25T14:00:00.000Z',
      },
    ],
  };
  fs.writeFileSync(tmpDbFile, JSON.stringify(fixtureData, null, 2), 'utf8');
  fs.mkdirSync(tmpUploadsDir, { recursive: true });

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const memMongo = await MongoMemoryServer.create({
    instance: { dbName: 'shawan_phase6_persistence_test' },
  });
  const mongoUri = memMongo.getUri();

  let server1 = null;
  let server2 = null;

  try {
    // ------------------------------------------------------------------
    // SECTION A: SERVER #1 — BACKFILL, ZERO DUAL-WRITE & CRUD MUTATIONS
    // ------------------------------------------------------------------
    console.log('--- Section A: MongoDB-Authoritative Backfill & Zero Dual-Write ---');
    const port1 = 3991;
    server1 = await bootServerProcess(port1, { MONGODB_URI: mongoUri });

    const loginAdmin = await httpRequest(
      port1,
      'POST',
      '/api/auth/login',
      { email: 'admin@shawanschool.edu.pk', password: 'AdminPassword123!' },
      { 'X-Forwarded-For': '198.51.100.10' }
    );
    const superToken = loginAdmin.data?.token;
    const superHeaders = { Authorization: `Bearer ${superToken}`, 'X-Forwarded-For': '198.51.100.10' };

    const initialList = await httpRequest(port1, 'GET', '/api/admissions', undefined, superHeaders);
    const seed1 = Array.isArray(initialList.data)
      ? initialList.data.find(a => a.application_no === 'ADM-2026-7001')
      : null;
    assert(
      initialList.status === 200 &&
        initialList.data.length === 3 &&
        seed1 &&
        seed1.id === 'adm_seed_01' &&
        seed1.created_at === '2026-09-10T09:00:00.000Z',
      'A1. Initial backfill preserves legacy id (adm_seed_01), application_no, and exact ISO created_at timestamp'
    );

    // Create a brand new admission in Server #1
    const createRes = await httpRequest(
      port1,
      'POST',
      '/api/admissions/apply',
      {
        student_name: 'Areeba Phase6 Applicant',
        father_name: 'Sajjad Hussain',
        dob: '2009-06-11',
        gender: 'Female',
        class_applying: '1st Year (F.Sc Pre-Medical)',
        previous_school: 'GHS Paharpur',
        parent_phone: '+92 312 6655443',
        parent_email: 'sajjad.p6@example.com',
        address: 'Ward 4, Paharpur',
        documents: [{ title: 'Matric DMC', filename: 'dmc_areeba.pdf' }],
      },
      { 'X-Forwarded-For': '198.51.100.11' }
    );
    const createdAppNo = createRes.data?.application_no;
    const createdId = createRes.data?.application?.id;
    const diskAfterCreate = JSON.parse(fs.readFileSync(tmpDbFile, 'utf8'));
    const leakedToDisk = (diskAfterCreate.admissions || []).some(
      a => a.application_no === createdAppNo || a.student_name === 'Areeba Phase6 Applicant'
    );
    assert(
      createRes.status === 201 && Boolean(createdAppNo) && !leakedToDisk,
      'A2. POST /api/admissions/apply persists to MongoDB and eliminates dual-write to db.json'
    );

    // Update adm_seed_02 status & remarks in Server #1
    const updateRes = await httpRequest(
      port1,
      'PUT',
      '/api/admissions/adm_seed_02/status',
      { status: 'Approved', remarks: 'Merit verified and persisted in MongoDB' },
      superHeaders
    );
    const diskSeed2 = JSON.parse(fs.readFileSync(tmpDbFile, 'utf8')).admissions.find(
      a => a.id === 'adm_seed_02'
    );
    assert(
      updateRes.status === 200 &&
        updateRes.data?.application?.status === 'Approved' &&
        diskSeed2?.status === 'Under Review',
      'A3. PUT /api/admissions/:id/status updates authoritative MongoDB document by legacy ID without mutating db.json'
    );

    // Delete adm_seed_03 in Server #1
    const deleteRes = await httpRequest(
      port1,
      'DELETE',
      '/api/admissions/adm_seed_03',
      undefined,
      superHeaders
    );
    const auditAfterOps = await httpRequest(port1, 'GET', '/api/audit-logs?limit=20', undefined, superHeaders);
    assert(
      deleteRes.status === 200 &&
        deleteRes.data?.application?.application_no === 'ADM-2026-7003' &&
        Array.isArray(auditAfterOps.data) &&
        auditAfterOps.data.some(l => l.action === 'Updated Admission Status' && l.target_id === 'adm_seed_02') &&
        auditAfterOps.data.some(l => l.action === 'Deleted Admission Application' && l.target_id === 'adm_seed_03'),
      'A4. DELETE /api/admissions/:id removes record from MongoDB and records verified audit history in AuditLogModel'
    );

    // Upload a private student PDF document in Server #1 before restart
    const samplePdfBase64 =
      'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF').toString('base64');
    const uploadPrivatePdf = await httpRequest(
      port1,
      'POST',
      '/api/upload',
      {
        dataUrl: samplePdfBase64,
        filename: 'student_bform_confidential.pdf',
        student_id: 'std_01',
        category: 'student_document',
      },
      superHeaders
    );
    const privateDocFilename = uploadPrivatePdf.data?.filename;
    const privateDocUrl = uploadPrivatePdf.data?.url;

    // ------------------------------------------------------------------
    // SECTION B: FULL SERVER PROCESS RESTART AGAINST SAME MONGODB_URI
    // ------------------------------------------------------------------
    console.log('\n--- Section B: Persistence Across Real Server Restarts ---');
    await server1.stop();
    server1 = null;

    const port2 = 3992;
    server2 = await bootServerProcess(port2, { MONGODB_URI: mongoUri });

    const loginAdmin2 = await httpRequest(
      port2,
      'POST',
      '/api/auth/login',
      { email: 'admin@shawanschool.edu.pk', password: 'AdminPassword123!' },
      { 'X-Forwarded-For': '198.51.100.12' }
    );
    const superHeaders2 = {
      Authorization: `Bearer ${loginAdmin2.data?.token}`,
      'X-Forwarded-For': '198.51.100.12',
    };

    const listAfterRestart = await httpRequest(port2, 'GET', '/api/admissions', undefined, superHeaders2);
    const trackCreatedAfterRestart = await httpRequest(
      port2,
      'GET',
      `/api/admissions/track/${createdAppNo}`,
      undefined,
      { 'X-Forwarded-For': '198.51.100.13' }
    );
    assert(
      listAfterRestart.status === 200 &&
        listAfterRestart.data.some(a => a.application_no === createdAppNo && a.id === createdId) &&
        trackCreatedAfterRestart.status === 200 &&
        trackCreatedAfterRestart.data?.application_no === createdAppNo &&
        Array.isArray(trackCreatedAfterRestart.data?.documents) &&
        trackCreatedAfterRestart.data.documents.length === 0 &&
        trackCreatedAfterRestart.data?.address === 'Masked for applicant privacy',
      'B1. Newly submitted application survives full server restart and public tracking preserves PII/document redaction'
    );

    const seed2AfterRestart = listAfterRestart.data.find(a => a.id === 'adm_seed_02');
    assert(
      seed2AfterRestart &&
        seed2AfterRestart.status === 'Approved' &&
        seed2AfterRestart.remarks === 'Merit verified and persisted in MongoDB',
      'B2. Updated admission status & remarks survive server restart without being clobbered by stale db.json'
    );

    const seed3InList = listAfterRestart.data.some(a => a.application_no === 'ADM-2026-7003');
    const trackDeleted = await httpRequest(
      port2,
      'GET',
      '/api/admissions/track/ADM-2026-7003',
      undefined,
      { 'X-Forwarded-For': '198.51.100.14' }
    );
    assert(
      !seed3InList && trackDeleted.status === 404,
      'B3. Deleted admission stays deleted across server restart (seedMongoFromLocal does NOT resurrect deleted records)'
    );

    const dashStats = await httpRequest(port2, 'GET', '/api/dashboard/stats', undefined, superHeaders2);
    // Expected in MongoDB right now: adm_seed_01 (Approved), adm_seed_02 (Approved), createdApp (Pending) => 2 Approved, 1 Pending, total 3
    assert(
      dashStats.status === 200 &&
        dashStats.data?.approvedAdmissions === 2 &&
        dashStats.data?.pendingAdmissions === 1 &&
        Array.isArray(dashStats.data?.recentAdmissions) &&
        dashStats.data.recentAdmissions.length === 3,
      'B4. GET /api/dashboard/stats reads authoritative admission metrics directly from MongoDB',
      JSON.stringify({
        approved: dashStats.data?.approvedAdmissions,
        pending: dashStats.data?.pendingAdmissions,
        recentLen: dashStats.data?.recentAdmissions?.length,
      })
    );

    const syncRes = await httpRequest(port2, 'POST', '/api/mongodb/sync-all', {}, superHeaders2);
    const listAfterSync = await httpRequest(port2, 'GET', '/api/admissions', undefined, superHeaders2);
    assert(
      syncRes.status === 200 &&
        listAfterSync.data.length === 3 &&
        !listAfterSync.data.some(a => a.application_no === 'ADM-2026-7003') &&
        listAfterSync.data.find(a => a.id === 'adm_seed_02')?.status === 'Approved',
      'B5. POST /api/mongodb/sync-all is idempotent: zero duplicates inserted, edits preserved, deletions respected'
    );

    // ------------------------------------------------------------------
    // SECTION C: CONCURRENT DUPLICATES, LIFECYCLE & FAILED-WRITE SAFETY
    // ------------------------------------------------------------------
    console.log('\n--- Section C: Concurrent Race Safety, Lifecycle & Failed Writes ---');

    const concurrentPayload = {
      student_name: 'Concurrent Race Applicant',
      father_name: 'Concurrent Guardian',
      dob: '2011-05-05',
      gender: 'Male',
      class_applying: 'Grade 8',
      parent_phone: '+92 333 9998887',
    };
    const raceResponses = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        httpRequest(port2, 'POST', '/api/admissions/apply', concurrentPayload, {
          'X-Forwarded-For': `198.51.101.${20 + idx}`,
        })
      )
    );
    const created201 = raceResponses.filter(r => r.status === 201);
    const conflict409 = raceResponses.filter(r => r.status === 409);
    assert(
      created201.length === 1 && conflict409.length === 7,
      'C1. 8 concurrent identical admission submissions yield exactly 1 created (201) and 7 conflicts (409)',
      `201=${created201.length}, 409=${conflict409.length}`
    );

    const winnerId = created201[0].data.application.id;
    const rejectWinner = await httpRequest(
      port2,
      'PUT',
      `/api/admissions/${winnerId}/status`,
      { status: 'Rejected', remarks: 'Incomplete prior session record' },
      superHeaders2
    );
    const reapplyAfterReject = await httpRequest(
      port2,
      'POST',
      '/api/admissions/apply',
      concurrentPayload,
      { 'X-Forwarded-For': '198.51.101.99' }
    );
    const reactivateConflict = await httpRequest(
      port2,
      'PUT',
      `/api/admissions/${winnerId}/status`,
      { status: 'Pending' },
      superHeaders2
    );
    assert(
      rejectWinner.status === 200 && reapplyAfterReject.status === 201 && reactivateConflict.status === 409,
      'C2. Rejected application allows clean re-application (201) and blocks conflicting re-activation (409)'
    );

    const badGender = await httpRequest(
      port2,
      'POST',
      '/api/admissions/apply',
      {
        student_name: 'Invalid Enum Test',
        father_name: 'Parent Test',
        gender: 'InvalidGender',
        class_applying: 'Grade 8',
        parent_phone: '+92 300 1230000',
      },
      { 'X-Forwarded-For': '198.51.101.105' }
    );
    const badStatus = await httpRequest(
      port2,
      'PUT',
      `/api/admissions/${winnerId}/status`,
      { status: 'ArchivedInvalid' },
      superHeaders2
    );
    assert(
      badGender.status === 400 && badStatus.status === 400,
      'C3. Invalid gender and status enum values are rejected on server with 400 Bad Request'
    );

    // C4: Disconnected Mongoose failed-write test in an isolated child runner (verifying 503 and zero db.json write)
    const offlineCheck = await new Promise((resolve, reject) => {
      const childScript = `
        import express from 'express';
        import http from 'http';
        import mongoose from 'mongoose';
        process.env.DB_FILE_PATH = ${JSON.stringify(tmpDbFile)};
        process.env.UPLOAD_STORAGE_DIR = ${JSON.stringify(tmpUploadsDir)};
        process.env.JWT_SECRET = ${JSON.stringify(STRONG_PROD_JWT_SECRET)};
        const { router } = await import('./server/routes.ts');
        // Ensure mongoose is disconnected (readyState === 0)
        if (mongoose.connection.readyState !== 0) {
          await mongoose.disconnect();
        }
        const app = express();
        app.use(express.json());
        app.use('/api', router);
        const srv = http.createServer(app);
        await new Promise(r => srv.listen(0, '127.0.0.1', r));
        const p = srv.address().port;
        const res = await fetch('http://127.0.0.1:' + p + '/api/admissions/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.102.1' },
          body: JSON.stringify({
            student_name: 'Offline Should Fail',
            father_name: 'Offline Father',
            class_applying: 'Grade 9 - Matric',
            parent_phone: '+92 300 0009999'
          }),
        });
        const body = await res.json();
        srv.close();
        console.log(JSON.stringify({ status: res.status, error: body.error }));
      `;
      const child = spawn('node', ['--input-type=module', '-e', childScript], { cwd: ROOT });
      let out = '';
      let errOut = '';
      child.stdout.on('data', d => (out += d.toString()));
      child.stderr.on('data', d => (errOut += d.toString()));
      child.on('close', code => {
        if (code !== 0) return reject(new Error(errOut || `Exited ${code}`));
        try {
          resolve(JSON.parse(out.trim().split('\n').pop()));
        } catch (e) {
          reject(e);
        }
      });
    });
    const diskAfterOffline = JSON.parse(fs.readFileSync(tmpDbFile, 'utf8'));
    assert(
      offlineCheck.status === 503 &&
        !diskAfterOffline.admissions.some(a => a.student_name === 'Offline Should Fail'),
      'C4. When MongoDB is offline, write fails safely with HTTP 503 (never fabricates 201 or falls back to db.json)'
    );

    // ------------------------------------------------------------------
    // SECTION D: UPLOAD & PRIVATE STUDENT DOCUMENT ACCESS CONTROL
    // ------------------------------------------------------------------
    console.log('\n--- Section D: File & Student Document Storage Security ---');

    const tinyPngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const pubImgUpload = await httpRequest(
      port2,
      'POST',
      '/api/upload',
      { dataUrl: tinyPngBase64, filename: 'campus_banner.png' },
      superHeaders2
    );
    const pubImgGet = await httpRequest(port2, 'GET', pubImgUpload.data?.url || '/uploads/missing.png');
    assert(
      pubImgUpload.status === 201 &&
        pubImgUpload.data?.visibility === 'public' &&
        pubImgUpload.data?.url?.startsWith('/uploads/') &&
        pubImgGet.status === 200 &&
        pubImgGet.headers['x-content-type-options'] === 'nosniff',
      'D1. Admin public school image upload serves from /uploads with X-Content-Type-Options: nosniff'
    );

    // Verify private PDF uploaded in Server #1 is NOT accessible via /uploads/* or unauthenticated /api/documents/*
    const publicPdfProbe1 = await httpRequest(port2, 'GET', `/uploads/${privateDocFilename}`);
    const publicPdfProbe2 = await httpRequest(port2, 'GET', `/uploads/private/${privateDocFilename}`);
    const unauthDocProbe = await httpRequest(port2, 'GET', privateDocUrl);
    assert(
      uploadPrivatePdf.status === 201 &&
        uploadPrivatePdf.data?.visibility === 'private' &&
        privateDocUrl === `/api/documents/${privateDocFilename}` &&
        publicPdfProbe1.status === 403 &&
        publicPdfProbe2.status === 403 &&
        unauthDocProbe.status === 401,
      'D2. Private student PDF document is blocked on public /uploads (403) and unauthenticated /api/documents (401)'
    );

    // Login as linked student (std_01), linked parent (std_01), and unrelated teacher
    const loginStudent1 = await httpRequest(
      port2,
      'POST',
      '/api/auth/login',
      { email: 'student@shawanschool.edu.pk', password: 'StudentPassword123!' },
      { 'X-Forwarded-For': '198.51.103.1' }
    );
    const loginParent1 = await httpRequest(
      port2,
      'POST',
      '/api/auth/login',
      { email: 'parent@shawanschool.edu.pk', password: 'StudentPassword123!' },
      { 'X-Forwarded-For': '198.51.103.2' }
    );
    const loginTeacher1 = await httpRequest(
      port2,
      'POST',
      '/api/auth/login',
      { email: 'teacher@shawanschool.edu.pk', password: 'TeacherPassword123!' },
      { 'X-Forwarded-For': '198.51.103.3' }
    );

    const studentHeaders = { Authorization: `Bearer ${loginStudent1.data?.token}`, 'X-Forwarded-For': '198.51.103.1' };
    const parentHeaders = { Authorization: `Bearer ${loginParent1.data?.token}`, 'X-Forwarded-For': '198.51.103.2' };
    const teacherHeaders = { Authorization: `Bearer ${loginTeacher1.data?.token}`, 'X-Forwarded-For': '198.51.103.3' };

    const teacherDocAttempt = await httpRequest(port2, 'GET', privateDocUrl, undefined, teacherHeaders);
    const studentDocFetch = await httpRequest(port2, 'GET', privateDocUrl, undefined, studentHeaders);
    const parentDocFetch = await httpRequest(port2, 'GET', privateDocUrl, undefined, parentHeaders);
    const adminDocFetch = await httpRequest(port2, 'GET', privateDocUrl, undefined, superHeaders2);

    assert(
      teacherDocAttempt.status === 403 &&
        studentDocFetch.status === 200 &&
        parentDocFetch.status === 200 &&
        adminDocFetch.status === 200 &&
        String(adminDocFetch.headers['cache-control'] || '').includes('no-store') &&
        adminDocFetch.headers['x-content-type-options'] === 'nosniff',
      'D3. Private student document survives server restart, blocks unrelated teacher (403), and permits linked student, linked parent, and admin (200)'
    );

    const crossStudentUploadAttempt = await httpRequest(
      port2,
      'POST',
      '/api/upload',
      {
        dataUrl: samplePdfBase64,
        filename: 'spoofed_other_student.pdf',
        student_id: 'std_02',
      },
      studentHeaders
    );
    assert(
      crossStudentUploadAttempt.status === 403,
      'D4. Student is blocked (403) from uploading private documents attributed to another student_id'
    );

    // ------------------------------------------------------------------
    // SECTION E: PRODUCTION DATA ISOLATION CHECK
    // ------------------------------------------------------------------
    console.log('\n--- Section E: Real School Data Safety ---');
    const realDbNow = fs.readFileSync(REAL_DB_PATH, 'utf8');
    const afterRealUploads = fs.existsSync(REAL_UPLOADS_DIR) ? fs.readdirSync(REAL_UPLOADS_DIR) : [];
    const noRealDataLeak =
      !realDbNow.includes('Areeba Phase6 Applicant') &&
      !realDbNow.includes('Concurrent Race Applicant') &&
      !realDbNow.includes('ADM-2026-7001') &&
      JSON.stringify(beforeRealUploads) === JSON.stringify(afterRealUploads);
    assert(noRealDataLeak, 'E1. Real data/db.json and data/uploads/ remained completely untouched');
  } finally {
    if (server1) await server1.stop();
    if (server2) await server2.stop();
    await memMongo.stop();
    try {
      if (fs.existsSync(tmpDbFile)) fs.unlinkSync(tmpDbFile);
    } catch {}
    try {
      if (fs.existsSync(tmpUploadsDir)) fs.rmSync(tmpUploadsDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n==================================================================');
  console.log(`PHASE 6 SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('==================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error in Phase 6 test suite:', err);
  process.exit(1);
});
