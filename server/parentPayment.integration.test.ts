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

const TEST_DATABASE_NAME = 'school_management_integration_test';
const mongoUri = process.env.MONGODB_TEST_URI || '';
let server: any;
let baseUrl = '';

function authToken(user: { id: string; email: string; role: 'parent' | 'super_admin'; name: string; linked_id?: string; linked_student_ids?: string[] }) {
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
  return { status: response.status, body };
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

  const initialHistory = await request('/parent/payments/history', parentToken);
  assert.equal(initialHistory.status, 200);
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
