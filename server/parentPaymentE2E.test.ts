import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserModel } from './models/User.ts';
import { StudentModel } from './models/Student.ts';
import { FeeModel } from './models/Fee.ts';
import { FeePaymentModel } from './models/FeePayment.ts';

const API = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3000/api';
const PASSWORD = 'E2eStrongPass!2026';
const DOB = '2011-02-03';
const RUN_ID = Date.now().toString(36);

function assertIsolatedTarget() {
  const expected = String(process.env.E2E_EXPECTED_DATABASE_NAME || '');
  const uri = String(process.env.MONGODB_URI || '');
  assert.equal(process.env.E2E_ALLOW_MUTATIONS, 'true', 'E2E mutations require explicit opt-in');
  assert.match(expected, /^e2e[_-]/i, 'E2E database name must use the e2e_ or e2e- prefix');
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i, 'E2E tests only run against loopback MongoDB');
  assert.ok(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32, 'A dedicated test-only JWT secret is required');
}

async function api(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cacheControl: response.headers.get('cache-control') || '' };
}

async function registerStudent(label: string, fatherName: string, className = 'E2E Class') {
  const result = await api('POST', '/auth/register-student', {
    full_name: `E2E Student ${label}`,
    email: `student-${label.toLowerCase()}-${RUN_ID}@e2e.invalid`,
    password: PASSWORD,
    confirm_password: PASSWORD,
    dob: DOB,
    father_name: fatherName,
    class_name: className,
    section: 'A',
    gender: 'Male',
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.ok(result.data.token);
  assert.ok(result.data.studentProfile?.id);
  return {
    id: result.data.studentProfile.id as string,
    admissionNo: result.data.studentProfile.admission_no as string,
    rollNo: result.data.studentProfile.roll_no as string,
    token: result.data.token as string,
    email: `student-${label.toLowerCase()}-${RUN_ID}@e2e.invalid`,
  };
}

async function registerParent(label: string, childAdmissionNo: string) {
  const name = `E2E Parent ${label}`;
  const email = `parent-${label.toLowerCase()}-${RUN_ID}@e2e.invalid`;
  const result = await api('POST', '/auth/register-parent', {
    full_name: name,
    email,
    password: PASSWORD,
    confirm_password: PASSWORD,
    child_admission_no: childAdmissionNo,
    child_dob: DOB,
  });
  return { ...result, email, name };
}

async function createFee(student: { id: string }, label: string) {
  const voucherId = `E2E-VOUCHER-${RUN_ID}-${label}`;
  await FeeModel.create({
    voucher_id: voucherId,
    student_id: student.id,
    student_name: `E2E Student ${label}`,
    class_name: 'E2E Class',
    fee_month: 'November',
    year: 2026,
    tuition_fee: 5000,
    total_amount: 5000,
    paid_amount: 0,
    pending_amount: 5000,
    due_date: '2026-11-30',
    status: 'Unpaid',
    payment_history: [],
  });
  return voucherId;
}

async function submitBankPayment(token: string, feeId: string, studentId: string, slipRef: string, amount = 5000) {
  return api('POST', '/parent/payments/initiate', {
    fee_id: feeId,
    student_id: studentId,
    amount,
    method: 'Bank Deposit',
    bank_name: 'E2E Test Bank',
    account_number: 'TEST-ACCOUNT',
    deposit_date: '2026-11-12',
    deposit_slip_ref: slipRef,
  }, token);
}

let adminToken = '';

before(async () => {
  assertIsolatedTarget();
  await mongoose.connect(process.env.MONGODB_URI!);
  assert.equal(mongoose.connection.name, process.env.E2E_EXPECTED_DATABASE_NAME);
  assert.equal(String(mongoose.connection.host || '').includes('.mongodb.net'), false);
  await Promise.all([
    UserModel.init(),
    StudentModel.init(),
    FeeModel.init(),
    FeePaymentModel.init(),
  ]);

  const adminPasswordHash = await bcrypt.hash(PASSWORD, 10);
  await UserModel.create({
    record_id: `usr_e2e_admin_${RUN_ID}`,
    email: `admin-${RUN_ID}@e2e.invalid`,
    password_hash: adminPasswordHash,
    name: 'E2E Administrator',
    role: 'admin',
    status: 'active',
  });
  const adminLogin = await api('POST', '/auth/login', {
    email: `admin-${RUN_ID}@e2e.invalid`,
    password: PASSWORD,
  });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
  adminToken = adminLogin.data.token;
  assert.ok(adminToken);
});

after(async () => {
  await mongoose.disconnect();
});

test('parent/student permissions, unlink invalidation, and payment history work end to end', async () => {
  const studentA = await registerStudent('A', 'E2E Parent A');
  const studentB = await registerStudent('B', 'E2E Parent B');
  const studentD = await registerStudent('D', 'E2E Parent D');

  const parentA = await registerParent('A', studentA.admissionNo);
  assert.equal(parentA.status, 201, JSON.stringify(parentA.data));
  const parentAToken = parentA.data.token as string;

  const parentB = await registerParent('B', studentB.admissionNo);
  assert.equal(parentB.status, 201, JSON.stringify(parentB.data));
  const parentBToken = parentB.data.token as string;

  const parentD = await registerParent('D', studentD.admissionNo);
  assert.equal(parentD.status, 201, JSON.stringify(parentD.data));
  const parentDToken = parentD.data.token as string;

  const parentIntruder = await registerParent('Intruder', '');
  assert.equal(parentIntruder.status, 201, JSON.stringify(parentIntruder.data));
  const parentIntruderToken = parentIntruder.data.token as string;

  // Parent profile and child-discovery endpoints must enforce account ownership.
  const parentAOwnProfile = await api('GET', `/parents/${encodeURIComponent(parentA.data.user.id)}`, undefined, parentAToken);
  assert.equal(parentAOwnProfile.status, 200);
  const parentACrossProfile = await api('GET', `/parents/${encodeURIComponent(parentB.data.user.id)}`, undefined, parentAToken);
  assert.equal(parentACrossProfile.status, 403);
  const parentACrossProfileUpdate = await api('PUT', `/parents/${encodeURIComponent(parentB.data.user.id)}`, { name: 'Unauthorized Edit' }, parentAToken);
  assert.equal(parentACrossProfileUpdate.status, 403);
  const parentACannotListAllParents = await api('GET', '/parents', undefined, parentAToken);
  assert.equal(parentACannotListAllParents.status, 403);
  const studentACannotUseParentDirectory = await api('GET', '/parents/my-students', undefined, studentA.token);
  assert.equal(studentACannotUseParentDirectory.status, 403);
  const intruderCannotDiscoverClaimedChild = await api('POST', '/parents/find-child', {
    father_name: 'E2E Parent A',
    student_name: 'E2E Student A',
    class_name: 'E2E Class',
    roll_no: studentA.rollNo,
  }, parentIntruderToken);
  assert.equal(intruderCannotDiscoverClaimedChild.status, 404);
  assert.equal(intruderCannotDiscoverClaimedChild.data.matches, undefined);

  // Two simultaneous parent signups for one unclaimed child must have exactly one winner.
  const studentC = await registerStudent('C', 'E2E Parent Race');
  const raceAttempts = await Promise.all([
    registerParent('RaceOne', studentC.admissionNo),
    registerParent('RaceTwo', studentC.admissionNo),
  ]);
  assert.deepEqual(raceAttempts.map(result => result.status).sort(), [201, 409]);
  const raceWinner = raceAttempts.find(result => result.status === 201)!;
  const raceLoser = raceAttempts.find(result => result.status === 409)!;
  const raceStudent = await StudentModel.findOne({ record_id: studentC.id }).lean();
  assert.equal(raceStudent?.parent_user_id, raceWinner.data.user.id);
  assert.equal(await UserModel.exists({ email: raceLoser.email }), null);

  // A second parent cannot claim a student already owned by Parent A.
  const blockedParent = await registerParent('Blocked', studentA.admissionNo);
  assert.equal(blockedParent.status, 409, JSON.stringify(blockedParent.data));
  assert.equal(await UserModel.exists({ email: blockedParent.email }), null);

  const parentAStudents = await api('GET', '/students', undefined, parentAToken);
  assert.equal(parentAStudents.status, 200);
  assert.match(parentAStudents.cacheControl, /no-store/i);
  assert.deepEqual(parentAStudents.data.map((student: any) => student.id), [studentA.id]);

  const parentAReadsB = await api('GET', `/students/${encodeURIComponent(studentB.id)}`, undefined, parentAToken);
  assert.equal(parentAReadsB.status, 403);

  const studentAReadsSelf = await api('GET', `/students/${encodeURIComponent(studentA.id)}`, undefined, studentA.token);
  assert.equal(studentAReadsSelf.status, 200);
  const studentAReadsB = await api('GET', `/students/${encodeURIComponent(studentB.id)}`, undefined, studentA.token);
  assert.equal(studentAReadsB.status, 403);

  const feeA = await createFee(studentA, 'A');
  const feeB = await createFee(studentB, 'B');

  const paymentA = await submitBankPayment(parentAToken, feeA, studentA.id,  `E2E-SLIP-A-${RUN_ID}`);
  assert.equal(paymentA.status, 201, JSON.stringify(paymentA.data));
  const paymentAId = paymentA.data.payment.id;

  // Exact retry is idempotent: it recovers the original payment instead of duplicating it.
  const paymentARetry = await submitBankPayment(parentAToken, feeA, studentA.id, `E2E-SLIP-A-${RUN_ID}`);
  assert.equal(paymentARetry.status, 200, JSON.stringify(paymentARetry.data));
  assert.equal(paymentARetry.data.idempotent_replay, true);
  assert.equal(await FeePaymentModel.countDocuments({ transaction_id: `E2E-SLIP-A-${RUN_ID}` }), 1);

  const parentACrossPayment = await submitBankPayment(parentAToken, feeB, studentB.id,  `E2E-SLIP-A-CROSS-${RUN_ID}`);
  assert.equal(parentACrossPayment.status, 403);

  const paymentB = await submitBankPayment(parentBToken, feeB, studentB.id,  `E2E-SLIP-B-${RUN_ID}`);
  assert.equal(paymentB.status, 201, JSON.stringify(paymentB.data));

  const studentACrossPayment = await submitBankPayment(studentA.token, feeB, studentB.id,  `E2E-SLIP-STUDENT-CROSS-${RUN_ID}`);
  assert.equal(studentACrossPayment.status, 403);

  const parentAHistory = await api('GET', '/parent/payments/history', undefined, parentAToken);
  assert.equal(parentAHistory.status, 200);
  assert.deepEqual(parentAHistory.data.map((payment: any) => payment.id), [paymentAId]);

  const parentBHistory = await api('GET', '/parent/payments/history', undefined, parentBToken);
  assert.equal(parentBHistory.status, 200);
  assert.equal(parentBHistory.data.length, 1);
  assert.equal(parentBHistory.data[0].student_id, studentB.id);

  const studentAHistory = await api('GET', '/parent/payments/history', undefined, studentA.token);
  assert.equal(studentAHistory.status, 200);
  assert.equal(studentAHistory.data.length, 1);
  assert.equal(studentAHistory.data[0].student_id, studentA.id);

  const parentBAi = await api('POST', '/portal/ai/query', { prompt: 'show my child attendance' }, parentBToken);
  assert.equal(parentBAi.status, 200, JSON.stringify(parentBAi.data));
  assert.match(parentBAi.data.text, /E2E Student B/);
  assert.doesNotMatch(parentBAi.data.text, /E2E Student A/);
  const studentAAi = await api('POST', '/portal/ai/query', { prompt: 'what is my attendance?' }, studentA.token);
  assert.equal(studentAAi.status, 200, JSON.stringify(studentAAi.data));
  assert.match(studentAAi.data.text, /E2E Student A/);

  // Keep using the original Parent A JWT after unlink; the live account record must deny the old child.
  const unlinkA = await api('POST', '/parents/unlink-child', { student_id: studentA.id }, parentAToken);
  assert.equal(unlinkA.status, 200, JSON.stringify(unlinkA.data));
  const oldSessionReadsA = await api('GET', `/students/${encodeURIComponent(studentA.id)}`, undefined, parentAToken);
  assert.equal(oldSessionReadsA.status, 403);
  const oldSessionChildren = await api('GET', '/parents/my-students', undefined, parentAToken);
  assert.equal(oldSessionChildren.status, 200);
  assert.deepEqual(oldSessionChildren.data, []);
  const oldSessionHistory = await api('GET', '/parent/payments/history', undefined, parentAToken);
  assert.equal(oldSessionHistory.status, 200);
  assert.deepEqual(oldSessionHistory.data, []);
  const oldSessionPaymentAttempt = await submitBankPayment(
    parentAToken,
    feeA,
    studentA.id,
    `E2E-SLIP-A-AFTER-UNLINK-${RUN_ID}`
  );
  assert.equal(oldSessionPaymentAttempt.status, 403);
  const oldSessionAi = await api('POST', '/portal/ai/query', { prompt: 'show my child attendance' }, parentAToken);
  assert.equal(oldSessionAi.status, 404);
  const oldSessionFeeSummary = await api('GET', '/parent/fees/summary', undefined, parentAToken);
  assert.equal(oldSessionFeeSummary.status, 200);
  assert.equal(oldSessionFeeSummary.data.total_outstanding, 0);

  const releasedStudent = await StudentModel.findOne({ record_id: studentA.id }).lean();
  assert.ok(!releasedStudent?.parent_user_id);

  // A newly verified parent can claim the released child.
  const parentC = await registerParent('C', studentA.admissionNo);
  assert.equal(parentC.status, 201, JSON.stringify(parentC.data));
  const parentCToken = parentC.data.token as string;
  const parentAStillDenied = await api('GET', `/students/${encodeURIComponent(studentA.id)}`, undefined, parentAToken);
  assert.equal(parentAStillDenied.status, 403);
  const parentCHistory = await api('GET', '/parent/payments/history', undefined, parentCToken);
  assert.equal(parentCHistory.status, 200);
  assert.equal(parentCHistory.data.length, 1);
  assert.equal(parentCHistory.data[0].student_id, studentA.id);

  // Admin routes must not bypass ownership or unlink a relationship belonging to another parent.
  const adminCannotStealB = await api('POST', '/admin/parent-links/link', {
    parent_id: parentC.data.user.id,
    student_id: studentB.id,
  }, adminToken);
  assert.equal(adminCannotStealB.status, 409);
  const adminCannotUnlinkB = await api('POST', '/admin/parent-links/unlink', {
    parent_id: parentC.data.user.id,
    student_id: studentB.id,
  }, adminToken);
  assert.equal(adminCannotUnlinkB.status, 409);

  const adminSameOwnerLink = await api('POST', '/admin/parent-links/link', {
    parent_id: parentC.data.user.id,
    student_id: studentA.id,
  }, adminToken);
  assert.equal(adminSameOwnerLink.status, 200, JSON.stringify(adminSameOwnerLink.data));
  const adminUnlinkA = await api('POST', '/admin/parent-links/unlink', {
    parent_id: parentC.data.user.id,
    student_id: studentA.id,
  }, adminToken);
  assert.equal(adminUnlinkA.status, 200, JSON.stringify(adminUnlinkA.data));

  const parentCAfterAdminUnlink = await api('GET', `/students/${encodeURIComponent(studentA.id)}`, undefined, parentCToken);
  assert.equal(parentCAfterAdminUnlink.status, 403);
  const parentCHistoryAfterAdminUnlink = await api('GET', '/parent/payments/history', undefined, parentCToken);
  assert.deepEqual(parentCHistoryAfterAdminUnlink.data, []);
  const parentCAiAfterAdminUnlink = await api('POST', '/portal/ai/query', { prompt: 'show my child attendance' }, parentCToken);
  assert.equal(parentCAiAfterAdminUnlink.status, 404);

  // Student access and the other parent's payment history remain independent of parent unlinking.
  const studentAStillOwnsRecord = await api('GET', `/students/${encodeURIComponent(studentA.id)}`, undefined, studentA.token);
  assert.equal(studentAStillOwnsRecord.status, 200);
  const studentAHistoryAfterParentUnlinks = await api('GET', '/parent/payments/history', undefined, studentA.token);
  assert.equal(studentAHistoryAfterParentUnlinks.status, 200);
  assert.equal(studentAHistoryAfterParentUnlinks.data.length, 1);
  assert.equal(studentAHistoryAfterParentUnlinks.data[0].student_id, studentA.id);
  const parentBStillOwnsChild = await api('GET', `/students/${encodeURIComponent(studentB.id)}`, undefined, parentBToken);
  assert.equal(parentBStillOwnsChild.status, 200);
  const parentBHistoryAfterUnlinks = await api('GET', '/parent/payments/history', undefined, parentBToken);
  assert.equal(parentBHistoryAfterUnlinks.data.length, 1);

  // Manual payment approval is restricted to administrators and atomically updates
  // the voucher, receipt history, payment status, and parent history.
  const feeD = await createFee(studentD, 'D');
  const paymentD = await submitBankPayment(parentDToken, feeD, studentD.id, `E2E-SLIP-D-APPROVE-${RUN_ID}`);
  assert.equal(paymentD.status, 201, JSON.stringify(paymentD.data));
  const paymentDId = paymentD.data.payment.id;
  const parentCannotApprove = await api('POST', `/admin/payments/${encodeURIComponent(paymentDId)}/approve`, {}, parentDToken);
  assert.equal(parentCannotApprove.status, 403);
  const pendingFeeD = await FeeModel.findOne({ voucher_id: feeD }).lean();
  assert.equal(pendingFeeD?.pending_amount, 5000);
  assert.equal(pendingFeeD?.paid_amount, 0);

  const approvedD = await api('POST', `/admin/payments/${encodeURIComponent(paymentDId)}/approve`, {}, adminToken);
  assert.equal(approvedD.status, 200, JSON.stringify(approvedD.data));
  assert.equal(approvedD.data.payment.status, 'Paid');
  assert.equal(approvedD.data.payment.verification_status, 'Verified');
  assert.ok(approvedD.data.payment.receipt_no);
  const approvedReceipt = approvedD.data.payment.receipt_no as string;

  const approvedFeeD = await FeeModel.findOne({ voucher_id: feeD }).lean();
  assert.equal(approvedFeeD?.paid_amount, 5000);
  assert.equal(approvedFeeD?.pending_amount, 0);
  assert.equal(approvedFeeD?.status, 'Paid');
  assert.equal(approvedFeeD?.payment_history.length, 1);
  assert.equal(approvedFeeD?.payment_history[0].receipt_no, approvedReceipt);

  const approvalReplay = await api('POST', `/admin/payments/${encodeURIComponent(paymentDId)}/approve`, {}, adminToken);
  assert.equal(approvalReplay.status, 200, JSON.stringify(approvalReplay.data));
  assert.equal(approvalReplay.data.payment.receipt_no, approvedReceipt);
  const approvedFeeAfterReplay = await FeeModel.findOne({ voucher_id: feeD }).lean();
  assert.equal(approvedFeeAfterReplay?.payment_history.length, 1);
  assert.equal(approvedFeeAfterReplay?.paid_amount, 5000);

  const parentDHistory = await api('GET', '/parent/payments/history', undefined, parentDToken);
  assert.equal(parentDHistory.status, 200);
  assert.equal(parentDHistory.data.length, 1);
  assert.equal(parentDHistory.data[0].receipt_no, approvedReceipt);

  // Rejection must preserve the outstanding balance and the original reason on retries.
  const studentE = await registerStudent('E', 'E2E Parent E');
  const parentE = await registerParent('E', studentE.admissionNo);
  assert.equal(parentE.status, 201, JSON.stringify(parentE.data));
  const parentEToken = parentE.data.token as string;
  const feeE = await createFee(studentE, 'E');
  const paymentE = await submitBankPayment(parentEToken, feeE, studentE.id, `E2E-SLIP-E-REJECT-${RUN_ID}`);
  assert.equal(paymentE.status, 201, JSON.stringify(paymentE.data));
  const paymentEId = paymentE.data.payment.id;

  const parentCannotReject = await api('POST', `/admin/payments/${encodeURIComponent(paymentEId)}/reject`, { reason: 'Not admin' }, parentEToken);
  assert.equal(parentCannotReject.status, 403);
  const rejectedE = await api('POST', `/admin/payments/${encodeURIComponent(paymentEId)}/reject`, { reason: 'Deposit slip is unreadable' }, adminToken);
  assert.equal(rejectedE.status, 200, JSON.stringify(rejectedE.data));
  assert.equal(rejectedE.data.payment.status, 'Rejected');
  assert.equal(rejectedE.data.payment.verification_status, 'Rejected');
  assert.equal(rejectedE.data.payment.rejection_reason, 'Deposit slip is unreadable');

  const rejectedFeeE = await FeeModel.findOne({ voucher_id: feeE }).lean();
  assert.equal(rejectedFeeE?.paid_amount, 0);
  assert.equal(rejectedFeeE?.pending_amount, 5000);
  assert.equal(rejectedFeeE?.payment_history.length, 0);

  const rejectionReplay = await api('POST', `/admin/payments/${encodeURIComponent(paymentEId)}/reject`, { reason: 'Changed reason must not overwrite' }, adminToken);
  assert.equal(rejectionReplay.status, 200, JSON.stringify(rejectionReplay.data));
  assert.equal(rejectionReplay.data.payment.rejection_reason, 'Deposit slip is unreadable');
  const rejectedFeeAfterReplay = await FeeModel.findOne({ voucher_id: feeE }).lean();
  assert.equal(rejectedFeeAfterReplay?.paid_amount, 0);
  assert.equal(rejectedFeeAfterReplay?.pending_amount, 5000);
  assert.equal(rejectedFeeAfterReplay?.payment_history.length, 0);

  const parentEHistory = await api('GET', '/parent/payments/history', undefined, parentEToken);
  assert.equal(parentEHistory.status, 200);
  assert.equal(parentEHistory.data.length, 1);
  assert.equal(parentEHistory.data[0].status, 'Rejected');
  assert.equal(parentEHistory.data[0].rejection_reason, 'Deposit slip is unreadable');

  // Partial payments must reduce the outstanding balance incrementally and issue
  // a distinct receipt for each approved installment.
  const studentF = await registerStudent('F', 'E2E Parent F');
  const parentF = await registerParent('F', studentF.admissionNo);
  assert.equal(parentF.status, 201, JSON.stringify(parentF.data));
  const parentFToken = parentF.data.token as string;
  const feeF = await createFee(studentF, 'F');

  const overpaymentF = await submitBankPayment(parentFToken, feeF, studentF.id, `E2E-SLIP-F-OVERPAY-${RUN_ID}`, 6000);
  assert.equal(overpaymentF.status, 400);
  assert.equal(await FeePaymentModel.countDocuments({ fee_id: feeF }), 0);

  const installmentOne = await submitBankPayment(parentFToken, feeF, studentF.id, `E2E-SLIP-F-ONE-${RUN_ID}`, 2500);
  assert.equal(installmentOne.status, 201, JSON.stringify(installmentOne.data));
  const installmentOneId = installmentOne.data.payment.id;
  const installmentOneApproval = await api('POST', `/admin/payments/${encodeURIComponent(installmentOneId)}/approve`, {}, adminToken);
  assert.equal(installmentOneApproval.status, 200, JSON.stringify(installmentOneApproval.data));
  assert.equal(installmentOneApproval.data.payment.status, 'Paid');
  const installmentOneReceipt = installmentOneApproval.data.payment.receipt_no;

  const partialFeeF = await FeeModel.findOne({ voucher_id: feeF }).lean();
  assert.equal(partialFeeF?.paid_amount, 2500);
  assert.equal(partialFeeF?.pending_amount, 2500);
  assert.equal(partialFeeF?.status, 'Partial');
  assert.equal(partialFeeF?.payment_history.length, 1);

  const installmentTwo = await submitBankPayment(parentFToken, feeF, studentF.id, `E2E-SLIP-F-TWO-${RUN_ID}`, 2500);
  assert.equal(installmentTwo.status, 201, JSON.stringify(installmentTwo.data));
  const installmentTwoId = installmentTwo.data.payment.id;
  const installmentTwoApproval = await api('POST', `/admin/payments/${encodeURIComponent(installmentTwoId)}/approve`, {}, adminToken);
  assert.equal(installmentTwoApproval.status, 200, JSON.stringify(installmentTwoApproval.data));
  const installmentTwoReceipt = installmentTwoApproval.data.payment.receipt_no;
  assert.notEqual(installmentTwoReceipt, installmentOneReceipt);

  const fullyPaidFeeF = await FeeModel.findOne({ voucher_id: feeF }).lean();
  assert.equal(fullyPaidFeeF?.paid_amount, 5000);
  assert.equal(fullyPaidFeeF?.pending_amount, 0);
  assert.equal(fullyPaidFeeF?.status, 'Paid');
  assert.equal(fullyPaidFeeF?.payment_history.length, 2);
  assert.equal(fullyPaidFeeF?.payment_history.reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0), 5000);

  const parentFHistory = await api('GET', '/parent/payments/history', undefined, parentFToken);
  assert.equal(parentFHistory.status, 200);
  assert.equal(parentFHistory.data.length, 2);
  assert.deepEqual(new Set(parentFHistory.data.map((payment: any) => payment.receipt_no)), new Set([installmentOneReceipt, installmentTwoReceipt]));

  // Teacher role is isolated from finance and from students outside assigned classes.
  const studentG = await registerStudent('G', 'E2E Parent G', 'Other Class');
  const teacherEmail = `teacher-${RUN_ID}@e2e.invalid`;
  const teacherCreated = await api('POST', '/teachers', {
    name: 'E2E Class Teacher',
    qualification: 'B.Ed',
    subject: 'Computer Science',
    classes: ['E2E Class'],
    email: teacherEmail,
    contact_no: '03000000000',
  }, adminToken);
  assert.equal(teacherCreated.status, 201, JSON.stringify(teacherCreated.data));
  assert.ok(teacherCreated.data.temporary_password);
  const teacherLogin = await api('POST', '/auth/login', {
    email: teacherEmail,
    password: teacherCreated.data.temporary_password,
  });
  assert.equal(teacherLogin.status, 200, JSON.stringify(teacherLogin.data));
  const teacherToken = teacherLogin.data.token as string;

  const teacherCannotListFees = await api('GET', '/fees', undefined, teacherToken);
  assert.equal(teacherCannotListFees.status, 403);
  const teacherCannotListAdminPayments = await api('GET', '/admin/payments', undefined, teacherToken);
  assert.equal(teacherCannotListAdminPayments.status, 403);
  const teacherRoster = await api('GET', '/students', undefined, teacherToken);
  assert.equal(teacherRoster.status, 200);
  assert.ok(teacherRoster.data.some((student: any) => student.id === studentA.id));
  assert.ok(!teacherRoster.data.some((student: any) => student.id === studentG.id));
  const teacherReadsAssignedStudent = await api('GET', `/students/${encodeURIComponent(studentA.id)}`, undefined, teacherToken);
  assert.equal(teacherReadsAssignedStudent.status, 200);
  const teacherReadsUnassignedStudent = await api('GET', `/students/${encodeURIComponent(studentG.id)}`, undefined, teacherToken);
  assert.equal(teacherReadsUnassignedStudent.status, 403);
  const teacherReadsUnassignedAttendance = await api('GET', `/attendance/student/${encodeURIComponent(studentG.id)}`, undefined, teacherToken);
  assert.equal(teacherReadsUnassignedAttendance.status, 403);
});
