import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { router } from './routes.ts';
import { generateToken } from './auth.ts';
import { UserModel } from './models/User.ts';
import { ParentModel } from './models/Parent.ts';
import { StudentModel } from './models/Student.ts';
import { FeeModel } from './models/Fee.ts';
import { FeePaymentModel } from './models/FeePayment.ts';

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
  feeB = await FeeModel.findOne({ voucher_id: 'VCH-INTEGRATION-B' }).lean();
  assert.equal(feeB?.paid_amount, 1000);
  assert.equal(feeB?.pending_amount, 2000);
  assert.equal(feeB?.payment_history.length, 1);

  const finalHistory = await request('/parent/payments/history', parentToken);
  assert.equal(finalHistory.status, 200);
  assert.equal(finalHistory.body.some((payment: any) => payment.student_id === 'STU-INTEGRATION-A'), false);
  assert.ok(finalHistory.body.some((payment: any) => payment.payment_reference === submitted.body.payment.payment_reference));
  assert.ok(finalHistory.body.some((payment: any) => payment.payment_reference === rejectedSubmission.body.payment.payment_reference));
});
