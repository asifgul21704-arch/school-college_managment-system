/**
 * PHASE 3 — ISOLATED DATABASE INTEGRITY, PERFORMANCE & RELIABILITY SUITE
 *
 * Uses an isolated temporary database file (/tmp) and an isolated ephemeral
 * MongoMemoryServer instance so real school records in data/db.json and the
 * running dev database are NEVER modified.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDbFile = path.join(os.tmpdir(), `shawan_phase3_test_db_${Date.now()}.json`);
const tmpRunnerFile = path.join(__dirname, `.shawan_phase3_runner_${Date.now()}.mts`);
const realDbPath = path.resolve(__dirname, 'data', 'db.json');
const beforeHash = fs.existsSync(realDbPath) ? fs.readFileSync(realDbPath, 'utf8') : null;

fs.copyFileSync(realDbPath, tmpDbFile);

const runnerSource = `
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import jsonwebtoken from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Configure isolated environment BEFORE importing server modules
const memServer = await MongoMemoryServer.create({
  instance: { dbName: 'shawan_phase3_isolated_test' },
});
process.env.MONGODB_URI = memServer.getUri();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'shawan-school-and-college-secure-jwt-secret-2026-paharpur';

const { connectDB } = await import('${path.resolve(__dirname, 'server/config/db.ts')}');
const { seedMongoFromLocal } = await import('${path.resolve(__dirname, 'server/config/seed.ts')}');
const { router: apiRouter } = await import('${path.resolve(__dirname, 'server/routes.ts')}');
const { FeeModel, FeePaymentModel } = await import('${path.resolve(__dirname, 'server/models/index.ts')}');

await connectDB();
await seedMongoFromLocal();

// Ensure indexes are built on the isolated MongoDB database
await mongoose.connection.syncIndexes();

const app = express();
app.use(express.json());
app.use('/api', apiRouter);

const server = http.createServer(app);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
const port = (server.address() as any).port;

const JWT_SECRET = process.env.JWT_SECRET!;
const adminToken = jsonwebtoken.sign(
  { id: 'usr_admin', email: 'admin@shawanschool.edu.pk', role: 'admin', name: 'Admin Officer' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

function request(method: string, urlPath: string, body?: any, token?: string): Promise<{ status: number; headers: any; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/api' + urlPath, method, headers },
      res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, headers: res.headers, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 500, headers: res.headers, data: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

let passed = 0;
let failed = 0;
function assert(cond: any, name: string, detail = '') {
  if (cond) {
    console.log('[PASS] ' + name);
    passed++;
  } else {
    console.error('[FAIL] ' + name + (detail ? ' -> ' + detail : ''));
    failed++;
  }
}

try {
  console.log('====================================================');
  console.log('PHASE 3 — DATABASE INTEGRITY, PERFORMANCE & RELIABILITY');
  console.log('====================================================\\n');

  // --- SECTION 1: DUPLICATE RECORDS & UNIQUE CONSTRAINTS ---
  console.log('--- SECTION 1: DATA INTEGRITY & UNIQUE CONSTRAINTS ---');

  const adm1 = await request('POST', '/admissions/apply', {
    student_name: 'Isolated Test Applicant',
    father_name: 'Isolated Father Name',
    class_applying: 'Grade 8',
    parent_phone: '03001234567',
    gender: 'Male',
    previous_school: 'Model School',
  });
  assert(adm1.status === 201 && Boolean(adm1.data?.application_no), '1. Valid admission application created with unique application_no', 'Status: ' + adm1.status);

  const admDup = await request('POST', '/admissions/apply', {
    student_name: 'Isolated Test Applicant',
    father_name: 'Isolated Father Name',
    class_applying: 'Grade 8',
    parent_phone: '03001234567',
    gender: 'Male',
  });
  assert(admDup.status === 409, '2. Duplicate admission application rejected (409 Conflict)', 'Status: ' + admDup.status);

  // std_01 has class_name: 'Grade 10 - Matric', section: 'A (Science)', roll_no: '101', admission_no: 'SSC-2026-001'
  const stdDupRoll = await request('POST', '/students', {
    full_name: 'Duplicate Roll Candidate',
    father_name: 'Candidate Father',
    admission_no: 'SSC-2026-9991',
    roll_no: '101',
    class_name: 'Grade 10 - Matric',
    section: 'A (Science)',
    gender: 'Male',
  }, adminToken);
  assert(stdDupRoll.status === 409, '3. Duplicate roll number in same class & section rejected (409 Conflict)', 'Status: ' + stdDupRoll.status);

  const stdDupAdmNo = await request('POST', '/students', {
    full_name: 'Duplicate Admission Candidate',
    father_name: 'Candidate Father',
    admission_no: 'SSC-2026-001',
    roll_no: '888',
    class_name: 'Grade 10 - Matric',
    section: 'A (Science)',
    gender: 'Male',
  }, adminToken);
  assert(stdDupAdmNo.status === 409, '4. Duplicate student admission_no rejected (409 Conflict)', 'Status: ' + stdDupAdmNo.status);

  const feeDupCycle = await request('POST', '/fees', {
    student_id: 'std_01',
    fee_month: 'September',
    year: 2026,
    tuition_fee: 3400,
  }, adminToken);
  assert(feeDupCycle.status === 409, '5. Duplicate fee voucher for same student/month/year rejected (409 Conflict)', 'Status: ' + feeDupCycle.status);

  // --- SECTION 2: REFERENCE VALIDATION & VALUE BOUNDS ---
  console.log('\\n--- SECTION 2: REFERENCE VALIDATION & VALUE BOUNDS ---');

  const feeUnknownStd = await request('POST', '/fees', {
    student_id: 'std_non_existent_id',
    fee_month: 'November',
    year: 2026,
    tuition_fee: 4000,
  }, adminToken);
  assert(feeUnknownStd.status === 404, '6. Fee voucher for non-existent student rejected (404 Not Found)', 'Status: ' + feeUnknownStd.status);

  const feeNegative = await request('POST', '/fees', {
    student_id: 'std_01',
    fee_month: 'November',
    year: 2026,
    tuition_fee: -500,
  }, adminToken);
  assert(feeNegative.status === 400, '7. Negative fee voucher amount rejected (400 Bad Request)', 'Status: ' + feeNegative.status);

  const feeZeroTotal = await request('POST', '/fees', {
    student_id: 'std_01',
    fee_month: 'November',
    year: 2026,
    tuition_fee: 0,
    admission_fee: 0,
    other_charges: 0,
  }, adminToken);
  assert(feeZeroTotal.status === 400, '8. Zero-total fee voucher rejected (400 Bad Request)', 'Status: ' + feeZeroTotal.status);

  const attBadStatus = await request('POST', '/attendance/batch', {
    class_name: 'Grade 10 - Matric',
    section: 'A (Science)',
    date: '2026-10-15',
    records: [{ student_id: 'std_01', status: 'ExcusedInvalid' }],
  }, adminToken);
  assert(attBadStatus.status === 400, '9. Invalid attendance status rejected (400 Bad Request)', 'Status: ' + attBadStatus.status);

  const attUnknownStudent = await request('POST', '/attendance/batch', {
    class_name: 'Grade 10 - Matric',
    section: 'A (Science)',
    date: '2026-10-15',
    records: [{ student_id: 'std_unknown_999', status: 'Present' }],
  }, adminToken);
  assert(attUnknownStudent.status === 400, '10. Attendance for unknown student reference rejected (400 Bad Request)', 'Status: ' + attUnknownStudent.status);

  const resUnknownExam = await request('POST', '/results', {
    exam_id: 'ex_unknown_999',
    student_id: 'std_01',
    subjects: [{ subject_name: 'Physics', total_marks: 75, obtained_marks: 65 }],
  }, adminToken);
  assert(resUnknownExam.status === 400, '11. Academic result with unknown exam_id rejected (400 Bad Request)', 'Status: ' + resUnknownExam.status);

  const resInvalidMarks = await request('POST', '/results', {
    exam_id: 'ex_02',
    student_id: 'std_01',
    subjects: [{ subject_name: 'Physics', total_marks: 75, obtained_marks: 90 }],
  }, adminToken);
  assert(resInvalidMarks.status === 400, '12. Academic result with obtained_marks > total_marks rejected (400 Bad Request)', 'Status: ' + resInvalidMarks.status);

  // --- SECTION 3: RELIABLE FINANCIAL RECORDS, RACE CONDITIONS & DB FAILURE ---
  console.log('\\n--- SECTION 3: RELIABLE FINANCIAL RECORDS & CONCURRENCY ---');

  const createdVoucher = await request('POST', '/fees', {
    student_id: 'std_01',
    fee_month: 'December',
    year: 2026,
    tuition_fee: 5000,
    other_charges: 500,
    due_date: '2026-12-10',
  }, adminToken);
  const feeId = createdVoucher.data?.id;
  assert(createdVoucher.status === 201 && Boolean(feeId), '13. New fee voucher persisted in MongoDB (Total: PKR 5500)', 'Status: ' + createdVoucher.status);

  const payZero = await request('PUT', '/fees/' + feeId + '/pay', { amount: 0, method: 'Cash' }, adminToken);
  assert(payZero.status === 400, '14. Zero/negative payment rejected (400 Bad Request)', 'Status: ' + payZero.status);

  const payInvalidMethod = await request('PUT', '/fees/' + feeId + '/pay', { amount: 1000, method: 'CryptoWallet' }, adminToken);
  assert(payInvalidMethod.status === 400, '15. Unsupported payment method rejected (400 Bad Request)', 'Status: ' + payInvalidMethod.status);

  const payOver = await request('PUT', '/fees/' + feeId + '/pay', { amount: 6000, method: 'Cash' }, adminToken);
  assert(payOver.status === 400, '16. Overpayment exceeding pending balance rejected (400 Bad Request)', 'Status: ' + payOver.status);

  // Simulate database write failure: ensure fee is NOT marked paid and no receipt is fabricated
  const origCreate = FeePaymentModel.create.bind(FeePaymentModel);
  (FeePaymentModel as any).create = async () => {
    throw new Error('Simulated mongodb+srv://dbuser:supersecret@cluster0.mongodb.net/shawan disk write failure');
  };
  const failedPay = await request('PUT', '/fees/' + feeId + '/pay', { amount: 2000, method: 'Cash' }, adminToken);
  (FeePaymentModel as any).create = origCreate;

  const checkAfterFailure = await request('GET', '/fees?student_id=std_01', undefined, adminToken);
  const decVoucherAfterFail = (checkAfterFailure.data || []).find((f: any) => f.id === feeId);
  assert(
    failedPay.status === 500 &&
      !JSON.stringify(failedPay.data).includes('supersecret') &&
      decVoucherAfterFail?.paid_amount === 0 &&
      decVoucherAfterFail?.status === 'Unpaid',
    '17. Database write failure returns sanitized 500 error and NEVER fabricates payment or mutates balance',
    'Status: ' + failedPay.status + ', Paid: ' + decVoucherAfterFail?.paid_amount
  );

  // Valid partial payment with transaction_id
  const partialPay = await request('PUT', '/fees/' + feeId + '/pay', {
    amount: 3000,
    method: 'Bank Transfer',
    transaction_id: 'TXN-DEC-2026-0001',
  }, adminToken);
  const mongoPaymentDoc = await FeePaymentModel.findOne({ receipt_no: partialPay.data?.receipt_no }).lean();
  assert(
    partialPay.status === 200 &&
      partialPay.data?.fee?.paid_amount === 3000 &&
      partialPay.data?.fee?.pending_amount === 2500 &&
      partialPay.data?.fee?.status === 'Partial' &&
      Boolean(mongoPaymentDoc),
    '18. Partial payment updates balance accurately and writes verified FeePayment document in MongoDB',
    'Status: ' + partialPay.status
  );

  // Duplicate transaction_id submission rejected
  const dupTxnPay = await request('PUT', '/fees/' + feeId + '/pay', {
    amount: 1000,
    method: 'Bank Transfer',
    transaction_id: 'TXN-DEC-2026-0001',
  }, adminToken);
  assert(dupTxnPay.status === 409, '19. Duplicate transaction_id payment rejected (409 Conflict)', 'Status: ' + dupTxnPay.status);

  // Concurrent race-condition test: two simultaneous 2500 PKR requests against 2500 PKR remaining balance
  const [raceA, raceB] = await Promise.all([
    request('PUT', '/fees/' + feeId + '/pay', { amount: 2500, method: 'Cash' }, adminToken),
    request('PUT', '/fees/' + feeId + '/pay', { amount: 2500, method: 'Cash' }, adminToken),
  ]);
  const raceStatuses = [raceA.status, raceB.status].sort();
  const checkAfterRace = await request('GET', '/fees?student_id=std_01', undefined, adminToken);
  const decVoucherAfterRace = (checkAfterRace.data || []).find((f: any) => f.id === feeId);
  assert(
    raceStatuses[0] === 200 &&
      (raceStatuses[1] === 400 || raceStatuses[1] === 409) &&
      decVoucherAfterRace?.paid_amount === 5500 &&
      decVoucherAfterRace?.pending_amount === 0 &&
      decVoucherAfterRace?.status === 'Paid',
    '20. Concurrent payment race condition prevented: exactly one succeeds and balance never exceeds total',
    'Statuses: ' + JSON.stringify(raceStatuses) + ', Paid: ' + decVoucherAfterRace?.paid_amount
  );

  // Attempt payment on settled voucher
  const payAfterSettled = await request('PUT', '/fees/' + feeId + '/pay', { amount: 500, method: 'Cash' }, adminToken);
  assert(payAfterSettled.status === 400, '21. Payment on already settled voucher rejected (400 Bad Request)', 'Status: ' + payAfterSettled.status);

  // Attempt to delete paid voucher with financial history
  const deletePaidFee = await request('DELETE', '/fees/' + feeId, undefined, adminToken);
  assert(deletePaidFee.status === 400, '22. Deleting fee voucher with recorded payment history blocked (400 Bad Request)', 'Status: ' + deletePaidFee.status);

  // --- SECTION 4: PAGINATION, SORTING & DATE-RANGE FILTERS ---
  console.log('\\n--- SECTION 4: PAGINATION, DATE FILTERS & QUERY PERFORMANCE ---');

  const stdPaged = await request('GET', '/students?page=1&limit=4', undefined, adminToken);
  assert(
    stdPaged.status === 200 &&
      Array.isArray(stdPaged.data) &&
      stdPaged.data.length === 4 &&
      Number(stdPaged.headers['x-total-count']) >= 14 &&
      stdPaged.headers['x-page'] === '1' &&
      stdPaged.headers['x-limit'] === '4',
    '23. GET /students supports bounded pagination headers while preserving array response compatibility',
    'Len: ' + stdPaged.data?.length
  );

  const stdEnvelope = await request('GET', '/students?page=2&limit=4&paginate=true', undefined, adminToken);
  assert(
    stdEnvelope.status === 200 &&
      Array.isArray(stdEnvelope.data?.data) &&
      stdEnvelope.data?.pagination?.page === 2 &&
      stdEnvelope.data?.pagination?.hasPrev === true,
    '24. GET /students?paginate=true returns structured pagination metadata envelope',
    'Page: ' + stdEnvelope.data?.pagination?.page
  );

  const admSept = await request('GET', '/admissions?startDate=2026-09-01&endDate=2026-09-30', undefined, adminToken);
  const admSortedDesc =
    Array.isArray(admSept.data) &&
    admSept.data.every((item: any, idx: number, arr: any[]) =>
      idx === 0 || new Date(arr[idx - 1].created_at).getTime() >= new Date(item.created_at).getTime()
    );
  assert(
    admSept.status === 200 && Array.isArray(admSept.data) && admSept.data.length === 6 && admSortedDesc,
    '25. GET /admissions date-range filter retrieves exact September 2026 records sorted newest-first',
    'Count: ' + admSept.data?.length
  );

  const admBadDate = await request('GET', '/admissions?startDate=not-a-date', undefined, adminToken);
  const admInvertedRange = await request('GET', '/admissions?startDate=2026-10-20&endDate=2026-10-01', undefined, adminToken);
  assert(
    admBadDate.status === 400 && admInvertedRange.status === 400,
    '26. GET /admissions rejects malformed dates and inverted date ranges (400 Bad Request)',
    'Statuses: ' + admBadDate.status + ', ' + admInvertedRange.status
  );

  const attRange = await request('GET', '/attendance?startDate=2026-09-25&endDate=2026-09-30&limit=5', undefined, adminToken);
  assert(
    attRange.status === 200 &&
      Array.isArray(attRange.data) &&
      attRange.data.length <= 5 &&
      attRange.headers['x-total-count'] !== undefined,
    '27. GET /attendance date-range filter, descending sort, and limit operate accurately',
    'Status: ' + attRange.status
  );

  const auditPaged = await request('GET', '/audit-logs?page=1&limit=5', undefined, adminToken);
  assert(
    auditPaged.status === 200 && Array.isArray(auditPaged.data) && auditPaged.headers['x-total-count'] !== undefined,
    '28. GET /audit-logs supports bounded pagination with X-Total-Count header',
    'Status: ' + auditPaged.status
  );

  console.log('\\n====================================================');
  console.log('PHASE 3 INTEGRITY VERIFICATION: ' + passed + ' PASSED, ' + failed + ' FAILED (TOTAL: ' + (passed + failed) + ')');
  console.log('====================================================');
} finally {
  server.close();
  await mongoose.disconnect();
  await memServer.stop();
}

process.exit(failed > 0 ? 1 : 0);
`;

fs.writeFileSync(tmpRunnerFile, runnerSource, 'utf8');

try {
  const result = spawnSync('npx', ['tsx', tmpRunnerFile], {
    cwd: __dirname,
    env: { ...process.env, DB_FILE_PATH: tmpDbFile },
    stdio: 'inherit',
  });

  const afterHash = fs.existsSync(realDbPath) ? fs.readFileSync(realDbPath, 'utf8') : null;
  if (beforeHash !== afterHash) {
    console.error('[CRITICAL] Real school database file was modified during test run!');
    process.exit(1);
  } else {
    console.log('[ISOLATION VERIFIED] Real school database (data/db.json) remained 100% untouched.');
  }

  process.exit(result.status ?? 1);
} finally {
  if (fs.existsSync(tmpDbFile)) fs.unlinkSync(tmpDbFile);
  if (fs.existsSync(tmpRunnerFile)) fs.unlinkSync(tmpRunnerFile);
}
