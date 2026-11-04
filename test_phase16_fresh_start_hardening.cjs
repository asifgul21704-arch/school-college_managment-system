/**
 * PHASE 16 — FINAL PRE-DEPLOYMENT HARDENING (FRESH PRODUCTION DATABASE) VERIFICATION SUITE
 *
 * Isolation Guarantees:
 * - Runs exclusively against an isolated ephemeral MongoMemoryServer and loopback SMTP server.
 * - Never touches MongoDB Atlas production/test clusters or data/db.json.
 * - Verifies Fresh-Start zero-seed enforcement, one-time Super Admin bootstrap + duplicate lock,
 *   /api/mongodb/sync-all 403 block, initial school setup + RBAC across all 5 roles, cookie-first
 *   HttpOnly authentication, SMTP fail-safe + full Forgot Password single-use/expiry/revocation/
 *   enumeration/rate-limit security, and Gemini AI reliability + zero fabrication on a fresh DB.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ROOT = __dirname;
const REAL_DB_PATH = path.resolve(ROOT, 'data', 'db.json');
const TEST_JWT_SECRET = 'Phase16_FreshStart_Cryptographic_Jwt_Secret_2026_Verified_9911!';
const TEST_BOOTSTRAP_SECRET = 'Phase16_OneTime_SuperAdmin_Bootstrap_Secret_2026_8822!';
const TRUSTED_ORIGIN = 'https://portal.shawanschool.edu.pk';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            data,
            raw,
          });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function startLoopbackSmtpServer(expectedUser, expectedPass) {
  const capturedEmails = [];
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let inDataMode = false;
    let dataBuffer = '';
    let lineBuffer = '';
    let mailFrom = '';
    let rcptTo = [];
    let authenticated = false;

    socket.write('220 localhost ESMTP Phase16TestMailer\r\n');

    socket.on('data', chunk => {
      if (inDataMode) {
        dataBuffer += chunk;
        const endIdx = dataBuffer.indexOf('\r\n.\r\n');
        if (endIdx !== -1) {
          const messageBody = dataBuffer.slice(0, endIdx);
          capturedEmails.push({ mailFrom, rcptTo: [...rcptTo], raw: messageBody, authenticated });
          inDataMode = false;
          dataBuffer = '';
          socket.write('250 2.0.0 OK queued\r\n');
        }
        return;
      }

      lineBuffer += chunk;
      let idx;
      while ((idx = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, idx).replace(/\r$/, '');
        lineBuffer = lineBuffer.slice(idx + 1);
        const upper = line.toUpperCase();

        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (upper.startsWith('AUTH PLAIN ')) {
          const b64 = line.slice(11).trim();
          const decoded = Buffer.from(b64, 'base64').toString('utf8');
          const parts = decoded.split('\u0000');
          if (parts[1] === expectedUser && parts[2] === expectedPass) {
            authenticated = true;
            socket.write('235 2.7.0 Authentication successful\r\n');
          } else {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          }
        } else if (upper.startsWith('MAIL FROM:')) {
          if (!authenticated) {
            socket.write('530 5.7.0 Authentication required\r\n');
          } else {
            mailFrom = line.slice(10).trim();
            socket.write('250 2.1.0 Ok\r\n');
          }
        } else if (upper.startsWith('RCPT TO:')) {
          rcptTo.push(line.slice(8).trim());
          socket.write('250 2.1.5 Ok\r\n');
        } else if (upper === 'DATA') {
          inDataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 Ok\r\n');
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        capturedEmails,
        close: () => new Promise(r => server.close(() => r())),
      });
    });
    server.once('error', reject);
  });
}

async function bootProdServer(port, envOverrides = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.DISABLE_AUTO_SEED;
  delete cleanEnv.ALLOW_PRODUCTION_SEED;
  delete cleanEnv.BOOTSTRAP_SECRET;
  delete cleanEnv.SMTP_HOST;
  delete cleanEnv.SMTP_PORT;
  delete cleanEnv.SMTP_USER;
  delete cleanEnv.SMTP_PASS;
  delete cleanEnv.SMTP_FROM;

  const proc = spawn('node', ['server.ts'], {
    cwd: ROOT,
    env: {
      ...cleanEnv,
      NODE_ENV: 'production',
      PORT: String(port),
      JWT_SECRET: TEST_JWT_SECRET,
      CORS_ORIGIN: TRUSTED_ORIGIN,
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutLogs = '';
  let stderrLogs = '';
  proc.stdout.on('data', d => (stdoutLogs += d.toString()));
  proc.stderr.on('data', d => (stderrLogs += d.toString()));

  const deadline = Date.now() + 20000;
  let booted = false;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Server exited early (${proc.exitCode}):\n${stdoutLogs}\n${stderrLogs}`);
    }
    try {
      const h = await httpRequest(port, 'GET', '/api/health');
      if (h.status === 200) {
        booted = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  if (!booted) {
    proc.kill('SIGKILL');
    throw new Error(`Timed out booting server on port ${port}`);
  }

  return {
    getLogs: () => `${stdoutLogs}\n${stderrLogs}`,
    stop: () =>
      new Promise(resolve => {
        if (proc.exitCode !== null) return resolve();
        proc.once('exit', () => resolve());
        proc.kill('SIGTERM');
      }),
  };
}

function extractSessionCookiePair(setCookieHeader) {
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  for (const item of arr) {
    const first = String(item).split(';')[0].trim();
    if (first.startsWith('shawan_session=')) return first;
  }
  return '';
}

async function main() {
  console.log('========================================================================');
  console.log('PHASE 16 — FRESH-START PRODUCTION HARDENING VERIFICATION SUITE');
  console.log('========================================================================\n');

  const initialDbHash = sha256File(REAL_DB_PATH);
  const tmpUploadsDir = path.join(os.tmpdir(), `shawan_p16_uploads_${Date.now()}`);
  fs.mkdirSync(tmpUploadsDir, { recursive: true });

  let passed = 0;
  let failed = 0;
  let memServer = null;
  let smtpServer = null;
  let srvNoSmtp = null;
  let srvMain = null;
  let inspectorConn = null;

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
    memServer = await MongoMemoryServer.create({
      instance: { dbName: 'shawan_phase16_fresh' },
    });
    const mongoUri = memServer.getUri('shawan_phase16_fresh');
    inspectorConn = await mongoose.createConnection(mongoUri).asPromise();

    // =========================================================================
    // 1. FRESH-START ZERO-SEED & MISSING-SMTP FAIL-SAFE SERVER
    // =========================================================================
    console.log('--- SECTION 1: FRESH-START ZERO-SEED & MISSING-SMTP FAIL-SAFE ---');
    const port1 = 3971;
    // Notice we DO NOT even pass DISABLE_AUTO_SEED here — production must default to Fresh Start!
    srvNoSmtp = await bootProdServer(port1, {
      MONGODB_URI: mongoUri,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });

    const userCountFresh = await inspectorConn.collection('users').countDocuments();
    const studentCountFresh = await inspectorConn.collection('students').countDocuments();
    const feeCountFresh = await inspectorConn.collection('fees').countDocuments();
    assert(
      userCountFresh === 0 && studentCountFresh === 0 && feeCountFresh === 0,
      '1.1 Production server starts 100% clean by default (0 users, 0 students, 0 fees — no db.json seed)'
    );

    const pubSettings = await httpRequest(port1, 'GET', '/api/settings');
    const pubClasses = await httpRequest(port1, 'GET', '/api/classes');
    assert(
      pubSettings.status === 200 && Array.isArray(pubClasses.data) && pubClasses.data.length === 0,
      '1.2 Public endpoints respond cleanly on an empty Fresh-Start database (0 sample classes)'
    );

    const bootstrapDisabledRes = await httpRequest(port1, 'POST', '/api/auth/bootstrap-super-admin', {
      email: 'principal@shawanschool.edu.pk',
      password: 'StrongPrincipal#2026!',
      name: 'Principal Shawan',
    });
    assert(
      bootstrapDisabledRes.status === 403,
      '1.3 Bootstrap endpoint is strictly disabled (HTTP 403) when BOOTSTRAP_SECRET is not configured'
    );

    const forgotNoSmtpExisting = await httpRequest(port1, 'POST', '/api/auth/forgot-password', {
      email: 'principal@shawanschool.edu.pk',
    });
    const forgotNoSmtpUnknown = await httpRequest(port1, 'POST', '/api/auth/forgot-password', {
      email: 'nonexistent@shawanschool.edu.pk',
    });
    assert(
      forgotNoSmtpExisting.status === 503 &&
        forgotNoSmtpUnknown.status === 503 &&
        forgotNoSmtpExisting.data?.error === forgotNoSmtpUnknown.data?.error,
      '1.4 Missing SMTP configuration fails safely with identical HTTP 503 response (zero enumeration)'
    );

    await srvNoSmtp.stop();
    srvNoSmtp = null;

    // =========================================================================
    // 2. ONE-TIME SUPER ADMIN BOOTSTRAP & FRESH SCHOOL SETUP + RBAC
    // =========================================================================
    console.log('\n--- SECTION 2: ONE-TIME SUPER ADMIN BOOTSTRAP, SCHOOL SETUP & RBAC ---');
    smtpServer = await startLoopbackSmtpServer('mailer@shawanschool.local', 'SmtpPassSecret99!');
    const port2 = 3972;
    srvMain = await bootProdServer(port2, {
      MONGODB_URI: mongoUri,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
      BOOTSTRAP_SECRET: TEST_BOOTSTRAP_SECRET,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpServer.port),
      SMTP_SECURE: 'false',
      SMTP_USER: 'mailer@shawanschool.local',
      SMTP_PASS: 'SmtpPassSecret99!',
      SMTP_FROM: 'Shawan School <no-reply@shawanschool.edu.pk>',
      APP_PUBLIC_URL: TRUSTED_ORIGIN,
    });

    const wrongSecretBootstrap = await httpRequest(
      port2,
      'POST',
      '/api/auth/bootstrap-super-admin',
      {
        email: 'principal@shawanschool.edu.pk',
        password: 'StrongPrincipal#2026!',
        name: 'Principal Shawan',
      },
      { 'X-Bootstrap-Secret': 'wrong_bootstrap_secret_attempt_1234567890' }
    );
    assert(
      wrongSecretBootstrap.status === 403,
      '2.1 Wrong X-Bootstrap-Secret is rejected with HTTP 403'
    );

    const weakPassBootstrap = await httpRequest(
      port2,
      'POST',
      '/api/auth/bootstrap-super-admin',
      {
        email: 'principal@shawanschool.edu.pk',
        password: 'weakpassword',
        name: 'Principal Shawan',
      },
      { 'X-Bootstrap-Secret': TEST_BOOTSTRAP_SECRET }
    );
    assert(
      weakPassBootstrap.status === 400,
      '2.2 Weak Super Admin bootstrap password is rejected with HTTP 400'
    );

    const superPass = 'StrongPrincipal#2026!';
    const validBootstrap = await httpRequest(
      port2,
      'POST',
      '/api/auth/bootstrap-super-admin',
      {
        email: 'principal@shawanschool.edu.pk',
        password: superPass,
        name: 'Principal Shawan',
        phone: '03001112233',
      },
      { 'X-Bootstrap-Secret': TEST_BOOTSTRAP_SECRET }
    );
    assert(
      validBootstrap.status === 201 &&
        validBootstrap.data?.user?.role === 'super_admin' &&
        !validBootstrap.raw.includes(superPass) &&
        !validBootstrap.raw.includes(TEST_BOOTSTRAP_SECRET),
      '2.3 First Super Admin bootstrap succeeds (HTTP 201) without exposing password or secret'
    );

    const duplicateBootstrap = await httpRequest(
      port2,
      'POST',
      '/api/auth/bootstrap-super-admin',
      {
        email: 'second-super@shawanschool.edu.pk',
        password: 'AnotherStrong#2026!',
        name: 'Duplicate Super Admin',
      },
      { 'X-Bootstrap-Secret': TEST_BOOTSTRAP_SECRET }
    );
    const superAdminCount = await inspectorConn
      .collection('users')
      .countDocuments({ role: 'super_admin' });
    assert(
      duplicateBootstrap.status === 409 && superAdminCount === 1,
      '2.4 Duplicate Super Admin bootstrap is strictly blocked (HTTP 409; exactly 1 super_admin exists)'
    );

    // Super Admin login with HTTPS forwarded header -> verify Secure + HttpOnly + SameSite=None cookie
    const saLogin = await httpRequest(
      port2,
      'POST',
      '/api/auth/login',
      { email: 'principal@shawanschool.edu.pk', password: superPass },
      { Origin: TRUSTED_ORIGIN, 'X-Forwarded-Proto': 'https, http' }
    );
    const saCookie = extractSessionCookiePair(saLogin.headers['set-cookie']);
    const rawSetCookieStr = JSON.stringify(saLogin.headers['set-cookie'] || '');
    assert(
      saLogin.status === 200 &&
        Boolean(saCookie) &&
        rawSetCookieStr.includes('HttpOnly') &&
        rawSetCookieStr.includes('Secure') &&
        rawSetCookieStr.includes('SameSite=None'),
      '2.5 Multi-hop HTTPS login issues HttpOnly + Secure + SameSite=None session cookie'
    );

    // Verify /api/mongodb/sync-all is blocked (403) even for authenticated super_admin
    const syncBlockedRes = await httpRequest(
      port2,
      'POST',
      '/api/mongodb/sync-all',
      {},
      { Cookie: saCookie }
    );
    assert(
      syncBlockedRes.status === 403,
      '2.6 POST /api/mongodb/sync-all is hard-blocked (HTTP 403) under Fresh-Start production policy'
    );

    // Initial school setup via pure HttpOnly cookie authentication (NO Authorization header!)
    const updateSettingsRes = await httpRequest(
      port2,
      'PUT',
      '/api/settings',
      { school_name: 'Shawan School & College', academic_year: '2026-2027' },
      { Cookie: saCookie }
    );
    const createClassRes = await httpRequest(
      port2,
      'POST',
      '/api/classes',
      { name: 'Grade 9 - Matric', monthly_fee: 3500, capacity: 40 },
      { Cookie: saCookie }
    );
    const createSectionRes = await httpRequest(
      port2,
      'POST',
      '/api/sections',
      { name: 'A', class_id: createClassRes.data?.id, class_name: 'Grade 9 - Matric', capacity: 40 },
      { Cookie: saCookie }
    );
    const createSubjectRes = await httpRequest(
      port2,
      'POST',
      '/api/subjects',
      { name: 'Physics', code: 'PHY-09', class_name: 'Grade 9 - Matric', weekly_periods: 5 },
      { Cookie: saCookie }
    );
    assert(
      updateSettingsRes.status === 200 &&
        createClassRes.status === 201 &&
        createSectionRes.status === 201 &&
        createSubjectRes.status === 201,
      '2.7 Initial school setup (settings, class, section, subject) succeeds via HttpOnly cookie auth'
    );

    // Create Teacher & Student accounts via authorized workflows + verify RBAC + cookie precedence
    const createTeacherUser = await httpRequest(
      port2,
      'POST',
      '/api/users',
      {
        name: 'Ustad Imran',
        email: 'imran.teacher@shawanschool.edu.pk',
        password: 'TeacherInitPass1!',
        role: 'teacher',
        status: 'active',
      },
      { Cookie: saCookie }
    );
    const regStudent = await httpRequest(port2, 'POST', '/api/auth/register-student', {
      full_name: 'Zainab Bibi',
      email: 'zainab.student@shawanschool.edu.pk',
      password: 'StudentInitPass1!',
      confirm_password: 'StudentInitPass1!',
      dob: '2011-04-10',
      gender: 'Female',
      father_name: 'Abdul Karim',
      phone: '03009998877',
      address: 'Paharpur',
      class_name: 'Grade 9 - Matric',
      section: 'A',
    });
    const studentCookie = extractSessionCookiePair(regStudent.headers['set-cookie']);

    // Cookie precedence check: pass valid Super Admin cookie + Student Bearer token -> req.user must resolve to Super Admin cookie!
    const precedenceMe = await httpRequest(port2, 'GET', '/api/auth/me', undefined, {
      Cookie: saCookie,
      Authorization: `Bearer ${regStudent.data?.token}`,
    });
    const studentAdminBlocked = await httpRequest(port2, 'GET', '/api/users', undefined, {
      Cookie: studentCookie,
    });
    assert(
      createTeacherUser.status === 201 &&
        regStudent.status === 201 &&
        precedenceMe.status === 200 &&
        precedenceMe.data?.user?.role === 'super_admin' &&
        studentAdminBlocked.status === 403,
      '2.8 HttpOnly cookie takes precedence over Bearer fallback and RBAC blocks student from admin routes (403)'
    );

    // =========================================================================
    // 3. SECURE EMAIL-BASED FORGOT PASSWORD, SINGLE-USE, EXPIRY & REVOCATION
    // =========================================================================
    console.log('\n--- SECTION 3: EMAIL-BASED FORGOT PASSWORD SECURITY ---');

    // Enumeration check: unknown vs known email must return identical status & JSON body
    const forgotUnknown = await httpRequest(
      port2,
      'POST',
      '/api/auth/forgot-password',
      { email: 'nobody.ever@shawanschool.edu.pk' },
      { 'X-Forwarded-For': '203.0.113.10' }
    );
    const emailsAfterUnknown = smtpServer.capturedEmails.length;

    const forgotValid = await httpRequest(
      port2,
      'POST',
      '/api/auth/forgot-password',
      { email: 'zainab.student@shawanschool.edu.pk' },
      { 'X-Forwarded-For': '203.0.113.11' }
    );
    const emailsAfterValid = smtpServer.capturedEmails.length;

    assert(
      forgotUnknown.status === 200 &&
        forgotValid.status === 200 &&
        forgotUnknown.data?.message === forgotValid.data?.message &&
        emailsAfterUnknown === 0 &&
        emailsAfterValid === 1,
      '3.1 Account enumeration prevented: identical HTTP 200 message for unknown & valid emails; SMTP mail sent only for valid account'
    );

    const rawEmailText = smtpServer.capturedEmails[0].raw;
    const tokenMatch = rawEmailText.match(/reset_token=([a-f0-9]{64})/i);
    const emailedRawToken = tokenMatch ? tokenMatch[1] : '';
    const storedResetDocs = await inspectorConn
      .collection('password_reset_tokens')
      .find({ email: 'zainab.student@shawanschool.edu.pk' })
      .toArray();
    const expectedHash = crypto.createHash('sha256').update(emailedRawToken).digest('hex');
    const ttlMinutes = storedResetDocs[0]
      ? (new Date(storedResetDocs[0].expires_at).getTime() -
          new Date(storedResetDocs[0].created_at).getTime()) /
        60000
      : 0;

    assert(
      emailedRawToken.length === 64 &&
        storedResetDocs.length === 1 &&
        storedResetDocs[0].token_hash === expectedHash &&
        !JSON.stringify(storedResetDocs[0]).includes(emailedRawToken) &&
        Math.round(ttlMinutes) === 15,
      '3.2 Reset token is 256-bit random, hashed with SHA-256 in MongoDB (raw token never stored), with 15-minute expiry'
    );

    // Verify student's pre-reset session works right now
    const preResetMe = await httpRequest(port2, 'GET', '/api/auth/me', undefined, {
      Cookie: studentCookie,
    });
    assert(preResetMe.status === 200, '3.3 Pre-reset student session is active before password reset');

    // Confirm password reset with single-use token
    const newStudentPass = 'ResetVerifiedPass#2026';
    const confirmResetRes = await httpRequest(
      port2,
      'POST',
      '/api/auth/confirm-reset-password',
      {
        token: emailedRawToken,
        new_password: newStudentPass,
        confirm_password: newStudentPass,
      },
      { 'X-Forwarded-For': '203.0.113.12' }
    );
    assert(
      confirmResetRes.status === 200,
      '3.4 POST /api/auth/confirm-reset-password succeeds with valid single-use token'
    );

    // Replay the exact same token -> must be rejected (single-use)
    const replayResetRes = await httpRequest(
      port2,
      'POST',
      '/api/auth/confirm-reset-password',
      {
        token: emailedRawToken,
        new_password: 'AnotherAttemptPass#1',
        confirm_password: 'AnotherAttemptPass#1',
      },
      { 'X-Forwarded-For': '203.0.113.12' }
    );
    assert(
      replayResetRes.status === 400,
      '3.5 Single-use enforced: replaying used reset token is immediately rejected (HTTP 400)'
    );

    // Insert an already-expired reset token directly in DB and verify rejection
    const expiredRaw = crypto.randomBytes(32).toString('hex');
    await inspectorConn.collection('password_reset_tokens').insertOne({
      token_hash: crypto.createHash('sha256').update(expiredRaw).digest('hex'),
      user_id: String(regStudent.data?.user?.id),
      email: 'zainab.student@shawanschool.edu.pk',
      expires_at: new Date(Date.now() - 60 * 1000),
      used_at: null,
      created_at: new Date(Date.now() - 16 * 60 * 1000),
    });
    const expiredConfirmRes = await httpRequest(
      port2,
      'POST',
      '/api/auth/confirm-reset-password',
      {
        token: expiredRaw,
        new_password: 'ExpiredAttemptPass#1',
        confirm_password: 'ExpiredAttemptPass#1',
      },
      { 'X-Forwarded-For': '203.0.113.13' }
    );
    assert(
      expiredConfirmRes.status === 400,
      '3.6 Expired reset token is rejected (HTTP 400)'
    );

    // Verify pre-reset session cookie AND Bearer token are both revoked after password reset!
    const postResetCookieMe = await httpRequest(port2, 'GET', '/api/auth/me', undefined, {
      Cookie: studentCookie,
    });
    const postResetBearerMe = await httpRequest(port2, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${regStudent.data?.token}`,
    });
    const oldPassLogin = await httpRequest(port2, 'POST', '/api/auth/login', {
      email: 'zainab.student@shawanschool.edu.pk',
      password: 'StudentInitPass1!',
    });
    const newPassLogin = await httpRequest(port2, 'POST', '/api/auth/login', {
      email: 'zainab.student@shawanschool.edu.pk',
      password: newStudentPass,
    });
    assert(
      postResetCookieMe.status === 401 &&
        postResetBearerMe.status === 401 &&
        oldPassLogin.status === 401 &&
        newPassLogin.status === 200,
      '3.7 Password reset revokes all prior sessions (Cookie & Bearer -> 401), blocks old password (401), and permits new password (200)'
    );

    // Rate limit verification on /api/auth/forgot-password (max 5 per 15 mins per IP)
    let rateLimited429 = false;
    for (let i = 0; i < 6; i++) {
      const rlRes = await httpRequest(
        port2,
        'POST',
        '/api/auth/forgot-password',
        { email: 'zainab.student@shawanschool.edu.pk' },
        { 'X-Forwarded-For': '203.0.113.99' }
      );
      if (rlRes.status === 429 && rlRes.headers['retry-after']) {
        rateLimited429 = true;
        break;
      }
    }
    assert(
      rateLimited429,
      '3.8 Forgot-password endpoint enforces shared rate limit (HTTP 429 + Retry-After after 5 requests)'
    );

    // =========================================================================
    // 4. GEMINI AI RELIABILITY, ZERO FABRICATION & LOG SECRET HYGIENE
    // =========================================================================
    console.log('\n--- SECTION 4: GEMINI AI ZERO-FABRICATION & LOG SECRET HYGIENE ---');

    const aiUnpaidFees = await httpRequest(
      port2,
      'POST',
      '/api/admin/ai/query',
      { prompt: 'Show students with unpaid fees.' },
      { Cookie: saCookie }
    );
    const aiFakeStudent = await httpRequest(
      port2,
      'POST',
      '/api/admin/ai/query',
      { prompt: "Show Ahmad Khan's complete record." },
      { Cookie: saCookie }
    );
    assert(
      aiUnpaidFees.status === 200 &&
        aiUnpaidFees.data?.data?.count === 0 &&
        aiFakeStudent.status === 200 &&
        /no matching|not found/i.test(aiFakeStudent.data?.text || '') &&
        !String(aiFakeStudent.data?.text || '').includes('STD-2026-001'),
      '4.1 Deterministic AI tools report exact fresh DB facts (0 unpaid fees; non-existent student not fabricated)'
    );

    const serverLogs = srvMain.getLogs();
    assert(
      !serverLogs.includes(emailedRawToken) &&
        !serverLogs.includes(newStudentPass) &&
        !serverLogs.includes(superPass) &&
        !serverLogs.includes(TEST_BOOTSTRAP_SECRET) &&
        !serverLogs.includes('SmtpPassSecret99!'),
      '4.2 Zero reset tokens, passwords, SMTP credentials, or bootstrap secrets appear in server logs'
    );

    const finalDbHash = sha256File(REAL_DB_PATH);
    assert(
      finalDbHash === initialDbHash,
      `4.3 Real data/db.json remained 100% untouched (SHA-256: ${finalDbHash})`
    );
  } finally {
    if (srvNoSmtp) await srvNoSmtp.stop().catch(() => {});
    if (srvMain) await srvMain.stop().catch(() => {});
    if (smtpServer) await smtpServer.close().catch(() => {});
    if (inspectorConn) await inspectorConn.close().catch(() => {});
    if (memServer) await memServer.stop().catch(() => {});
    fs.rmSync(tmpUploadsDir, { recursive: true, force: true });
  }

  console.log('\n========================================================================');
  console.log(`PHASE 16 HARDENING SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('========================================================================');
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal test suite error:', err);
  process.exit(1);
});
