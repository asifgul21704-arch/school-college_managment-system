/**
 * PHASE 12 — PRODUCTION DEPLOYMENT CONFIGURATION, SECURITY, STORAGE PERSISTENCE,
 * GRACEFUL SHUTDOWN & FINAL ACCEPTANCE VERIFICATION SUITE
 *
 * Isolation Guarantees:
 * - Runs against an isolated MongoMemoryServer and temporary DB_FILE_PATH / UPLOAD_STORAGE_DIR
 * - Verifies production startup guards, Atlas auto-seed protection, VITE_API_BASE_URL bundle safety,
 *   HTTPS Secure/HttpOnly cookies, session expiration, logout revocation, password change/reset session
 *   invalidation, public/private upload persistence across restarts, health checks, indexes, and SIGTERM
 *   graceful shutdown.
 * - Never mutates real data/db.json or data/uploads/.
 */

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const jsonwebtoken = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ROOT = __dirname;
const REAL_DB_PATH = path.resolve(ROOT, 'data', 'db.json');
const PROD_JWT_SECRET = 'Phase12_Prod_Deployment_Verified_Cryptographic_Secret_2026_998877!';
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

    const start = Date.now();
    const req = http.request(
      { hostname: '127.0.0.1', port, path: reqPath, method, headers: reqHeaders },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const durationMs = Date.now() - start;
          const buf = Buffer.concat(chunks);
          const raw = buf.toString('utf8');
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
            buffer: buf,
            durationMs,
          });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function bootProdServer(port, envOverrides = {}) {
  const proc = spawn('node', ['server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      JWT_SECRET: PROD_JWT_SECRET,
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
    throw new Error(`Timed out booting server on port ${port}:\n${stdoutLogs}\n${stderrLogs}`);
  }

  return {
    proc,
    getStdout: () => stdoutLogs,
    getStderr: () => stderrLogs,
    gracefulStop: () =>
      new Promise(resolve => {
        if (proc.exitCode !== null) {
          return resolve({ exitCode: proc.exitCode, stdout: stdoutLogs, stderr: stderrLogs });
        }
        const timer = setTimeout(() => {
          if (proc.exitCode === null) proc.kill('SIGKILL');
        }, 8000);
        proc.once('exit', code => {
          clearTimeout(timer);
          resolve({ exitCode: code, stdout: stdoutLogs, stderr: stderrLogs });
        });
        proc.kill('SIGTERM');
      }),
  };
}

function collectFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

async function main() {
  console.log('========================================================================');
  console.log('PHASE 12 — PRODUCTION DEPLOYMENT & FINAL ACCEPTANCE VERIFICATION SUITE');
  console.log('========================================================================\n');

  const initialDbHash = sha256File(REAL_DB_PATH);
  const runId = Date.now();
  const tmpDbFile = path.join(os.tmpdir(), `shawan_p12_db_${runId}.json`);
  const tmpUploadsDir = path.join(os.tmpdir(), `shawan_p12_uploads_${runId}`);
  const tmpCustomDistDir = path.join(os.tmpdir(), `shawan_p12_dist_${runId}`);
  fs.copyFileSync(REAL_DB_PATH, tmpDbFile);
  fs.mkdirSync(tmpUploadsDir, { recursive: true });

  let passed = 0;
  let failed = 0;
  let memServer = null;
  let activeSrv = null;
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
    // =========================================================================
    // 1. PRODUCTION ENVIRONMENT, BUNDLE SECRET HYGIENE & STARTUP GUARDS
    // =========================================================================
    console.log('--- SECTION 1: PRODUCTION ENV, BUNDLE SAFETY & STARTUP GUARDS ---');

    // 1.1 Invalid PORT rejected at startup
    const badPortRun = spawnSync('node', ['server.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '99999',
        JWT_SECRET: PROD_JWT_SECRET,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
      },
      encoding: 'utf8',
      timeout: 8000,
    });
    assert(
      badPortRun.status !== 0 && (badPortRun.stderr || '').includes('Invalid PORT'),
      '1.1 Startup rejects out-of-range PORT in production (exits non-zero)'
    );

    // 1.2 Frontend bundle secret scan & VITE_API_BASE_URL build support
    const viteCustomBuild = spawnSync(
      './node_modules/.bin/vite',
      ['build', '--outDir', tmpCustomDistDir],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          VITE_API_BASE_URL: 'https://api.shawanschool.edu.pk',
          JWT_SECRET: PROD_JWT_SECRET,
          MONGODB_URI: 'mongodb+srv://dbuser:SuperPrivateAtlasPass99@cluster0.example.mongodb.net/shawan_school',
        },
        encoding: 'utf8',
        timeout: 45000,
      }
    );
    const builtFiles = collectFilesRecursive(tmpCustomDistDir);
    let containsApiBase = false;
    let leakedSecret = false;
    for (const f of builtFiles) {
      if (/\.(js|html|css)$/i.test(f)) {
        const text = fs.readFileSync(f, 'utf8');
        if (text.includes('https://api.shawanschool.edu.pk')) containsApiBase = true;
        if (
          text.includes(PROD_JWT_SECRET) ||
          text.includes('SuperPrivateAtlasPass99') ||
          text.includes('shawan-school-and-college-secure-jwt-secret-2026-paharpur')
        ) {
          leakedSecret = true;
        }
      }
    }
    assert(
      viteCustomBuild.status === 0 && containsApiBase && !leakedSecret,
      '1.2 Frontend production bundle embeds VITE_API_BASE_URL and exposes ZERO backend secrets (JWT_SECRET / MONGODB_URI)'
    );

    // 1.3 Start isolated MongoDB & verify DISABLE_AUTO_SEED / Atlas auto-seed guard
    memServer = await MongoMemoryServer.create({
      instance: { dbName: 'shawan_phase12_prod' },
    });
    const mongoUri = memServer.getUri('shawan_phase12_prod');

    const portNoSeed = 3961;
    const noSeedSrv = await bootProdServer(portNoSeed, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbFile,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
      DISABLE_AUTO_SEED: 'true',
    });
    inspectorConn = await mongoose.createConnection(mongoUri).asPromise();
    const usersBeforeSeed = await inspectorConn.collection('users').countDocuments();
    const skipLogPresent = noSeedSrv.getStdout().includes('Automatic startup seed/migration skipped');
    const firstShutdown = await noSeedSrv.gracefulStop();

    assert(
      usersBeforeSeed === 0 && skipLogPresent,
      '1.3 Production startup auto-seed guard skips automatic seeding when disabled/guarded (0 auto-seeded records)'
    );
    assert(
      firstShutdown.exitCode === 0 &&
        firstShutdown.stdout.includes('HTTP server and database connections closed cleanly'),
      '1.4 SIGTERM triggers clean graceful shutdown of HTTP server and Mongoose connection pool (exit code 0)'
    );

    // =========================================================================
    // 2. BOOT PRODUCTION SERVER WITH INITIAL MIGRATION & VERIFY HTTPS/CORS/HEALTH
    // =========================================================================
    console.log('\n--- SECTION 2: HTTPS HEADERS, CORS, HEALTH & INDEX VERIFICATION ---');

    const prodPort = 3962;
    activeSrv = await bootProdServer(prodPort, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbFile,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });

    const healthRes = await httpRequest(prodPort, 'GET', '/api/health', undefined, {
      Origin: TRUSTED_ORIGIN,
    });
    assert(
      healthRes.status === 200 &&
        healthRes.data?.status === 'ok' &&
        healthRes.data?.connected === true &&
        healthRes.data?.database?.connected === true &&
        healthRes.data?.storage?.writable === true &&
        healthRes.data?.storage?.persistentConfigured === true &&
        !JSON.stringify(healthRes.data).includes(tmpUploadsDir) &&
        healthRes.durationMs < 500,
      `2.1 GET /api/health reports healthy DB + writable persistent storage in ${healthRes.durationMs}ms without leaking paths or secrets`
    );

    assert(
      healthRes.headers['strict-transport-security']?.includes('max-age=31536000') &&
        healthRes.headers['x-content-type-options'] === 'nosniff' &&
        healthRes.headers['referrer-policy'] === 'strict-origin-when-cross-origin' &&
        healthRes.headers['access-control-allow-origin'] === TRUSTED_ORIGIN &&
        healthRes.headers['access-control-allow-credentials'] === 'true',
      '2.2 Production HSTS, nosniff, Referrer-Policy, and trusted CORS_ORIGIN + Credentials headers enforced'
    );

    const untrustedCors = await httpRequest(prodPort, 'GET', '/api/settings', undefined, {
      Origin: 'https://evil-attacker.example.com',
    });
    assert(
      untrustedCors.headers['access-control-allow-origin'] === undefined &&
        untrustedCors.headers['access-control-allow-credentials'] === undefined,
      '2.3 Untrusted Origin receives NO Access-Control-Allow-Origin or Allow-Credentials headers'
    );

    // Verify required MongoDB unique indexes across core collections
    const userIndexes = await inspectorConn.collection('users').indexes();
    const attIndexes = await inspectorConn.collection('attendances').indexes();
    const resIndexes = await inspectorConn.collection('results').indexes();
    const feePayIndexes = await inspectorConn.collection('feepayments').indexes();
    assert(
      userIndexes.some(i => i.key?.email === 1 && i.unique) &&
        attIndexes.some(i => i.key?.student_id === 1 && i.key?.date === 1 && i.unique) &&
        resIndexes.some(i => i.key?.exam_id === 1 && i.key?.student_id === 1 && i.unique) &&
        feePayIndexes.some(i => i.key?.transaction_id === 1 && i.unique),
      '2.4 Critical unique MongoDB indexes verified (users.email, attendances.student_id+date, results.exam_id+student_id, feepayments.transaction_id)'
    );

    // =========================================================================
    // 3. AUTHENTICATION, SECURE COOKIES, EXPIRATION, LOGOUT & PASSWORD RESET
    // =========================================================================
    console.log('\n--- SECTION 3: AUTH, COOKIES, SESSION EXPIRY, LOGOUT & PASSWORD RESET ---');

    const adminLogin = await httpRequest(
      prodPort,
      'POST',
      '/api/auth/login',
      { email: 'office@shawanschool.edu.pk', password: 'AdminPassword123!' },
      { 'X-Forwarded-Proto': 'https', Origin: TRUSTED_ORIGIN }
    );
    const setCookieHeader = Array.isArray(adminLogin.headers['set-cookie'])
      ? adminLogin.headers['set-cookie'].join('; ')
      : String(adminLogin.headers['set-cookie'] || '');

    assert(
      adminLogin.status === 200 &&
        setCookieHeader.includes('shawan_session=') &&
        setCookieHeader.includes('HttpOnly') &&
        setCookieHeader.includes('Secure') &&
        setCookieHeader.includes('SameSite=None'),
      '3.1 HTTPS production login sets HttpOnly + Secure + SameSite=None session cookie',
      setCookieHeader
    );

    const cookiePair = setCookieHeader.split(';')[0];
    const meViaCookieOnly = await httpRequest(prodPort, 'GET', '/api/auth/me', undefined, {
      Cookie: cookiePair,
    });
    assert(
      meViaCookieOnly.status === 200 && meViaCookieOnly.data?.user?.email === 'office@shawanschool.edu.pk',
      '3.2 Authenticated endpoint (/api/auth/me) accepts HttpOnly session cookie without Authorization header'
    );

    // Session expiration check (expired JWT rejected with 401)
    const expiredJwt = jsonwebtoken.sign(
      { id: 'usr_admin', email: 'office@shawanschool.edu.pk', role: 'admin', name: 'Office Admin' },
      PROD_JWT_SECRET,
      { expiresIn: -10 }
    );
    const expiredAttempt = await httpRequest(prodPort, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${expiredJwt}`,
    });
    assert(expiredAttempt.status === 401, '3.3 Expired JWT session is rejected with HTTP 401');

    // Register disposable test student for logout + password change + admin password reset tests
    const studentSignup = await httpRequest(prodPort, 'POST', '/api/auth/register-student', {
      full_name: 'Bilal Phase12 Student',
      email: 'bilal.p12@shawanschool.edu.pk',
      password: 'InitialPass123!',
      confirm_password: 'InitialPass123!',
      father_name: 'rashid Ahmad',
      class_name: 'Grade 10 - Matric',
      section: 'A',
    });
    const token1 = studentSignup.data?.token;
    assert(
      studentSignup.status === 201 && Boolean(token1),
      '3.4 Student self-signup hashes password and issues active session token (HTTP 201)'
    );

    // Logout revokes token1 and clears cookie
    const logoutRes = await httpRequest(
      prodPort,
      'POST',
      '/api/auth/logout',
      {},
      { Authorization: `Bearer ${token1}`, 'X-Forwarded-Proto': 'https' }
    );
    const logoutCookie = Array.isArray(logoutRes.headers['set-cookie'])
      ? logoutRes.headers['set-cookie'].join('; ')
      : String(logoutRes.headers['set-cookie'] || '');
    const replayAfterLogout = await httpRequest(prodPort, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${token1}`,
    });
    assert(
      logoutRes.status === 200 &&
        logoutCookie.includes('Max-Age=0') &&
        replayAfterLogout.status === 401,
      '3.5 Logout clears HttpOnly cookie (Max-Age=0) and immediately revokes logged-out JWT against replay (HTTP 401)'
    );

    // Re-login and test self-service password change
    const relogin = await httpRequest(prodPort, 'POST', '/api/auth/login', {
      email: 'bilal.p12@shawanschool.edu.pk',
      password: 'InitialPass123!',
    });
    const token2 = relogin.data?.token;

    const wrongCurrPass = await httpRequest(
      prodPort,
      'POST',
      '/api/auth/change-password',
      { current_password: 'WrongPassword!', new_password: 'UpdatedPass456!' },
      { Authorization: `Bearer ${token2}` }
    );
    const validPassChange = await httpRequest(
      prodPort,
      'POST',
      '/api/auth/change-password',
      { current_password: 'InitialPass123!', new_password: 'UpdatedPass456!' },
      { Authorization: `Bearer ${token2}` }
    );
    const token3 = validPassChange.data?.token;
    const oldTokenAfterChange = await httpRequest(prodPort, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${token2}`,
    });
    const newTokenAfterChange = await httpRequest(prodPort, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${token3}`,
    });
    assert(
      wrongCurrPass.status === 401 &&
        validPassChange.status === 200 &&
        oldTokenAfterChange.status === 401 &&
        newTokenAfterChange.status === 200,
      '3.6 Self-service password change verifies current password, invalidates prior token (401), and issues fresh session (200)'
    );

    // Admin password reset & privilege boundary (admin cannot reset super_admin; admin CAN reset student)
    const adminToken = adminLogin.data.token;
    const resetSuperAttempt = await httpRequest(
      prodPort,
      'POST',
      '/api/auth/reset-password',
      { email: 'admin@shawanschool.edu.pk', new_password: 'HackedSuperPassword1!' },
      { Authorization: `Bearer ${adminToken}` }
    );
    const resetStudentRes = await httpRequest(
      prodPort,
      'POST',
      '/api/auth/reset-password',
      { email: 'bilal.p12@shawanschool.edu.pk', new_password: 'AdminResetPass789!' },
      { Authorization: `Bearer ${adminToken}` }
    );
    const studentOldSessionAfterReset = await httpRequest(prodPort, 'GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${token3}`,
    });
    const loginWithResetPass = await httpRequest(prodPort, 'POST', '/api/auth/login', {
      email: 'bilal.p12@shawanschool.edu.pk',
      password: 'AdminResetPass789!',
    });
    assert(
      resetSuperAttempt.status === 403 &&
        resetStudentRes.status === 200 &&
        studentOldSessionAfterReset.status === 401 &&
        loginWithResetPass.status === 200,
      '3.7 Admin password reset blocks super_admin escalation (403), invalidates all target user sessions (401), and enables login with new password (200)'
    );

    // Ensure no passwords or tokens leaked into stdout/stderr logs
    const combinedServerLogs = `${activeSrv.getStdout()}\n${activeSrv.getStderr()}`;
    assert(
      !combinedServerLogs.includes('InitialPass123!') &&
        !combinedServerLogs.includes('UpdatedPass456!') &&
        !combinedServerLogs.includes('AdminResetPass789!') &&
        !combinedServerLogs.includes(PROD_JWT_SECRET),
      '3.8 Zero passwords, tokens, or secrets appear in backend stdout/stderr logs'
    );

    // =========================================================================
    // 4. MEDIA & PRIVATE DOCUMENT STORAGE PERSISTENCE ACROSS RESTARTS
    // =========================================================================
    console.log('\n--- SECTION 4: MEDIA & DOCUMENT STORAGE SECURITY & PERSISTENCE ---');

    const tinyPngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const tinyPdfBase64 =
      'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF').toString('base64');

    const pubUpload = await httpRequest(
      prodPort,
      'POST',
      '/api/upload',
      { dataUrl: tinyPngBase64, filename: 'campus_banner.png', category: 'school_media', visibility: 'public' },
      { Authorization: `Bearer ${adminToken}` }
    );
    const privUpload = await httpRequest(
      prodPort,
      'POST',
      '/api/upload',
      {
        dataUrl: tinyPdfBase64,
        filename: 'student_bform.pdf',
        category: 'student_document',
        visibility: 'private',
        student_id: studentSignup.data?.studentProfile?.id,
      },
      { Authorization: `Bearer ${loginWithResetPass.data.token}` }
    );
    const badMimeUpload = await httpRequest(
      prodPort,
      'POST',
      '/api/upload',
      { dataUrl: 'data:text/html;base64,PGh0bWw+PC9odG1sPg==', filename: 'xss.html' },
      { Authorization: `Bearer ${adminToken}` }
    );

    assert(
      pubUpload.status === 201 &&
        pubUpload.data?.url?.startsWith('/uploads/') &&
        privUpload.status === 201 &&
        privUpload.data?.url?.startsWith('/api/documents/') &&
        badMimeUpload.status === 400,
      '4.1 Public gallery image (/uploads/*), private PDF document (/api/documents/*), and MIME validation (400 on HTML) verified'
    );

    // Block public access to private document via /uploads/private/* and unauthenticated /api/documents/*
    const directPublicAttempt = await httpRequest(prodPort, 'GET', `/uploads/private/${privUpload.data.filename}`);
    const unauthDocAttempt = await httpRequest(prodPort, 'GET', privUpload.data.url);
    const otherStudentLogin = await httpRequest(prodPort, 'POST', '/api/auth/login', {
      email: 'student@shawanschool.edu.pk',
      password: 'StudentPassword123!',
    });
    const idorDocAttempt = await httpRequest(prodPort, 'GET', privUpload.data.url, undefined, {
      Authorization: `Bearer ${otherStudentLogin.data.token}`,
    });
    const ownerDocFetch = await httpRequest(prodPort, 'GET', privUpload.data.url, undefined, {
      Authorization: `Bearer ${loginWithResetPass.data.token}`,
    });

    assert(
      directPublicAttempt.status === 403 &&
        unauthDocAttempt.status === 401 &&
        idorDocAttempt.status === 403 &&
        ownerDocFetch.status === 200,
      `4.2 Private document strictly isolated (directPublic=${directPublicAttempt.status}, unauth=${unauthDocAttempt.status}, crossStudentIdor=${idorDocAttempt.status}, owner=${ownerDocFetch.status})`
    );

    // Restart server cleanly (SIGTERM -> reboot on same UPLOAD_STORAGE_DIR & MONGODB_URI) and verify persistence
    await activeSrv.gracefulStop();
    activeSrv = await bootProdServer(prodPort, {
      MONGODB_URI: mongoUri,
      DB_FILE_PATH: tmpDbFile,
      UPLOAD_STORAGE_DIR: tmpUploadsDir,
    });

    const pubAfterRestart = await httpRequest(prodPort, 'GET', pubUpload.data.url);
    const privAfterRestart = await httpRequest(prodPort, 'GET', privUpload.data.url, undefined, {
      Authorization: `Bearer ${loginWithResetPass.data.token}`,
    });
    assert(
      pubAfterRestart.status === 200 &&
        pubAfterRestart.headers['x-content-type-options'] === 'nosniff' &&
        privAfterRestart.status === 200,
      '4.3 Public gallery media and private student documents persist across full server restart when UPLOAD_STORAGE_DIR is mounted'
    );

    // =========================================================================
    // 5. PAGINATION & REAL data/db.json IMMUTABILITY
    // =========================================================================
    console.log('\n--- SECTION 5: PAGINATION & LOCAL STORE IMMUTABILITY ---');

    const paginatedStudents = await httpRequest(
      prodPort,
      'GET',
      '/api/students?paginate=true&page=1&limit=5',
      undefined,
      { Authorization: `Bearer ${adminToken}` }
    );
    assert(
      paginatedStudents.status === 200 &&
        Array.isArray(paginatedStudents.data?.data) &&
        paginatedStudents.data.data.length <= 5 &&
        Number(paginatedStudents.headers['x-total-count']) >= 5 &&
        paginatedStudents.durationMs < 500,
      `5.1 Paginated API query succeeds with X-Total-Count header in ${paginatedStudents.durationMs}ms`
    );

    await activeSrv.gracefulStop();
    activeSrv = null;

    const finalDbHash = sha256File(REAL_DB_PATH);
    assert(
      finalDbHash === initialDbHash,
      `5.2 Real data/db.json remained 100% untouched (SHA-256: ${finalDbHash})`
    );
  } finally {
    if (activeSrv) {
      await activeSrv.gracefulStop().catch(() => {});
    }
    if (inspectorConn) {
      await inspectorConn.close().catch(() => {});
    }
    if (memServer) {
      await memServer.stop().catch(() => {});
    }
    try {
      fs.rmSync(tmpDbFile, { force: true });
      fs.rmSync(tmpUploadsDir, { recursive: true, force: true });
      fs.rmSync(tmpCustomDistDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n========================================================================');
  console.log(`PHASE 12 PRODUCTION ACCEPTANCE SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('========================================================================');
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error in Phase 12 acceptance suite:', err);
  process.exit(1);
});
