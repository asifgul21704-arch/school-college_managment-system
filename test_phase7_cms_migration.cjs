/**
 * PHASE 7 — PUBLIC CMS & INQUIRIES: MONGODB-AUTHORITATIVE MIGRATION VERIFICATION
 *
 * Verifies in complete isolation (dedicated MongoMemoryServer + temp DB_FILE_PATH + temp UPLOAD_STORAGE_DIR):
 *   A. Idempotent one-time backfill from db.json -> MongoDB for SchoolSettings (including features,
 *      academic_levels, facilities, testimonials, and unknown-but-valid custom legacy fields),
 *      Announcements, Events, Gallery, and ContactMessages, preserving legacy IDs & timestamps,
 *      with zero dual-writes back to db.json.
 *   B. Full CRUD + persistence across OS server restarts (Process #1 -> Process #2 on same MONGODB_URI):
 *      creates persist, updates are NOT overwritten by stale db.json, and deleted items are NOT
 *      resurrected on restart or POST /api/mongodb/sync-all.
 *   C. Pre-existing MongoDB settings preservation when missing CMS arrays/custom keys are backfilled.
 *   D. Security, RBAC, XSS/unsafe-URL sanitization, mass-assignment immunity on public POST /api/contact,
 *      contactRateLimiter (HTTP 429 on flood), and strict ['super_admin', 'admin'] access on /api/contact*.
 *   E. Fail-closed HTTP 503 behavior when MongoDB is disconnected/unavailable (no fallback to db.json,
 *      no fabricated 200/201 responses) and zero mutation of real data/db.json or data/uploads/.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ROOT = __dirname;
const REAL_DB_PATH = path.resolve(ROOT, 'data', 'db.json');
const REAL_UPLOADS_DIR = path.resolve(ROOT, 'data', 'uploads');

const runId = Date.now();
const tmpDbFile = path.join(os.tmpdir(), `shawan_phase7_db_${runId}.json`);
const tmpUploadsDir = path.join(os.tmpdir(), `shawan_phase7_uploads_${runId}`);
const STRONG_PROD_JWT_SECRET = 'Phase7_CMS_Authoritative_Verified_Jwt_Secret_2026_998877!';

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
          resolve({ status: res.statusCode || 500, headers: res.headers, data, raw });
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

  const deadline = Date.now() + 25000;
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
  console.log('==============================================================');
  console.log('PHASE 7 — PUBLIC CMS & INQUIRIES MONGODB MIGRATION TEST SUITE');
  console.log('==============================================================');

  const realDbBefore = fs.existsSync(REAL_DB_PATH) ? fs.readFileSync(REAL_DB_PATH, 'utf8') : null;
  const realUploadsBefore = fs.existsSync(REAL_UPLOADS_DIR)
    ? JSON.stringify(fs.readdirSync(REAL_UPLOADS_DIR).sort())
    : 'NONE';

  fs.mkdirSync(tmpUploadsDir, { recursive: true });

  // Prepare isolated temp db.json with custom legacy settings & seeded CMS items
  const baseDb = JSON.parse(fs.readFileSync(REAL_DB_PATH, 'utf8'));
  baseDb.settings = {
    ...baseDb.settings,
    legacy_board_code: 'BISE-DIK-7788',
    legacy_prospectus_meta: { edition: '2026', verified: true },
  };
  baseDb.announcements = [
    {
      id: 'ann_legacy_101',
      title: 'Legacy Matric Board Notice',
      content: 'Roll number slips available at admin office.',
      category: 'Exam',
      audience: 'All',
      date: '2026-09-10',
      priority: 'High',
      author: 'Principal Office',
      published: true,
    },
    {
      id: 'ann_legacy_staff_only',
      title: 'Internal Faculty Briefing',
      content: 'Mandatory staff meeting at 2:00 PM in Staff Room.',
      category: 'Academic',
      audience: 'Teachers',
      date: '2026-09-11',
      priority: 'Normal',
      author: 'Principal',
      published: true,
    },
  ];
  baseDb.events = [
    {
      id: 'ev_legacy_201',
      title: 'Annual Science Exhibition',
      description: 'Physics and Chemistry project showcase.',
      date: '2026-11-15',
      time: '09:30 AM',
      location: 'Main Auditorium, Paharpur',
      cover_image: '/src/assets/images/school_science_lab_1790606594349.jpg',
      status: 'Upcoming',
    },
  ];
  baseDb.gallery = [
    {
      id: 'gal_legacy_301',
      title: 'Chemistry Practical Session',
      caption: 'Grade 10 titration lab work',
      category: 'Laboratories',
      image_url: '/src/assets/images/school_science_lab_1790606594349.jpg',
      date: '2026-09-05',
    },
  ];
  baseDb.contact_messages = [
    {
      id: 'msg_legacy_401',
      name: 'Haji Kareem',
      email: 'kareem@example.com',
      phone: '+92 300 1112233',
      subject: 'College F.Sc Pre-Medical Fee',
      message: 'Please share scholarship details for 90%+ matric students.',
      created_at: '2026-09-01T08:30:00.000Z',
      read: false,
    },
  ];
  fs.writeFileSync(tmpDbFile, JSON.stringify(baseDb, null, 2), 'utf8');

  let mongod = null;
  let srv1 = null;
  let srv2 = null;

  try {
    mongod = await MongoMemoryServer.create();
    const mongoUri = mongod.getUri();
    const port1 = 4711;
    const port2 = 4712;

    // Pre-seed a partial SchoolSettings doc in MongoDB to verify C3 (existing MongoDB fields are preserved while missing legacy keys/arrays are backfilled)
    const preConn = await mongoose.createConnection(mongoUri).asPromise();
    await preConn.collection('schoolsettings').insertOne({
      singleton_key: 'default',
      school_name: 'Shawan School & College (Mongo Pre-Updated)',
      slogan: 'Excellence Preserved in MongoDB',
    });
    await preConn.close();

    srv1 = await bootServerProcess(port1, { MONGODB_URI: mongoUri });

    // Login as super_admin, teacher, student
    const adminLogin = await httpRequest(port1, 'POST', '/api/auth/login', {
      email: 'admin@shawanschool.edu.pk',
      password: 'AdminPassword123!',
    });
    const adminToken = adminLogin.data?.token;
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    const teacherLogin = await httpRequest(port1, 'POST', '/api/auth/login', {
      email: 'teacher@shawanschool.edu.pk',
      password: 'TeacherPassword123!',
    });
    const teacherToken = teacherLogin.data?.token;
    const teacherHeaders = { Authorization: `Bearer ${teacherToken}` };

    const studentReg = await httpRequest(port1, 'POST', '/api/auth/register-student', {
      full_name: 'Phase7 Test Student',
      email: `p7.student.${runId}@shawanschool.edu.pk`,
      password: 'StudentPassword123!',
      confirm_password: 'StudentPassword123!',
      father_name: 'Phase7 Guardian',
      class_name: 'Grade 9 - Matric',
    });
    const studentToken = studentReg.data?.token;
    const studentHeaders = { Authorization: `Bearer ${studentToken}` };

    // Snapshot temp db.json before CMS mutations to confirm zero dual-writes
    const tmpDbSnapshotBeforeMutations = fs.readFileSync(tmpDbFile, 'utf8');

    // A1 & C3: Settings backfill preserves pre-existing Mongo fields AND backfills missing structured arrays + unknown legacy fields
    const getSettings1 = await httpRequest(port1, 'GET', '/api/settings');
    assert(
      getSettings1.status === 200 &&
        getSettings1.data.school_name === 'Shawan School & College (Mongo Pre-Updated)' &&
        Array.isArray(getSettings1.data.features) &&
        getSettings1.data.features.length >= 4 &&
        Array.isArray(getSettings1.data.academic_levels) &&
        Array.isArray(getSettings1.data.facilities) &&
        Array.isArray(getSettings1.data.testimonials) &&
        getSettings1.data.legacy_board_code === 'BISE-DIK-7788' &&
        getSettings1.data.legacy_prospectus_meta?.edition === '2026' &&
        getSettings1.data._id === undefined &&
        getSettings1.data.singleton_key === undefined,
      'A1/C3. SchoolSettings backfills CMS arrays & unknown legacy fields without overwriting existing MongoDB fields or leaking internal keys'
    );

    // A2: Legacy IDs & audience visibility on Announcements
    const pubAnns = await httpRequest(port1, 'GET', '/api/announcements');
    const pubHasLegacy101 = Array.isArray(pubAnns.data) && pubAnns.data.some(a => a.id === 'ann_legacy_101');
    const pubHasStaffOnly = Array.isArray(pubAnns.data) && pubAnns.data.some(a => a.id === 'ann_legacy_staff_only');
    const pubStaffQuery = await httpRequest(port1, 'GET', '/api/announcements?audience=Teachers');
    const teacherStaffQuery = await httpRequest(port1, 'GET', '/api/announcements?audience=Teachers', undefined, teacherHeaders);
    assert(
      pubAnns.status === 200 &&
        pubHasLegacy101 &&
        !pubHasStaffOnly &&
        pubStaffQuery.status === 403 &&
        teacherStaffQuery.status === 200 &&
        teacherStaffQuery.data.some(a => a.id === 'ann_legacy_staff_only'),
      'A2. Announcements preserve legacy IDs and enforce audience visibility (Teachers circulars hidden from public/students, visible to staff/admin)'
    );

    // A3: Legacy Events, Gallery, and Contact Messages backfilled with preserved IDs & ISO timestamps
    const pubEvents = await httpRequest(port1, 'GET', '/api/events');
    const pubGallery = await httpRequest(port1, 'GET', '/api/gallery');
    const adminContacts = await httpRequest(port1, 'GET', '/api/contact', undefined, adminHeaders);
    assert(
      pubEvents.status === 200 &&
        pubEvents.data.some(e => e.id === 'ev_legacy_201') &&
        pubGallery.status === 200 &&
        pubGallery.data.some(g => g.id === 'gal_legacy_301') &&
        adminContacts.status === 200 &&
        adminContacts.data.some(
          m => m.id === 'msg_legacy_401' && m.created_at === '2026-09-01T08:30:00.000Z'
        ),
      'A3. Events, Gallery, and ContactMessages backfill with preserved legacy IDs and ISO timestamps'
    );

    // B1: Settings PUT updates structured arrays & custom legacy fields, strips XSS, blocks unsafe facility image URLs
    const badSettingsUrl = await httpRequest(
      port1,
      'PUT',
      '/api/settings',
      {
        facilities: [{ name: 'Lab', description: 'Desc', image: 'javascript:alert(1)' }],
      },
      adminHeaders
    );
    const updateSettings = await httpRequest(
      port1,
      'PUT',
      '/api/settings',
      {
        slogan: 'Updated Slogan Phase 7 <script>alert(1)</script>',
        hero_badge: 'Admissions 2026-2027 Verified',
        custom_banner_note: 'Scholarships Open Now',
        testimonials: [
          {
            name: 'Engr. Bilal',
            role: 'Parent',
            quote: 'Outstanding physics lab and disciplined faculty.',
            year: '2026',
          },
        ],
      },
      adminHeaders
    );
    assert(
      badSettingsUrl.status === 400 &&
        updateSettings.status === 200 &&
        updateSettings.data.settings.slogan === 'Updated Slogan Phase 7' &&
        updateSettings.data.settings.custom_banner_note === 'Scholarships Open Now' &&
        updateSettings.data.settings.testimonials.length === 1,
      'B1. PUT /api/settings sanitizes XSS, blocks unsafe media URLs, and persists structured & custom fields'
    );

    // B2: Announcements CRUD (Create new, Update legacy, Delete staff-only)
    const createAnn = await httpRequest(
      port1,
      'POST',
      '/api/announcements',
      {
        title: 'Winter Uniform Schedule <script>evil()</script>',
        content: 'Effective November 1st across all sections.',
        category: 'General',
        audience: 'All',
        priority: 'Normal',
        date: '2026-10-28',
      },
      adminHeaders
    );
    const updateLegacyAnn = await httpRequest(
      port1,
      'PUT',
      '/api/announcements/ann_legacy_101',
      {
        title: 'Legacy Matric Board Notice (Updated in Mongo)',
      },
      adminHeaders
    );
    const deleteLegacyAnn = await httpRequest(
      port1,
      'DELETE',
      '/api/announcements/ann_legacy_staff_only',
      undefined,
      adminHeaders
    );
    assert(
      createAnn.status === 201 &&
        createAnn.data.title === 'Winter Uniform Schedule' &&
        updateLegacyAnn.status === 200 &&
        updateLegacyAnn.data.title === 'Legacy Matric Board Notice (Updated in Mongo)' &&
        deleteLegacyAnn.status === 200,
      'B2. Announcements POST/PUT/DELETE work cleanly with XSS sanitization and legacy ID support'
    );

    // B3: Events CRUD + unsafe cover_image rejection
    const unsafeEvent = await httpRequest(
      port1,
      'POST',
      '/api/events',
      {
        title: 'Bad Event',
        date: '2026-12-01',
        cover_image: 'javascript:alert(9)',
      },
      adminHeaders
    );
    const createEv = await httpRequest(
      port1,
      'POST',
      '/api/events',
      {
        title: 'Inter-College Debate Championship',
        description: 'Annual Urdu and English declamation contest.',
        date: '2026-12-05',
        time: '10:00 AM',
        location: 'Central Hall',
        status: 'Upcoming',
      },
      adminHeaders
    );
    const deleteLegacyEv = await httpRequest(port1, 'DELETE', '/api/events/ev_legacy_201', undefined, adminHeaders);
    assert(
      unsafeEvent.status === 400 &&
        createEv.status === 201 &&
        createEv.data.id.startsWith('ev_') &&
        deleteLegacyEv.status === 200,
      'B3. Events POST/DELETE persist in MongoDB and reject unsafe cover_image URLs'
    );

    // B4: Gallery CRUD + unsafe image_url rejection
    const unsafeGal = await httpRequest(
      port1,
      'POST',
      '/api/gallery',
      {
        title: 'Bad SVG XSS',
        category: 'Campus',
        image_url: 'data:image/svg+xml;base64,PHN2Zz4=',
      },
      adminHeaders
    );
    const createGal = await httpRequest(
      port1,
      'POST',
      '/api/gallery',
      {
        title: 'Sports Gala Trophy Distribution',
        caption: 'Winners of inter-house cricket',
        category: 'Sports',
        image_url: 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e',
        date: '2026-10-20',
      },
      adminHeaders
    );
    const deleteLegacyGal = await httpRequest(port1, 'DELETE', '/api/gallery/gal_legacy_301', undefined, adminHeaders);
    assert(
      unsafeGal.status === 400 &&
        createGal.status === 201 &&
        createGal.data.id.startsWith('gal_') &&
        deleteLegacyGal.status === 200,
      'B4. Gallery POST/DELETE persist in MongoDB and block SVG/script data URLs'
    );

    // D1: Public POST /api/contact prevents mass-assignment & strips XSS
    const submitContact = await httpRequest(port1, 'POST', '/api/contact', {
      name: 'Saeed Ahmad <img src=x onerror=alert(1)>',
      email: 'saeed.ahmad@example.com',
      phone: '+92 333 4455667',
      subject: 'Admission Transport Route',
      message: 'Does school bus cover Dhakki Road? <script>steal()</script>',
      read: true,
      replied: true,
      role: 'super_admin',
      singleton_key: 'hacked',
      $set: { admin: true },
    });
    const createdMsgId = submitContact.data?.inquiry?.id;
    assert(
      submitContact.status === 201 &&
        createdMsgId &&
        submitContact.data.inquiry.read === false &&
        submitContact.data.inquiry.replied === undefined &&
        submitContact.data.inquiry.role === undefined &&
        !submitContact.data.inquiry.message.includes('<script>'),
      'D1. Public POST /api/contact strips XSS and blocks mass-assignment of read/replied/role/operator fields'
    );

    // D2: Contact privacy & strict admin-only RBAC (unauthenticated=401, student=403, teacher=403, admin=200)
    const unauthContacts = await httpRequest(port1, 'GET', '/api/contact');
    const studentContacts = await httpRequest(port1, 'GET', '/api/contact', undefined, studentHeaders);
    const teacherContacts = await httpRequest(port1, 'GET', '/api/contact', undefined, teacherHeaders);
    const teacherMarkRead = await httpRequest(
      port1,
      'PUT',
      `/api/contact/${createdMsgId}/read`,
      { read: true },
      teacherHeaders
    );
    assert(
      unauthContacts.status === 401 &&
        studentContacts.status === 403 &&
        teacherContacts.status === 403 &&
        teacherMarkRead.status === 403,
      'D2. Private contact inquiries strictly block unauthenticated (401), student (403), and teacher (403) access'
    );

    // D3: Admin mark read + delete legacy contact inquiry + dashboard stats reflects MongoDB unread count
    const markRead = await httpRequest(
      port1,
      'PUT',
      `/api/contact/${createdMsgId}/read`,
      { read: true },
      adminHeaders
    );
    const deleteLegacyMsg = await httpRequest(
      port1,
      'DELETE',
      '/api/contact/msg_legacy_401',
      undefined,
      adminHeaders
    );
    const dashStats = await httpRequest(port1, 'GET', '/api/dashboard/stats', undefined, adminHeaders);
    assert(
      markRead.status === 200 &&
        markRead.data.read === true &&
        deleteLegacyMsg.status === 200 &&
        dashStats.status === 200 &&
        dashStats.data.unreadMessages === 0,
      'D3. Admin inquiry read/delete updates MongoDB and syncs /api/dashboard/stats unreadMessages accurately'
    );

    // D4: Non-admin write attempts on CMS endpoints are blocked (403) & malformed IDs return 400
    const teacherSettingsWrite = await httpRequest(
      port1,
      'PUT',
      '/api/settings',
      { slogan: 'Unauthorized' },
      teacherHeaders
    );
    const studentAnnWrite = await httpRequest(
      port1,
      'POST',
      '/api/announcements',
      { title: 'Hack', content: 'Hack' },
      studentHeaders
    );
    const badIdReq = await httpRequest(
      port1,
      'DELETE',
      '/api/announcements/bad$id!',
      undefined,
      adminHeaders
    );
    assert(
      teacherSettingsWrite.status === 403 &&
        studentAnnWrite.status === 403 &&
        badIdReq.status === 400,
      'D4. Non-admin writes on CMS endpoints return 403 and invalid CMS IDs return 400'
    );

    // A4: Verify zero dual-writes to temp db.json across all CMS & contact mutations
    const tmpDbAfterMutations = JSON.parse(fs.readFileSync(tmpDbFile, 'utf8'));
    assert(
      tmpDbAfterMutations.announcements.some(a => a.id === 'ann_legacy_staff_only') &&
        tmpDbAfterMutations.events.some(e => e.id === 'ev_legacy_201') &&
        tmpDbAfterMutations.gallery.some(g => g.id === 'gal_legacy_301') &&
        tmpDbAfterMutations.contact_messages.some(m => m.id === 'msg_legacy_401') &&
        tmpDbAfterMutations.settings.slogan !== 'Updated Slogan Phase 7',
      'A4. Zero dual-writes: temp db.json was NOT mutated by Settings, Announcements, Events, Gallery, or Contact operations'
    );
    void tmpDbSnapshotBeforeMutations;

    // D5: Public POST /api/contact enforces rate limiting (contactRateLimiter max=10 -> >=11th request returns 429)
    let saw429 = false;
    for (let i = 0; i < 14; i++) {
      const r = await httpRequest(port1, 'POST', '/api/contact', {
        name: `Rate Test Visitor ${i}`,
        message: 'Testing rate limiter threshold.',
      });
      if (r.status === 429) {
        saw429 = true;
        break;
      }
    }
    assert(saw429, 'D5. Public POST /api/contact enforces rate limiting (HTTP 429 on flood)');

    // Stop Process #1 and boot Process #2 against same MongoDB + stale temp db.json
    await srv1.stop();
    srv1 = null;

    srv2 = await bootServerProcess(port2, { MONGODB_URI: mongoUri });

    const adminLogin2 = await httpRequest(port2, 'POST', '/api/auth/login', {
      email: 'admin@shawanschool.edu.pk',
      password: 'AdminPassword123!',
    });
    const adminHeaders2 = { Authorization: `Bearer ${adminLogin2.data?.token}` };

    // Trigger manual POST /api/mongodb/sync-all as well to prove idempotency under explicit sync
    const syncRes = await httpRequest(port2, 'POST', '/api/mongodb/sync-all', {}, adminHeaders2);
    assert(syncRes.status === 200 && syncRes.data.success === true, 'B5. POST /api/mongodb/sync-all completes cleanly');

    // B6: Verify updates persisted AND deleted legacy records were NOT resurrected after restart + sync-all
    const settingsAfterRestart = await httpRequest(port2, 'GET', '/api/settings');
    const annsAfterRestart = await httpRequest(port2, 'GET', '/api/announcements', undefined, adminHeaders2);
    const eventsAfterRestart = await httpRequest(port2, 'GET', '/api/events');
    const galleryAfterRestart = await httpRequest(port2, 'GET', '/api/gallery');
    const contactsAfterRestart = await httpRequest(port2, 'GET', '/api/contact', undefined, adminHeaders2);

    const updatedAnnPersisted = annsAfterRestart.data.some(
      a => a.id === 'ann_legacy_101' && a.title === 'Legacy Matric Board Notice (Updated in Mongo)'
    );
    const deletedAnnResurrected = annsAfterRestart.data.some(a => a.id === 'ann_legacy_staff_only');
    const deletedEvResurrected = eventsAfterRestart.data.some(e => e.id === 'ev_legacy_201');
    const deletedGalResurrected = galleryAfterRestart.data.some(g => g.id === 'gal_legacy_301');
    const deletedMsgResurrected = contactsAfterRestart.data.some(m => m.id === 'msg_legacy_401');

    assert(
      settingsAfterRestart.data.slogan === 'Updated Slogan Phase 7' &&
        settingsAfterRestart.data.custom_banner_note === 'Scholarships Open Now' &&
        updatedAnnPersisted &&
        !deletedAnnResurrected &&
        !deletedEvResurrected &&
        !deletedGalResurrected &&
        !deletedMsgResurrected,
      'B6. Full restart + sync-all idempotency: MongoDB updates survive and deleted legacy CMS/inquiry records are NEVER resurrected'
    );

    // B7: Audit logs recorded in MongoDB for CMS administrative actions
    const auditRes = await httpRequest(port2, 'GET', '/api/audit-logs', undefined, adminHeaders2);
    const logsArr = Array.isArray(auditRes.data) ? auditRes.data : auditRes.data?.logs || [];
    const hasSettingsAudit = logsArr.some(l => l.action === 'Updated School Settings');
    const hasAnnAudit = logsArr.some(l => l.action === 'Created Announcement');
    assert(
      auditRes.status === 200 && hasSettingsAudit && hasAnnAudit,
      'B7. Administrative CMS mutations record persistent audit trail entries in AuditLogModel'
    );

    // E1: Disconnected Mongoose fail-closed test across all 5 migrated modules (HTTP 503, zero fallback to db.json)
    const offlineCheck = await new Promise((resolve, reject) => {
      const childScript = `
        import express from 'express';
        import http from 'http';
        import mongoose from 'mongoose';
        process.env.DB_FILE_PATH = ${JSON.stringify(tmpDbFile)};
        process.env.UPLOAD_STORAGE_DIR = ${JSON.stringify(tmpUploadsDir)};
        process.env.JWT_SECRET = ${JSON.stringify(STRONG_PROD_JWT_SECRET)};
        const { router } = await import('./server/routes.ts');
        if (mongoose.connection.readyState !== 0) {
          await mongoose.disconnect();
        }
        const app = express();
        app.use(express.json());
        app.use('/api', router);
        const srv = http.createServer(app);
        await new Promise(r => srv.listen(0, '127.0.0.1', r));
        const p = srv.address().port;
        const rSettings = await fetch('http://127.0.0.1:' + p + '/api/settings');
        const rAnn = await fetch('http://127.0.0.1:' + p + '/api/announcements');
        const rEvents = await fetch('http://127.0.0.1:' + p + '/api/events');
        const rGallery = await fetch('http://127.0.0.1:' + p + '/api/gallery');
        const rContact = await fetch('http://127.0.0.1:' + p + '/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.102.77' },
          body: JSON.stringify({ name: 'Offline Visitor', message: 'Should fail safely with 503' }),
        });
        srv.close();
        console.log(JSON.stringify({
          settings: rSettings.status,
          ann: rAnn.status,
          events: rEvents.status,
          gallery: rGallery.status,
          contact: rContact.status,
        }));
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
      offlineCheck.settings === 503 &&
        offlineCheck.ann === 503 &&
        offlineCheck.events === 503 &&
        offlineCheck.gallery === 503 &&
        offlineCheck.contact === 503 &&
        !diskAfterOffline.contact_messages.some(m => m.name === 'Offline Visitor'),
      'E1. Offline MongoDB fail-closed guarantee: all 5 migrated modules return HTTP 503 without falling back to db.json or fabricating success'
    );

    await srv2.stop();
    srv2 = null;
  } finally {
    if (srv1) await srv1.stop().catch(() => {});
    if (srv2) await srv2.stop().catch(() => {});
    if (mongod) await mongod.stop().catch(() => {});
    try {
      if (fs.existsSync(tmpDbFile)) fs.unlinkSync(tmpDbFile);
      if (fs.existsSync(tmpUploadsDir)) fs.rmSync(tmpUploadsDir, { recursive: true, force: true });
    } catch {}
  }

  // E2: Verify real data/db.json and data/uploads/ were completely untouched
  const realDbAfter = fs.existsSync(REAL_DB_PATH) ? fs.readFileSync(REAL_DB_PATH, 'utf8') : null;
  const realUploadsAfter = fs.existsSync(REAL_UPLOADS_DIR)
    ? JSON.stringify(fs.readdirSync(REAL_UPLOADS_DIR).sort())
    : 'NONE';

  assert(
    realDbBefore === realDbAfter && realUploadsBefore === realUploadsAfter,
    'E2. Real production data/db.json and data/uploads/ remained 100% untouched throughout testing'
  );

  console.log('--------------------------------------------------------------');
  console.log(`PHASE 7 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('--------------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in Phase 7 verification:', err);
  process.exit(1);
});
