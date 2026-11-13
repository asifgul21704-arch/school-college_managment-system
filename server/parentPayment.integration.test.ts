import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { router } from './routes.ts';
import { generateToken, revokeToken } from './auth.ts';
import { UserModel } from './models/User.ts';
import { ParentModel } from './models/Parent.ts';
import { StudentModel } from './models/Student.ts';
import { FeeModel } from './models/Fee.ts';
import { FeePaymentModel } from './models/FeePayment.ts';
import { NotificationModel } from './models/Notification.ts';
import { TeacherModel } from './models/Teacher.ts';
import { TeacherAssignmentModel } from './models/TeacherAssignment.ts';
import { AttendanceModel } from './models/Attendance.ts';
import { ExamModel } from './models/Exam.ts';
import { ResultModel } from './models/Result.ts';
import { ExpenseModel } from './models/Expense.ts';
import { PayrollModel } from './models/Payroll.ts';

const TEST_DATABASE_NAME = 'school_management_integration_test';
const mongoUri = process.env.MONGODB_TEST_URI || '';
let server: any;
let baseUrl = '';

function authToken(user: { id: string; email: string; role: 'parent' | 'super_admin' | 'teacher'; name: string; linked_id?: string; linked_student_ids?: string[] }) {
  return generateToken({ ...user, linked_student_ids: user.linked_student_ids || [] });
}

async function request(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, cacheControl: response.headers.get('cache-control') || '' };
}

before(async () => {
  if (!mongoUri) throw new Error('MONGODB_TEST_URI is required for the real MongoDB integration suite.');
  const parsed = new URL(mongoUri);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || databaseName !== TEST_DATABASE_NAME) {
    throw new Error(`Integration tests may only use localhost database "${TEST_DATABASE_NAME}". Refusing to connect to any other database.`);
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('A dedicated 32+ character test JWT_SECRET must be provided by CI.');
  }

  await mongoose.connect(mongoUri);
  await mongoose.connection.db!.dropDatabase();

  const app = express();
  app.use(express.json());
  app.use(router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server.close((err: Error | undefined) => err ? reject(err) : resolve()));
  }
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.db!.dropDatabase();
  }
  await mongoose.disconnect();
});

test('real MongoDB: stale parent session loses unlinked-child access and payment workflows remain isolated', async () => {
  const parent = await UserModel.create({
    record_id: 'PARENT-INTEGRATION-1',
    email: 'parent.integration@example.test',
    password_hash: 'integration-only-hash',
    name: 'Integration Parent',
    role: 'parent',
    phone: '03000000000',
    status: 'active',
    linked_id: 'STU-INTEGRATION-A',
    linked_student_ids: ['STU-INTEGRATION-A', 'STU-INTEGRATION-B'],
  });
  await UserModel.create({
    record_id: 'ADMIN-INTEGRATION-1',
    email: 'admin.integration@example.test',
    password_hash: 'integration-only-hash',
    name: 'Integration Admin',
    role: 'super_admin',
    status: 'active',
  });

  await ParentModel.create({
    user_id: parent.record_id,
    name: parent.name,
    phone: parent.phone,
    email: parent.email,
    linked_students: ['STU-INTEGRATION-A', 'STU-INTEGRATION-B'],
  });

  await StudentModel.create([
    {
      record_id: 'STU-INTEGRATION-A',
      admission_no: 'ADM-INTEGRATION-A',
      roll_no: '01',
      full_name: 'Integration Student A',
      father_name: 'Integration Parent',
      gender: 'Male',
      class_name: 'Class 5',
      section: 'A',
      parent_user_id: parent.record_id,
      academic_status: 'Active',
    },
    {
      record_id: 'STU-INTEGRATION-B',
      admission_no: 'ADM-INTEGRATION-B',
      roll_no: '02',
      full_name: 'Integration Student B',
      father_name: 'Integration Parent',
      gender: 'Female',
      class_name: 'Class 6',
      section: 'B',
      parent_user_id: parent.record_id,
      academic_status: 'Active',
    },
  ]);

  await FeeModel.create([
    {
      voucher_id: 'VCH-INTEGRATION-A',
      student_id: 'STU-INTEGRATION-A',
      student_name: 'Integration Student A',
      class_name: 'Class 5',
      fee_month: 'November',
      year: 2026,
      total_amount: 4000,
      paid_amount: 0,
      pending_amount: 4000,
      due_date: '2026-11-30',
      status: 'Unpaid',
      payment_history: [],
    },
    {
      voucher_id: 'VCH-INTEGRATION-B',
      student_id: 'STU-INTEGRATION-B',
      student_name: 'Integration Student B',
      class_name: 'Class 6',
      fee_month: 'November',
      year: 2026,
      total_amount: 3000,
      paid_amount: 0,
      pending_amount: 3000,
      due_date: '2026-11-30',
      status: 'Unpaid',
      payment_history: [],
    },
  ]);

  await FeePaymentModel.create([
    {
      fee_id: 'VCH-INTEGRATION-A',
      student_id: 'STU-INTEGRATION-A',
      payment_reference: 'PAY-INTEGRATION-OLD-A',
      receipt_no: 'REC-INTEGRATION-OLD-A',
      date: '2026-11-01',
      amount: 250,
      method: 'Bank Deposit',
      status: 'Paid',
      verification_status: 'Verified',
      parent_user_id: parent.record_id,
      student_name: 'Integration Student A',
    },
    {
      fee_id: 'VCH-INTEGRATION-B',
      student_id: 'STU-INTEGRATION-B',
      payment_reference: 'PAY-INTEGRATION-OLD-B',
      receipt_no: 'REC-INTEGRATION-OLD-B',
      date: '2026-11-02',
      amount: 300,
      method: 'Bank Deposit',
      status: 'Paid',
      verification_status: 'Verified',
      parent_user_id: parent.record_id,
      student_name: 'Integration Student B',
    },
  ]);

  // This token deliberately carries both child IDs. Authentication must reload the live user from MongoDB.
  const parentToken = authToken({
    id: parent.record_id!,
    email: parent.email,
    role: 'parent',
    name: parent.name,
    linked_id: 'STU-INTEGRATION-A',
    linked_student_ids: ['STU-INTEGRATION-A', 'STU-INTEGRATION-B'],
  });
  const adminToken = authToken({
    id: 'ADMIN-INTEGRATION-1',
    email: 'admin.integration@example.test',
    role: 'super_admin',
    name: 'Integration Admin',
  });
  const intruder = await UserModel.create({
    record_id: 'PARENT-INTEGRATION-INTRUDER',
    email: 'parent.intruder@example.test',
    password_hash: 'integration-only-hash',
    name: 'Unrelated Guardian',
    role: 'parent',
    status: 'active',
  });
  const intruderToken = authToken({
    id: intruder.record_id!,
    email: intruder.email,
    role: 'parent',
    name: intruder.name,
  });
  const intruderDiscovery = await request('/parents/find-child', intruderToken, {
    method: 'POST',
    body: {
      father_name: 'Integration Parent',
      student_name: 'Integration Student A',
      class_name: 'Class 5',
      roll_no: '01',
    },
  });
  assert.equal(intruderDiscovery.status, 404);
  assert.equal(intruderDiscovery.body.matches, undefined);

  const portalBeforeUnlink = await request('/portal/ai/query', parentToken, {
    method: 'POST',
    body: { prompt: 'Give me an overview of my children' },
  });
  assert.equal(portalBeforeUnlink.status, 200, JSON.stringify(portalBeforeUnlink.body));
  assert.match(portalBeforeUnlink.body.text, /Integration Student A/);
  assert.match(portalBeforeUnlink.body.text, /Integration Student B/);
  assert.doesNotMatch(portalBeforeUnlink.body.text, /Unlinked Student/);

  const initialHistory = await request('/parent/payments/history', parentToken);
  assert.equal(initialHistory.status, 200);
  assert.match(initialHistory.cacheControl, /no-store/i);
  assert.deepEqual(
    new Set(initialHistory.body.map((payment: any) => payment.student_id)),
    new Set(['STU-INTEGRATION-A', 'STU-INTEGRATION-B'])
  );

  const unlink = await request('/parents/unlink-child', parentToken, {
    method: 'POST',
    body: { student_id: 'STU-INTEGRATION-A' },
  });
  assert.equal(unlink.status, 200, JSON.stringify(unlink.body));

  const storedParent = await UserModel.findOne({ record_id: parent.record_id }).lean();
  const storedStudentA = await StudentModel.findOne({ record_id: 'STU-INTEGRATION-A' }).lean();
  assert.deepEqual(storedParent?.linked_student_ids, ['STU-INTEGRATION-B']);
  assert.equal(storedParent?.linked_id, 'STU-INTEGRATION-B');
  assert.equal(storedStudentA?.parent_user_id, '');

  // The same pre-unlink JWT must no longer authorize any A records or historical A payments.
  const portalAfterUnlink = await request('/portal/ai/query', parentToken, {
    method: 'POST',
    body: { prompt: 'Give me an overview of my children' },
  });
  assert.equal(portalAfterUnlink.status, 200, JSON.stringify(portalAfterUnlink.body));
  assert.doesNotMatch(portalAfterUnlink.body.text, /Integration Student A/);
  assert.match(portalAfterUnlink.body.text, /Integration Student B/);

  const historyAfterUnlink = await request('/parent/payments/history', parentToken);
  assert.equal(historyAfterUnlink.status, 200);
  assert.deepEqual(new Set(historyAfterUnlink.body.map((payment: any) => payment.student_id)), new Set(['STU-INTEGRATION-B']));
  assert.equal(historyAfterUnlink.body.some((payment: any) => payment.student_id === 'STU-INTEGRATION-A'), false);

  const blockedFeeRead = await request('/fees?student_id=STU-INTEGRATION-A', parentToken);
  assert.equal(blockedFeeRead.status, 403);
  const allowedFeeRead = await request('/fees?student_id=STU-INTEGRATION-B', parentToken);
  assert.equal(allowedFeeRead.status, 200);
  assert.deepEqual(allowedFeeRead.body.map((fee: any) => fee.student_id), ['STU-INTEGRATION-B']);

  const summary = await request('/parent/fees/summary', parentToken);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.total_outstanding, 3000);

  // Administrator counter collection writes both the embedded fee history and the standalone ledger.
  const counterPayment = await request('/fees/VCH-INTEGRATION-A/pay', adminToken, {
    method: 'PUT',
    body: { amount: 500, method: 'Cash', transaction_id: 'COUNTER-INTEGRATION-A' },
  });
  assert.equal(counterPayment.status, 200, JSON.stringify(counterPayment.body));
  assert.ok(counterPayment.body.receipt_no);
  const counterLedger = await FeePaymentModel.findOne({ transaction_id: 'COUNTER-INTEGRATION-A' }).lean();
  assert.ok(counterLedger);
  assert.equal(counterLedger?.payment_reference, counterPayment.body.receipt_no);
  let feeA = await FeeModel.findOne({ voucher_id: 'VCH-INTEGRATION-A' }).lean();
  assert.equal(feeA?.paid_amount, 500);
  assert.equal(feeA?.pending_amount, 3500);
  assert.equal(feeA?.payment_history.length, 1);

  const duplicateCounterPayment = await request('/fees/VCH-INTEGRATION-A/pay', adminToken, {
    method: 'PUT',
    body: { amount: 500, method: 'Cash', transaction_id: 'COUNTER-INTEGRATION-A' },
  });
  assert.equal(duplicateCounterPayment.status, 409);
  feeA = await FeeModel.findOne({ voucher_id: 'VCH-INTEGRATION-A' }).lean();
  assert.equal(feeA?.paid_amount, 500);
  assert.equal(feeA?.payment_history.length, 1);

  const blockedPayment = await request('/parent/payments/initiate', parentToken, {
    method: 'POST',
    body: {
      fee_id: 'VCH-INTEGRATION-A',
      student_id: 'STU-INTEGRATION-A',
      amount: 1000,
      method: 'Bank Deposit',
      deposit_slip_ref: 'SLIP-INTEGRATION-UNLINKED',
    },
  });
  assert.equal(blockedPayment.status, 403);

  // A still-linked child can submit a manual deposit, but the voucher is not credited before admin approval.
  const submitted = await request('/parent/payments/initiate', parentToken, {
    method: 'POST',
    body: {
      fee_id: 'VCH-INTEGRATION-B',
      student_id: 'STU-INTEGRATION-B',
      amount: 1000,
      method: 'Bank Deposit',
      bank_name: 'Integration Test Bank',
      deposit_date: '2026-11-13',
      deposit_slip_ref: 'SLIP-INTEGRATION-APPROVE',
    },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  assert.equal(submitted.body.payment.status, 'Pending Verification');
  assert.equal(submitted.body.payment.verification_status, 'Pending');
  let feeB = await FeeModel.findOne({ voucher_id: 'VCH-INTEGRATION-B' }).lean();
  assert.equal(feeB?.paid_amount, 0);
  assert.equal(feeB?.pending_amount, 3000);

  // Client claims of online payment must not create or settle a payment record.
  const onlineAttempt = await request('/parent/payments/initiate', parentToken, {
    method: 'POST',
    body: {
      fee_id: 'VCH-INTEGRATION-B',
      student_id: 'STU-INTEGRATION-B',
      amount: 1000,
      method: 'JazzCash',
    },
  });
  assert.equal(onlineAttempt.status, 503);
  assert.equal(await FeePaymentModel.countDocuments({ transaction_id: 'SLIP-INTEGRATION-APPROVE' }), 1);

  const approved = await request(`/admin/payments/${submitted.body.payment.id}/approve`, adminToken, { method: 'POST', body: {} });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.payment.status, 'Paid');
  assert.equal(approved.body.payment.verification_status, 'Verified');
  assert.ok(approved.body.receipt_no);
  feeB = await FeeModel.findOne({ voucher_id: 'VCH-INTEGRATION-B' }).lean();
  assert.equal(feeB?.paid_amount, 1000);
  assert.equal(feeB?.pending_amount, 2000);
  assert.equal(feeB?.status, 'Partial');
  assert.equal(feeB?.payment_history.length, 1);

  const duplicateApproval = await request(`/admin/payments/${submitted.body.payment.id}/approve`, adminToken, { method: 'POST', body: {} });
  assert.equal(duplicateApproval.status, 409);
  assert.equal(await NotificationModel.countDocuments({
    user_id: parent.record_id,
    title: 'Fee Payment Approved & Receipt Issued',
  }), 1);
  assert.equal(await NotificationModel.countDocuments({
    user_id: parent.record_id,
    title: 'Payment Submission Received',
  }), 1);
  feeB = await FeeModel.findOne({ voucher_id: 'VCH-INTEGRATION-B' }).lean();
  assert.equal(feeB?.paid_amount, 1000);
  assert.equal(feeB?.payment_history.length, 1);

  const rejectedSubmission = await request('/parent/payments/initiate', parentToken, {
    method: 'POST',
    body: {
      fee_id: 'VCH-INTEGRATION-B',
      student_id: 'STU-INTEGRATION-B',
      amount: 1000,
      method: 'Bank Deposit',
      deposit_slip_ref: 'SLIP-INTEGRATION-REJECT',
    },
  });
  assert.equal(rejectedSubmission.status, 201, JSON.stringify(rejectedSubmission.body));

  const rejected = await request(`/admin/payments/${rejectedSubmission.body.payment.id}/reject`, adminToken, {
    method: 'POST',
    body: { reason: 'Integration test rejection' },
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.payment.status, 'Rejected');
  assert.equal(rejected.body.payment.verification_status, 'Rejected');

  const duplicateRejection = await request(`/admin/payments/${rejectedSubmission.body.payment.id}/reject`, adminToken, {
    method: 'POST',
    body: { reason: 'Duplicate rejection must be blocked' },
  });
  assert.equal(duplicateRejection.status, 409);
  assert.equal(await NotificationModel.countDocuments({
    user_id: parent.record_id,
    title: 'Fee Payment Rejected',
  }), 1);
  feeB = await FeeModel.findOne({ voucher_id: 'VCH-INTEGRATION-B' }).lean();
  assert.equal(feeB?.paid_amount, 1000);
  assert.equal(feeB?.pending_amount, 2000);
  assert.equal(feeB?.payment_history.length, 1);

  // Reusing an already settled deposit slip / transaction ID must be rejected.
  const duplicateSlip = await request('/parent/payments/initiate', parentToken, {
    method: 'POST',
    body: {
      fee_id: 'VCH-INTEGRATION-B',
      student_id: 'STU-INTEGRATION-B',
      amount: 1000,
      method: 'Bank Deposit',
      deposit_slip_ref: 'SLIP-INTEGRATION-APPROVE',
    },
  });
  assert.equal(duplicateSlip.status, 409);

  // Concurrent approvals must have exactly one winner and must credit the voucher only once.
  const concurrentSubmission = await request('/parent/payments/initiate', parentToken, {
    method: 'POST',
    body: {
      fee_id: 'VCH-INTEGRATION-B',
      student_id: 'STU-INTEGRATION-B',
      amount: 1000,
      method: 'Bank Deposit',
      deposit_slip_ref: 'SLIP-INTEGRATION-CONCURRENT',
    },
  });
  assert.equal(concurrentSubmission.status, 201, JSON.stringify(concurrentSubmission.body));
  const concurrentApprovals = await Promise.all([
    request(`/admin/payments/${concurrentSubmission.body.payment.id}/approve`, adminToken, { method: 'POST', body: {} }),
    request(`/admin/payments/${concurrentSubmission.body.payment.id}/approve`, adminToken, { method: 'POST', body: {} }),
  ]);
  assert.deepEqual(concurrentApprovals.map(result => result.status).sort((a, b) => a - b), [200, 409]);
  feeB = await FeeModel.findOne({ voucher_id: 'VCH-INTEGRATION-B' }).lean();
  assert.equal(feeB?.paid_amount, 2000);
  assert.equal(feeB?.pending_amount, 1000);
  assert.equal(feeB?.payment_history.length, 2);

  const finalHistory = await request('/parent/payments/history', parentToken);
  assert.equal(finalHistory.status, 200);
  assert.equal(finalHistory.body.some((payment: any) => payment.student_id === 'STU-INTEGRATION-A'), false);
  assert.ok(finalHistory.body.some((payment: any) => payment.payment_reference === submitted.body.payment.payment_reference));
  assert.ok(finalHistory.body.some((payment: any) => payment.payment_reference === rejectedSubmission.body.payment.payment_reference));
});


test('real MongoDB: notification reads, unread counts, and read mutations stay within user scope', async () => {
  const parent = await UserModel.findOne({ email: 'parent.integration@example.test' }).lean();
  const admin = await UserModel.findOne({ email: 'admin.integration@example.test' }).lean();
  assert.ok(parent);
  assert.ok(admin);

  await NotificationModel.deleteMany({});
  const notifications = await NotificationModel.create([
    { user_id: 'STU-INTEGRATION-A', role: 'student', title: 'Unlinked child notice', message: 'Must not be visible after unlink.', read: false },
    { user_id: 'STU-INTEGRATION-B', role: 'student', title: 'Linked child notice', message: 'Visible to the linked parent.', read: false },
    { user_id: 'ADMIN-INTEGRATION-1', role: 'admin', title: 'Admin private notice', message: 'Only this administrator can see it.', read: false },
    { user_id: '', role: 'admin', title: 'Admin broadcast', message: 'Administrator-only broadcast.', read: false },
    { user_id: '', role: 'all', title: 'Shared notice', message: 'Visible to all authenticated roles.', read: false },
    { user_id: '', role: 'teacher', title: 'Teacher role notice', message: 'Role labels are not broadcasts.', read: false },
  ]);

  const parentToken = authToken({
    id: parent.record_id!,
    email: parent.email,
    role: 'parent',
    name: parent.name,
    linked_student_ids: ['STU-INTEGRATION-A', 'STU-INTEGRATION-B'],
  });
  const adminToken = authToken({
    id: admin.record_id!,
    email: admin.email,
    role: 'super_admin',
    name: admin.name,
  });

  const parentList = await request('/notifications', parentToken);
  assert.equal(parentList.status, 200);
  const parentTitles = new Set(parentList.body.map((item: any) => item.title));
  assert.equal(parentTitles.has('Linked child notice'), true);
  assert.equal(parentTitles.has('Shared notice'), true);
  assert.equal(parentTitles.has('Unlinked child notice'), false);
  assert.equal(parentTitles.has('Admin private notice'), false);
  assert.equal(parentTitles.has('Admin broadcast'), false);
  assert.equal(parentTitles.has('Teacher role notice'), false);

  const parentUnread = await request('/notifications/unread-count', parentToken);
  assert.equal(parentUnread.status, 200);
  assert.equal(parentUnread.body.unreadCount, 2);

  const deniedRead = await request(`/notifications/${notifications[0]._id}/read`, parentToken, { method: 'PUT', body: {} });
  assert.equal(deniedRead.status, 403);
  const allowedRead = await request(`/notifications/${notifications[1]._id}/read`, parentToken, { method: 'PUT', body: {} });
  assert.equal(allowedRead.status, 200);

  const markAll = await request('/notifications/mark-all-read', parentToken, { method: 'PUT', body: {} });
  assert.equal(markAll.status, 200);
  const remainingPrivate = await NotificationModel.findById(notifications[0]._id).lean();
  const adminBroadcast = await NotificationModel.findById(notifications[3]._id).lean();
  const teacherBroadcast = await NotificationModel.findById(notifications[5]._id).lean();
  const sharedNotice = await NotificationModel.findById(notifications[4]._id).lean();
  assert.equal(remainingPrivate?.read, false);
  assert.equal(adminBroadcast?.read, false);
  assert.equal(teacherBroadcast?.read, false);
  assert.equal(sharedNotice?.read, true);

  const adminList = await request('/notifications', adminToken);
  assert.equal(adminList.status, 200);
  const adminTitles = new Set(adminList.body.map((item: any) => item.title));
  assert.equal(adminTitles.has('Admin private notice'), true);
  assert.equal(adminTitles.has('Admin broadcast'), true);
  assert.equal(adminTitles.has('Shared notice'), true);
  assert.equal(adminTitles.has('Linked child notice'), false);
  assert.equal(adminTitles.has('Unlinked child notice'), false);
});


test('real MongoDB: sessions honor live role, account status, password changes, and revocation', async () => {
  const sessionUser = await UserModel.create({
    record_id: 'SESSION-INTEGRATION-1',
    email: 'session.integration@example.test',
    password_hash: 'integration-only-hash',
    name: 'Session Integration User',
    role: 'parent',
    status: 'active',
    linked_student_ids: [],
  });

  const staleParentClaims = authToken({
    id: sessionUser.record_id!,
    email: sessionUser.email,
    role: 'parent',
    name: sessionUser.name,
  });

  // Parent token claims cannot access administrator routes.
  const initiallyDenied = await request('/parents', staleParentClaims);
  assert.equal(initiallyDenied.status, 403);

  // A role change in MongoDB is reflected immediately without trusting old JWT claims.
  await UserModel.updateOne({ _id: sessionUser._id }, { $set: { role: 'admin' } });
  const promotedByLiveRecord = await request('/parents', staleParentClaims);
  assert.equal(promotedByLiveRecord.status, 200, JSON.stringify(promotedByLiveRecord.body));

  const staleAdminClaims = authToken({
    id: sessionUser.record_id!,
    email: sessionUser.email,
    role: 'super_admin',
    name: sessionUser.name,
  });
  await UserModel.updateOne({ _id: sessionUser._id }, { $set: { role: 'parent' } });
  const demotedByLiveRecord = await request('/parents', staleAdminClaims);
  assert.equal(demotedByLiveRecord.status, 403);

  await UserModel.updateOne({ _id: sessionUser._id }, { $set: { password_changed_at: new Date(Date.now() + 1000) } });
  const invalidatedByPasswordChange = await request('/parent/fees/summary', staleParentClaims);
  assert.equal(invalidatedByPasswordChange.status, 401);

  await UserModel.updateOne({ _id: sessionUser._id }, { $set: { password_changed_at: null, status: 'inactive' } });
  const inactiveToken = authToken({
    id: sessionUser.record_id!,
    email: sessionUser.email,
    role: 'parent',
    name: sessionUser.name,
  });
  const inactiveAccountDenied = await request('/parent/fees/summary', inactiveToken);
  assert.equal(inactiveAccountDenied.status, 403);

  await UserModel.updateOne({ _id: sessionUser._id }, { $set: { status: 'active' } });
  const revokedToken = authToken({
    id: sessionUser.record_id!,
    email: sessionUser.email,
    role: 'parent',
    name: sessionUser.name,
  });
  await revokeToken(revokedToken, Math.floor(Date.now() / 1000) + 3600, 'integration-test');
  const revokedSessionDenied = await request('/parent/fees/summary', revokedToken);
  assert.equal(revokedSessionDenied.status, 401);
});


test('real MongoDB: concurrent parent link and confirmation claims have one owner', async () => {
  const parentA = await UserModel.create({
    record_id: 'CLAIM-PARENT-A',
    email: 'claim.parent.a@example.test',
    password_hash: 'integration-only-hash',
    name: 'Claim Parent A',
    role: 'parent',
    status: 'active',
  });
  const parentB = await UserModel.create({
    record_id: 'CLAIM-PARENT-B',
    email: 'claim.parent.b@example.test',
    password_hash: 'integration-only-hash',
    name: 'Claim Parent B',
    role: 'parent',
    status: 'active',
  });
  const tokenA = authToken({ id: parentA.record_id!, email: parentA.email, role: 'parent', name: parentA.name });
  const tokenB = authToken({ id: parentB.record_id!, email: parentB.email, role: 'parent', name: parentB.name });

  await StudentModel.create([
    {
      record_id: 'CLAIM-STUDENT-DOB',
      admission_no: 'CLAIM-ADM-DOB',
      roll_no: 'CLAIM-01',
      full_name: 'Claim Student DOB',
      father_name: 'Shared Guardian',
      dob: '2012-04-05',
      gender: 'Male',
      class_name: 'Class 4',
      section: 'A',
      academic_status: 'Active',
    },
    {
      record_id: 'CLAIM-STUDENT-CONFIRM',
      admission_no: 'CLAIM-ADM-CONFIRM',
      roll_no: 'CLAIM-02',
      full_name: 'Claim Student Confirm',
      father_name: 'Shared Guardian',
      dob: '2013-06-07',
      gender: 'Female',
      class_name: 'Class 5',
      section: 'B',
      academic_status: 'Active',
    },
  ]);

  const dobClaims = await Promise.all([
    request('/parents/link-student', tokenA, {
      method: 'POST',
      body: { admission_no: 'CLAIM-ADM-DOB', dob: '2012-04-05' },
    }),
    request('/parents/link-student', tokenB, {
      method: 'POST',
      body: { admission_no: 'CLAIM-ADM-DOB', dob: '2012-04-05' },
    }),
  ]);
  assert.deepEqual(dobClaims.map(result => result.status).sort((a, b) => a - b), [200, 409]);

  const dobStudent = await StudentModel.findOne({ record_id: 'CLAIM-STUDENT-DOB' }).lean();
  assert.ok(['CLAIM-PARENT-A', 'CLAIM-PARENT-B'].includes(String(dobStudent?.parent_user_id)));
  const dobOwners = await UserModel.countDocuments({
    record_id: { $in: ['CLAIM-PARENT-A', 'CLAIM-PARENT-B'] },
    linked_student_ids: 'CLAIM-STUDENT-DOB',
  });
  assert.equal(dobOwners, 1);

  const confirmClaims = await Promise.all([
    request('/parents/confirm-link-child', tokenA, {
      method: 'POST',
      body: { student_id: 'CLAIM-STUDENT-CONFIRM', father_name: 'Shared Guardian' },
    }),
    request('/parents/confirm-link-child', tokenB, {
      method: 'POST',
      body: { student_id: 'CLAIM-STUDENT-CONFIRM', father_name: 'Shared Guardian' },
    }),
  ]);
  assert.deepEqual(confirmClaims.map(result => result.status).sort((a, b) => a - b), [200, 409]);

  const confirmedStudent = await StudentModel.findOne({ record_id: 'CLAIM-STUDENT-CONFIRM' }).lean();
  assert.ok(['CLAIM-PARENT-A', 'CLAIM-PARENT-B'].includes(String(confirmedStudent?.parent_user_id)));
  const confirmedOwners = await UserModel.countDocuments({
    record_id: { $in: ['CLAIM-PARENT-A', 'CLAIM-PARENT-B'] },
    linked_student_ids: 'CLAIM-STUDENT-CONFIRM',
  });
  assert.equal(confirmedOwners, 1);
});


test('real MongoDB: concurrent public parent signup cannot overwrite a child claim', async () => {
  await StudentModel.create({
    record_id: 'SIGNUP-CLAIM-STUDENT',
    admission_no: 'SIGNUP-CLAIM-ADM',
    roll_no: 'SIGNUP-01',
    full_name: 'Signup Claim Student',
    father_name: 'Signup Guardian',
    dob: '2014-08-09',
    gender: 'Male',
    class_name: 'Class 3',
    section: 'A',
    academic_status: 'Active',
  });

  const signup = (email: string, fullName: string) => request('/auth/register-parent', '', {
    method: 'POST',
    body: {
      full_name: fullName,
      email,
      password: 'IntegrationPass123!',
      confirm_password: 'IntegrationPass123!',
      child_admission_no: 'SIGNUP-CLAIM-ADM',
      child_dob: '2014-08-09',
    },
  });

  const attempts = await Promise.all([
    signup('signup.claim.a@example.test', 'Signup Parent A'),
    signup('signup.claim.b@example.test', 'Signup Parent B'),
  ]);
  assert.deepEqual(attempts.map(result => result.status).sort((a, b) => a - b), [201, 409]);

  const createdUsers = await UserModel.find({
    email: { $in: ['signup.claim.a@example.test', 'signup.claim.b@example.test'] },
  }).lean();
  assert.equal(createdUsers.length, 1);
  assert.equal(createdUsers[0].role, 'parent');
  assert.deepEqual(createdUsers[0].linked_student_ids, ['SIGNUP-CLAIM-STUDENT']);

  const claimedStudent = await StudentModel.findOne({ record_id: 'SIGNUP-CLAIM-STUDENT' }).lean();
  assert.equal(claimedStudent?.parent_user_id, createdUsers[0].record_id);
  const parentRecords = await ParentModel.countDocuments({ user_id: createdUsers[0].record_id });
  assert.equal(parentRecords, 1);
});


test('real MongoDB: concurrent duplicate deposit slip submissions return one success and one conflict', async () => {
  const parent = await UserModel.create({
    record_id: 'DUP-SLIP-PARENT',
    email: 'duplicate.slip.parent@example.test',
    password_hash: 'integration-only-hash',
    name: 'Duplicate Slip Parent',
    role: 'parent',
    status: 'active',
    linked_id: 'DUP-SLIP-STUDENT',
    linked_student_ids: ['DUP-SLIP-STUDENT'],
  });
  await StudentModel.create({
    record_id: 'DUP-SLIP-STUDENT',
    admission_no: 'DUP-SLIP-ADM',
    roll_no: 'DUP-01',
    full_name: 'Duplicate Slip Student',
    father_name: parent.name,
    gender: 'Male',
    class_name: 'Class 2',
    section: 'A',
    parent_user_id: parent.record_id,
    academic_status: 'Active',
  });
  await FeeModel.create({
    voucher_id: 'DUP-SLIP-VOUCHER',
    student_id: 'DUP-SLIP-STUDENT',
    student_name: 'Duplicate Slip Student',
    class_name: 'Class 2',
    fee_month: 'December',
    year: 2026,
    total_amount: 5000,
    paid_amount: 0,
    pending_amount: 5000,
    due_date: '2026-12-31',
    status: 'Unpaid',
    payment_history: [],
  });

  const token = authToken({
    id: parent.record_id!,
    email: parent.email,
    role: 'parent',
    name: parent.name,
    linked_student_ids: ['DUP-SLIP-STUDENT'],
  });
  const submit = () => request('/parent/payments/initiate', token, {
    method: 'POST',
    body: {
      fee_id: 'DUP-SLIP-VOUCHER',
      student_id: 'DUP-SLIP-STUDENT',
      amount: 5000,
      method: 'Bank Deposit',
      bank_name: 'Integration Test Bank',
      deposit_date: '2026-11-13',
      deposit_slip_ref: 'DUPLICATE-SLIP-CONCURRENT-1',
    },
  });

  const attempts = await Promise.all([submit(), submit()]);
  assert.deepEqual(attempts.map(result => result.status).sort((a, b) => a - b), [201, 409]);
  const ledgerEntries = await FeePaymentModel.find({
    transaction_id: 'DUPLICATE-SLIP-CONCURRENT-1',
  }).lean();
  assert.equal(ledgerEntries.length, 1);
  assert.equal(ledgerEntries[0].status, 'Pending Verification');
  assert.equal(ledgerEntries[0].verification_status, 'Pending');

  const fee = await FeeModel.findOne({ voucher_id: 'DUP-SLIP-VOUCHER' }).lean();
  assert.equal(fee?.paid_amount, 0);
  assert.equal(fee?.pending_amount, 5000);
  assert.equal(fee?.payment_history.length, 0);
});

test('real MongoDB: failed approval releases its lock and can be safely retried after voucher correction', async () => {
  const admin = await UserModel.findOne({ email: 'admin.integration@example.test' }).lean();
  const parent = await UserModel.findOne({ email: 'parent.integration@example.test' }).lean();
  assert.ok(admin);
  assert.ok(parent);

  await StudentModel.create({
    record_id: 'RECOVERY-STUDENT-1',
    admission_no: 'RECOVERY-ADM-1',
    roll_no: 'REC-01',
    full_name: 'Recovery Integration Student',
    father_name: parent.name,
    gender: 'Male',
    class_name: 'Class 7',
    section: 'A',
    parent_user_id: parent.record_id,
    academic_status: 'Active',
  });
  await FeeModel.create({
    voucher_id: 'RECOVERY-VOUCHER-1',
    student_id: 'RECOVERY-STUDENT-1',
    student_name: 'Recovery Integration Student',
    class_name: 'Class 7',
    fee_month: 'December',
    year: 2026,
    total_amount: 1000,
    paid_amount: 0,
    pending_amount: 1000,
    due_date: '2026-12-31',
    status: 'Unpaid',
    payment_history: [],
  });
  const payment = await FeePaymentModel.create({
    fee_id: 'RECOVERY-VOUCHER-1',
    student_id: 'RECOVERY-STUDENT-1',
    payment_reference: 'PAY-RECOVERY-RETRY-1',
    receipt_no: '',
    date: '2026-11-13',
    amount: 1500,
    method: 'Bank Deposit',
    status: 'Pending Verification',
    verification_status: 'Pending',
    parent_user_id: parent.record_id,
    student_name: 'Recovery Integration Student',
  });
  const adminToken = authToken({
    id: admin.record_id!,
    email: admin.email,
    role: 'super_admin',
    name: admin.name,
  });

  const rejectedForBalance = await request(`/admin/payments/${payment._id}/approve`, adminToken, {
    method: 'POST',
    body: {},
  });
  assert.equal(rejectedForBalance.status, 400);
  let storedPayment = await FeePaymentModel.findById(payment._id).lean();
  let storedFee = await FeeModel.findOne({ voucher_id: 'RECOVERY-VOUCHER-1' }).lean();
  assert.equal(storedPayment?.status, 'Pending Verification');
  assert.equal(storedPayment?.verification_status, 'Pending');
  assert.equal(storedFee?.paid_amount, 0);
  assert.equal(storedFee?.pending_amount, 1000);
  assert.equal(storedFee?.payment_history.length, 0);

  // A legitimate voucher correction makes the pending payment approvable.
  await FeeModel.updateOne(
    { voucher_id: 'RECOVERY-VOUCHER-1' },
    { $set: { total_amount: 2000, pending_amount: 2000 } }
  );
  const retried = await request(`/admin/payments/${payment._id}/approve`, adminToken, {
    method: 'POST',
    body: {},
  });
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.payment.status, 'Paid');
  assert.ok(retried.body.receipt_no);

  storedPayment = await FeePaymentModel.findById(payment._id).lean();
  storedFee = await FeeModel.findOne({ voucher_id: 'RECOVERY-VOUCHER-1' }).lean();
  assert.equal(storedPayment?.status, 'Paid');
  assert.equal(storedPayment?.verification_status, 'Verified');
  assert.equal(storedPayment?.receipt_no, retried.body.receipt_no);
  assert.equal(storedFee?.paid_amount, 1500);
  assert.equal(storedFee?.pending_amount, 500);
  assert.equal(storedFee?.payment_history.length, 1);

  const duplicateRetry = await request(`/admin/payments/${payment._id}/approve`, adminToken, {
    method: 'POST',
    body: {},
  });
  assert.equal(duplicateRetry.status, 409);
  storedFee = await FeeModel.findOne({ voucher_id: 'RECOVERY-VOUCHER-1' }).lean();
  assert.equal(storedFee?.paid_amount, 1500);
  assert.equal(storedFee?.payment_history.length, 1);
});


test('real MongoDB: teacher dashboards and attendance are scoped to exact assigned class sections', async () => {
  const teacherUser = await UserModel.create({
    record_id: 'TEACHER-SCOPE-USER-1',
    email: 'teacher.scope@example.test',
    password_hash: 'integration-only-hash',
    name: 'Scoped Teacher',
    role: 'teacher',
    status: 'active',
    linked_id: 'TEACHER-SCOPE-PROFILE-1',
  });
  await TeacherModel.create({
    record_id: 'TEACHER-SCOPE-PROFILE-1',
    user_id: teacherUser.record_id,
    name: 'Scoped Teacher',
    subject: 'Mathematics',
    classes: ['ScopeClass-Regression-5'],
    status: 'Active',
    email: teacherUser.email,
  });
  await TeacherAssignmentModel.create({
    record_id: 'TEACHER-SCOPE-ASG-1',
    teacher_id: 'TEACHER-SCOPE-PROFILE-1',
    teacher_name: 'Scoped Teacher',
    class_name: 'ScopeClass-Regression-5',
    section: 'A',
    subject: 'Mathematics',
    academic_session: '2026-2027',
  });

  await StudentModel.create([
    {
      record_id: 'TEACHER-SCOPE-STUDENT-A',
      admission_no: 'TEACHER-SCOPE-ADM-A',
      roll_no: 'SCOPE-A',
      full_name: 'Assigned Section Student',
      father_name: 'Scope Guardian',
      gender: 'Male',
      class_name: 'ScopeClass-Regression-5',
      section: 'A',
      academic_status: 'Active',
    },
    {
      record_id: 'TEACHER-SCOPE-STUDENT-B',
      admission_no: 'TEACHER-SCOPE-ADM-B',
      roll_no: 'SCOPE-B',
      full_name: 'Unassigned Section Student',
      father_name: 'Scope Guardian',
      gender: 'Female',
      class_name: 'ScopeClass-Regression-5',
      section: 'B',
      academic_status: 'Active',
    },
    {
      record_id: 'TEACHER-SCOPE-STUDENT-10',
      admission_no: 'TEACHER-SCOPE-ADM-10',
      roll_no: 'SCOPE-10',
      full_name: 'Different Class Student',
      father_name: 'Scope Guardian',
      gender: 'Male',
      class_name: 'ScopeClass-Regression-10',
      section: 'A',
      academic_status: 'Active',
    },
  ]);

  const today = new Date().toISOString().split('T')[0];
  await AttendanceModel.create([
    {
      record_id: 'TEACHER-SCOPE-ATT-A',
      student_id: 'TEACHER-SCOPE-STUDENT-A',
      student_name: 'Assigned Section Student',
      class_name: 'ScopeClass-Regression-5',
      section: 'A',
      date: today,
      status: 'Present',
      marked_by: 'Integration Fixture',
    },
    {
      record_id: 'TEACHER-SCOPE-ATT-B',
      student_id: 'TEACHER-SCOPE-STUDENT-B',
      student_name: 'Unassigned Section Student',
      class_name: 'ScopeClass-Regression-5',
      section: 'B',
      date: today,
      status: 'Absent',
      marked_by: 'Integration Fixture',
    },
    {
      record_id: 'TEACHER-SCOPE-ATT-10',
      student_id: 'TEACHER-SCOPE-STUDENT-10',
      student_name: 'Different Class Student',
      class_name: 'ScopeClass-Regression-10',
      section: 'A',
      date: today,
      status: 'Absent',
      marked_by: 'Integration Fixture',
    },
  ]);

  const teacherToken = authToken({
    id: teacherUser.record_id!,
    email: teacherUser.email,
    role: 'teacher',
    name: teacherUser.name,
    linked_id: 'TEACHER-SCOPE-PROFILE-1',
  });

  const teacherAiOverview = await request('/teacher/ai/query', teacherToken, {
    method: 'POST',
    body: { prompt: 'How many students are enrolled?' },
  });
  assert.equal(teacherAiOverview.status, 200, JSON.stringify(teacherAiOverview.body));
  assert.match(teacherAiOverview.body.text, /Total Students Across Your Classes:\*\* \*\*1\*\*/);
  assert.doesNotMatch(teacherAiOverview.body.text, /Unassigned Section Student|Different Class Student/);

  const assignedStudentAiAction = await request('/teacher/ai/query', teacherToken, {
    method: 'POST',
    body: { prompt: 'Mark Absent for Assigned Section Student' },
  });
  assert.equal(assignedStudentAiAction.status, 200, JSON.stringify(assignedStudentAiAction.body));
  assert.equal(assignedStudentAiAction.body.requiresConfirmation, true);
  assert.equal(assignedStudentAiAction.body.pendingAction.payload.student_id, 'TEACHER-SCOPE-STUDENT-A');

  const unassignedStudentAiAction = await request('/teacher/ai/query', teacherToken, {
    method: 'POST',
    body: { prompt: 'Mark Absent for Unassigned Section Student' },
  });
  assert.equal(unassignedStudentAiAction.status, 200, JSON.stringify(unassignedStudentAiAction.body));
  assert.notEqual(unassignedStudentAiAction.body.requiresConfirmation, true);
  assert.doesNotMatch(unassignedStudentAiAction.body.text, /Unassigned Section Student/);

  const teacherAiLowAttendance = await request('/teacher/ai/query', teacherToken, {
    method: 'POST',
    body: { prompt: 'Show attendance today' },
  });
  assert.equal(teacherAiLowAttendance.status, 200, JSON.stringify(teacherAiLowAttendance.body));
  assert.match(teacherAiLowAttendance.body.text, /100%/);
  assert.doesNotMatch(teacherAiLowAttendance.body.text, /Unassigned Section Student|Different Class Student/);

  const unconfirmedAiAttendance = await request('/teacher/ai/execute-action', teacherToken, {
    method: 'POST',
    body: {
      actionType: 'MARK_ATTENDANCE',
      confirmed: false,
      payload: { student_id: 'TEACHER-SCOPE-STUDENT-A', section: 'A', date: today, status: 'Absent' },
    },
  });
  assert.equal(unconfirmedAiAttendance.status, 400);
  assert.equal(
    (await AttendanceModel.findOne({ student_id: 'TEACHER-SCOPE-STUDENT-A', date: today }).lean())?.status,
    'Present'
  );

  const wrongSectionAiAttendance = await request('/teacher/ai/execute-action', teacherToken, {
    method: 'POST',
    body: {
      actionType: 'MARK_ATTENDANCE',
      confirmed: true,
      payload: { student_id: 'TEACHER-SCOPE-STUDENT-A', section: 'B', date: today, status: 'Absent' },
    },
  });
  assert.equal(wrongSectionAiAttendance.status, 403);

  const confirmedAiAttendance = await request('/teacher/ai/execute-action', teacherToken, {
    method: 'POST',
    body: {
      actionType: 'MARK_ATTENDANCE',
      confirmed: true,
      payload: { student_id: 'TEACHER-SCOPE-STUDENT-A', section: 'A', date: today, status: 'Present' },
    },
  });
  assert.equal(confirmedAiAttendance.status, 200, JSON.stringify(confirmedAiAttendance.body));
  assert.equal(
    (await AttendanceModel.findOne({ student_id: 'TEACHER-SCOPE-STUDENT-A', date: today }).lean())?.status,
    'Present'
  );

  const wrongSectionAiMarks = await request('/teacher/ai/execute-action', teacherToken, {
    method: 'POST',
    body: {
      actionType: 'RECORD_MARKS',
      confirmed: true,
      payload: {
        student_id: 'TEACHER-SCOPE-STUDENT-B',
        exam_id: 'AI-SCOPE-TEST-EXAM',
        subject_name: 'Mathematics',
        total_marks: 100,
        obtained_marks: 80,
      },
    },
  });
  assert.equal(wrongSectionAiMarks.status, 403);
  assert.equal(await ResultModel.countDocuments({ exam_id: 'AI-SCOPE-TEST-EXAM' }), 0);

  const wrongSubjectAiMarks = await request('/teacher/ai/execute-action', teacherToken, {
    method: 'POST',
    body: {
      actionType: 'RECORD_MARKS',
      confirmed: true,
      payload: {
        student_id: 'TEACHER-SCOPE-STUDENT-A',
        exam_id: 'AI-SCOPE-TEST-EXAM',
        subject_name: 'Science',
        total_marks: 100,
        obtained_marks: 80,
      },
    },
  });
  assert.equal(wrongSubjectAiMarks.status, 403);
  assert.equal(await ResultModel.countDocuments({ exam_id: 'AI-SCOPE-TEST-EXAM' }), 0);

  const confirmedAiMarks = await request('/teacher/ai/execute-action', teacherToken, {
    method: 'POST',
    body: {
      actionType: 'RECORD_MARKS',
      confirmed: true,
      payload: {
        student_id: 'TEACHER-SCOPE-STUDENT-A',
        exam_id: 'AI-SCOPE-TEST-EXAM',
        exam_title: 'AI Scope Test',
        subject_name: 'Mathematics',
        total_marks: 100,
        obtained_marks: 80,
      },
    },
  });
  assert.equal(confirmedAiMarks.status, 200, JSON.stringify(confirmedAiMarks.body));
  assert.equal(await ResultModel.countDocuments({
    exam_id: 'AI-SCOPE-TEST-EXAM',
    student_id: 'TEACHER-SCOPE-STUDENT-A',
  }), 1);

  const stats = await request('/dashboard/stats', teacherToken);
  assert.equal(stats.status, 200, JSON.stringify(stats.body));
  assert.equal(stats.body.totalStudents, 1);
  assert.equal(stats.body.totalTeachers, 0);
  assert.equal(stats.body.totalParents, 0);
  assert.equal(stats.body.totalClasses, 1);
  assert.equal(stats.body.totalSections, 1);
  assert.equal(stats.body.todayMarked, 1);
  assert.equal(stats.body.presentToday, 1);
  assert.equal(stats.body.absentToday, 0);
  assert.equal(stats.body.totalPendingFee, 0);
  assert.deepEqual(stats.body.recentFees, []);

  const teacherDashboard = await request('/teacher/dashboard', teacherToken);
  assert.equal(teacherDashboard.status, 200, JSON.stringify(teacherDashboard.body));
  assert.equal(teacherDashboard.body.totalStudents, 1);
  assert.deepEqual(
    teacherDashboard.body.recentActivity.attendance.map((entry: any) => entry.student_id),
    ['TEACHER-SCOPE-STUDENT-A']
  );

  const studentList = await request('/students', teacherToken);
  assert.equal(studentList.status, 200);
  assert.deepEqual(studentList.body.map((student: any) => student.id), ['TEACHER-SCOPE-STUDENT-A']);

  const attendanceList = await request('/attendance', teacherToken);
  assert.equal(attendanceList.status, 200);
  assert.deepEqual(
    attendanceList.body.map((entry: any) => entry.student_id).sort(),
    ['TEACHER-SCOPE-STUDENT-A']
  );

  const deniedAttendanceWrite = await request('/teacher/attendance', teacherToken, {
    method: 'POST',
    body: {
      date: today,
      class_name: 'ScopeClass-Regression-5',
      section: 'B',
      records: [{ student_id: 'TEACHER-SCOPE-STUDENT-B', status: 'Present' }],
    },
  });
  assert.equal(deniedAttendanceWrite.status, 403);
  const unassignedAttendance = await AttendanceModel.findOne({ student_id: 'TEACHER-SCOPE-STUDENT-B', date: today }).lean();
  assert.equal(unassignedAttendance?.status, 'Absent');

  const allowedAttendanceWrite = await request('/teacher/attendance', teacherToken, {
    method: 'POST',
    body: {
      date: today,
      class_name: 'ScopeClass-Regression-5',
      section: 'A',
      records: [{ student_id: 'TEACHER-SCOPE-STUDENT-A', status: 'Late' }],
    },
  });
  assert.equal(allowedAttendanceWrite.status, 200, JSON.stringify(allowedAttendanceWrite.body));
  const updatedAttendance = await AttendanceModel.findOne({ student_id: 'TEACHER-SCOPE-STUDENT-A', date: today }).lean();
  assert.equal(updatedAttendance?.status, 'Late');

  const deniedGenericBatchAttendance = await request('/attendance/batch', teacherToken, {
    method: 'POST',
    body: {
      date: today,
      records: [{
        student_id: 'TEACHER-SCOPE-STUDENT-B',
        class_name: 'ScopeClass-Regression-5',
        section: 'B',
        status: 'Present',
      }],
    },
  });
  assert.equal(deniedGenericBatchAttendance.status, 403);
  const unchangedGenericBatchAttendance = await AttendanceModel.findOne({
    student_id: 'TEACHER-SCOPE-STUDENT-B',
    date: today,
  }).lean();
  assert.equal(unchangedGenericBatchAttendance?.status, 'Absent');

  const deniedAdmissionsList = await request('/admissions', teacherToken);
  assert.equal(deniedAdmissionsList.status, 403);
  const deniedAdmissionStatusChange = await request('/admissions/ADMISSION-DOES-NOT-MATTER/status', teacherToken, {
    method: 'PUT',
    body: { status: 'Approved' },
  });
  assert.equal(deniedAdmissionStatusChange.status, 403);

  const exam = await ExamModel.create({
    title: 'Teacher Scope Regression Exam',
    term: 'Term 1',
    academic_year: '2026-2027',
    start_date: today,
    end_date: today,
    classes: ['ScopeClass-Regression-5'],
    status: 'Ongoing',
  });
  const examId = exam._id.toString();

  const wrongSectionMarks = await request('/results', teacherToken, {
    method: 'POST',
    body: {
      exam_id: examId,
      student_id: 'TEACHER-SCOPE-STUDENT-B',
      subjects: [{ subject_name: 'Mathematics', total_marks: 100, obtained_marks: 85 }],
    },
  });
  assert.equal(wrongSectionMarks.status, 403);
  assert.equal(await ResultModel.countDocuments({ exam_id: examId, student_id: 'TEACHER-SCOPE-STUDENT-B' }), 0);

  const wrongSubjectMarks = await request('/results', teacherToken, {
    method: 'POST',
    body: {
      exam_id: examId,
      student_id: 'TEACHER-SCOPE-STUDENT-A',
      subjects: [{ subject_name: 'Science', total_marks: 100, obtained_marks: 85 }],
    },
  });
  assert.equal(wrongSubjectMarks.status, 403);
  assert.equal(await ResultModel.countDocuments({ exam_id: examId, student_id: 'TEACHER-SCOPE-STUDENT-A' }), 0);

  const allowedMarks = await request('/results', teacherToken, {
    method: 'POST',
    body: {
      exam_id: examId,
      student_id: 'TEACHER-SCOPE-STUDENT-A',
      subjects: [{ subject_name: 'Mathematics', total_marks: 100, obtained_marks: 85 }],
    },
  });
  assert.equal(allowedMarks.status, 201, JSON.stringify(allowedMarks.body));
  assert.equal(allowedMarks.body.subjects[0].subject_name, 'Mathematics');

  const unassignedSectionResult = await ResultModel.create({
    record_id: 'TEACHER-SCOPE-RESULT-B',
    exam_id: examId,
    exam_title: 'Teacher Scope Regression Exam',
    student_id: 'TEACHER-SCOPE-STUDENT-B',
    student_name: 'Unassigned Section Student',
    class_name: 'ScopeClass-Regression-5',
    section: 'B',
    subjects: [{ subject_name: 'Mathematics', total_marks: 100, obtained_marks: 80, grade: 'A' }],
    total_marks: 100,
    obtained_marks: 80,
    percentage: 80,
    overall_grade: 'A',
    published: true,
  });

  const deniedDelete = await request('/results/TEACHER-SCOPE-RESULT-B', teacherToken, { method: 'DELETE' });
  assert.equal(deniedDelete.status, 403);
  const deniedPublish = await request('/results/TEACHER-SCOPE-RESULT-B/publish', teacherToken, {
    method: 'PATCH',
    body: { published: false },
  });
  assert.equal(deniedPublish.status, 403);
  const protectedResult = await ResultModel.findById(unassignedSectionResult._id).lean();
  assert.ok(protectedResult);
  assert.equal(protectedResult?.published, true);

  const deniedFeeCreation = await request('/fees', teacherToken, {
    method: 'POST',
    body: { student_id: 'TEACHER-SCOPE-STUDENT-A', fee_month: 'December', year: 2026, tuition_fee: 1000 },
  });
  assert.equal(deniedFeeCreation.status, 403);

  const deniedAdminAi = await request('/admin/ai/query', teacherToken, {
    method: 'POST',
    body: { prompt: 'Show all school fee records' },
  });
  assert.equal(deniedAdminAi.status, 403);
  const deniedAssignmentManagement = await request('/admin/teacher-assignments', teacherToken);
  assert.equal(deniedAssignmentManagement.status, 403);
  const deniedTeacherCreation = await request('/teachers', teacherToken, {
    method: 'POST',
    body: { name: 'Unauthorized Teacher', qualification: 'MSc', subject: 'Physics' },
  });
  assert.equal(deniedTeacherCreation.status, 403);

  const admin = await UserModel.findOne({ email: 'admin.integration@example.test' }).lean();
  assert.ok(admin);
  const adminToken = authToken({
    id: admin.record_id!,
    email: admin.email,
    role: 'super_admin',
    name: admin.name,
  });

  const createdStudent = await request('/students', adminToken, {
    method: 'POST',
    body: {
      admission_no: 'ADMIN-WORKFLOW-ADM-1',
      roll_no: 'ADMIN-WORKFLOW-01',
      full_name: 'Admin Workflow Student',
      father_name: 'Admin Workflow Guardian',
      gender: 'Female',
      class_name: 'Admin Workflow Class',
      section: 'A',
      academic_status: 'Active',
    },
  });
  assert.equal(createdStudent.status, 201, JSON.stringify(createdStudent.body));
  assert.equal(createdStudent.body.admission_no, 'ADMIN-WORKFLOW-ADM-1');
  assert.ok(await StudentModel.findOne({ admission_no: 'ADMIN-WORKFLOW-ADM-1' }));

  const createdTeacher = await request('/teachers', adminToken, {
    method: 'POST',
    body: {
      name: 'Admin Workflow Teacher',
      qualification: 'MSc Mathematics',
      subject: 'Mathematics',
      classes: ['Admin Workflow Class'],
      contact_no: '03000000001',
    },
  });
  assert.equal(createdTeacher.status, 201, JSON.stringify(createdTeacher.body));
  assert.equal(createdTeacher.body.teacher.name, 'Admin Workflow Teacher');
  assert.ok(await TeacherModel.findOne({ record_id: createdTeacher.body.teacher.id }));

  const issuedVoucher = await request('/fees', adminToken, {
    method: 'POST',
    body: {
      student_id: createdStudent.body.id,
      fee_month: 'December',
      year: 2026,
      tuition_fee: 2500,
      due_date: '2026-12-31',
    },
  });
  assert.equal(issuedVoucher.status, 201, JSON.stringify(issuedVoucher.body));
  assert.equal(issuedVoucher.body.total_amount, 2500);
  assert.equal(issuedVoucher.body.pending_amount, 2500);
});


test('real MongoDB: finance reports, expense CRUD, and idempotent payroll payments are enforced', async () => {
  const admin = await UserModel.create({
    record_id: 'FINANCE-INTEGRATION-ADMIN',
    email: 'finance.admin@example.test',
    password_hash: 'integration-only-hash',
    name: 'Finance Integration Admin',
    role: 'super_admin',
    status: 'active',
  });
  const teacher = await UserModel.create({
    record_id: 'FINANCE-INTEGRATION-TEACHER-USER',
    email: 'finance.teacher@example.test',
    password_hash: 'integration-only-hash',
    name: 'Finance Integration Teacher',
    role: 'teacher',
    status: 'active',
  });
  const staff = await TeacherModel.create({
    record_id: 'FINANCE-INTEGRATION-STAFF',
    name: 'Finance Integration Teacher',
    subject: 'Mathematics',
    status: 'Active',
    contact_no: '03000000009',
  });
  const adminToken = authToken({ id: admin.record_id!, email: admin.email, role: 'super_admin', name: admin.name });
  const teacherToken = authToken({ id: teacher.record_id!, email: teacher.email, role: 'teacher', name: teacher.name });

  const teacherFinanceDenied = await request('/finance/expenses', teacherToken);
  assert.equal(teacherFinanceDenied.status, 403);

  const invalidExpense = await request('/finance/expenses', adminToken, {
    method: 'POST',
    body: { title: 'Invalid date', category: 'Supplies', amount: 100, expense_date: '2026-02-30', payment_method: 'Cash' },
  });
  assert.equal(invalidExpense.status, 400);
  const createdExpense = await request('/finance/expenses', adminToken, {
    method: 'POST',
    body: { title: 'Integration Supplies', category: 'Supplies', amount: 1250.25, expense_date: '2026-11-13', payment_method: 'Cash' },
  });
  assert.equal(createdExpense.status, 201, JSON.stringify(createdExpense.body));
  assert.equal(createdExpense.body.amount, 1250.25);
  const updatedExpense = await request(`/finance/expenses/${encodeURIComponent(createdExpense.body.id)}`, adminToken, {
    method: 'PUT',
    body: { amount: 1750.75 },
  });
  assert.equal(updatedExpense.status, 200);
  assert.equal(updatedExpense.body.amount, 1750.75);
  assert.equal((await request('/finance/expenses?from=2026-02-30', adminToken)).status, 400);
  assert.equal((await request('/finance/expenses?from=2026-11-30&to=2026-11-01', adminToken)).status, 400);
  const listedExpenses = await request('/finance/expenses?from=2026-11-01&to=2026-11-30', adminToken);
  assert.equal(listedExpenses.status, 200);
  assert.ok(listedExpenses.body.some((row: any) => row.id === createdExpense.body.id));
  const deletedExpense = await request(`/finance/expenses/${encodeURIComponent(createdExpense.body.id)}`, adminToken, { method: 'DELETE' });
  assert.equal(deletedExpense.status, 200);
  assert.equal(await ExpenseModel.countDocuments({ record_id: createdExpense.body.id }), 0);

  const invalidYear = await request('/finance/payroll?year=20xx', adminToken);
  const invalidMonth = await request('/finance/payroll?month=13', adminToken);
  const invalidStatus = await request('/finance/payroll?status=Everything', adminToken);
  assert.equal(invalidYear.status, 400);
  assert.equal(invalidMonth.status, 400);
  assert.equal(invalidStatus.status, 400);

  const payroll = await request('/finance/payroll', adminToken, {
    method: 'POST',
    body: {
      staff_id: staff.record_id,
      staff_name: 'Untrusted Name',
      designation: 'Untrusted Designation',
      salary_month: 11,
      salary_year: 2026,
      basic_salary: 50000,
      allowances: 5000,
      deductions: 5000,
    },
  });
  assert.equal(payroll.status, 201, JSON.stringify(payroll.body));
  assert.equal(payroll.body.staff_name, 'Finance Integration Teacher');
  assert.equal(payroll.body.designation, 'Mathematics');
  assert.equal(payroll.body.net_salary, 50000);
  const payrollId = payroll.body.id as string;

  const missingKey = await request(`/finance/payroll/${encodeURIComponent(payrollId)}/payment`, adminToken, {
    method: 'POST',
    body: { amount: 20000, payment_date: '2026-11-13', payment_method: 'Bank Transfer' },
  });
  assert.equal(missingKey.status, 400);

  const paymentPayload = {
    amount: 20000,
    payment_date: '2026-11-13',
    payment_method: 'Bank Transfer',
    idempotency_key: 'finance-integration-payment-1',
  };
  const firstPayment = await request(`/finance/payroll/${encodeURIComponent(payrollId)}/payment`, adminToken, { method: 'POST', body: paymentPayload });
  assert.equal(firstPayment.status, 200, JSON.stringify(firstPayment.body));
  assert.equal(firstPayment.body.paid_amount, 20000);
  const duplicatePayment = await request(`/finance/payroll/${encodeURIComponent(payrollId)}/payment`, adminToken, { method: 'POST', body: paymentPayload });
  assert.equal(duplicatePayment.status, 409);
  const afterDuplicate = await PayrollModel.findOne({ record_id: payrollId }).lean();
  assert.equal(afterDuplicate?.paid_amount, 20000);
  assert.equal(afterDuplicate?.payment_history.length, 1);

  const finalPayment = await request(`/finance/payroll/${encodeURIComponent(payrollId)}/payment`, adminToken, {
    method: 'POST',
    body: { amount: 30000, payment_date: '2026-11-13', payment_method: 'Bank Transfer', idempotency_key: 'finance-integration-payment-2' },
  });
  assert.equal(finalPayment.status, 200);
  assert.equal(finalPayment.body.paid_amount, 50000);
  assert.equal(finalPayment.body.status, 'Paid');
  const replayAfterFullPayment = await request(`/finance/payroll/${encodeURIComponent(payrollId)}/payment`, adminToken, {
    method: 'POST',
    body: paymentPayload,
  });
  assert.equal(replayAfterFullPayment.status, 409);

  const concurrentPayroll = await request('/finance/payroll', adminToken, {
    method: 'POST',
    body: {
      staff_id: staff.record_id,
      staff_name: staff.name,
      designation: staff.subject,
      salary_month: 12,
      salary_year: 2026,
      basic_salary: 10000,
      allowances: 0,
      deductions: 0,
    },
  });
  assert.equal(concurrentPayroll.status, 201);
  const concurrentId = concurrentPayroll.body.id as string;
  const concurrentPayments = await Promise.all([
    request(`/finance/payroll/${encodeURIComponent(concurrentId)}/payment`, adminToken, {
      method: 'POST',
      body: { amount: 6000, payment_date: '2026-12-13', payment_method: 'Cash', idempotency_key: 'finance-concurrent-payment-a' },
    }),
    request(`/finance/payroll/${encodeURIComponent(concurrentId)}/payment`, adminToken, {
      method: 'POST',
      body: { amount: 6000, payment_date: '2026-12-13', payment_method: 'Cash', idempotency_key: 'finance-concurrent-payment-b' },
    }),
  ]);
  assert.equal(concurrentPayments.filter(result => result.status === 200).length, 1);
  assert.ok(concurrentPayments.every(result => [200, 400, 409].includes(result.status)));
  const concurrentStored = await PayrollModel.findOne({ record_id: concurrentId }).lean();
  assert.equal(concurrentStored?.paid_amount, 6000);
  assert.equal(concurrentStored?.payment_history.length, 1);
});
