import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const API_BASE = 'http://localhost:3000/api';

async function runTest() {
  console.log('--- STARTING TEACHER AUTH & MANAGEMENT VERIFICATION ---');

  // Step 1: Teacher Self-Signup
  console.log('\n[Step 1] Testing Teacher Self-Registration...');
  const testTeacherPayload = {
    full_name: 'Prof. Asim Farooq',
    father_name: 'Farooq Ahmed',
    email: 'asim.test.teacher@shawanschool.edu.pk',
    phone: '0300-9876543',
    cnic: '12101-9988776-5',
    qualification: 'M.Sc Physics, M.Ed',
    subject: 'Physics',
    specialization: 'Applied Electronics',
    experience: '7 Years',
    password: 'TeacherTestPassword123!',
    confirm_password: 'TeacherTestPassword123!',
    bio: 'Dedicated physics educator focusing on conceptual mastery and lab demonstrations.',
  };

  const signupRes = await fetch(`${API_BASE}/auth/register-teacher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testTeacherPayload),
  });

  const signupData = await signupRes.json();
  console.log(`Signup Status: ${signupRes.status}`, signupData);
  if (signupRes.status !== 201) {
    throw new Error(`Expected 201 Created on signup, got ${signupRes.status}`);
  }

  // Step 2: Verify Unapproved Teacher Login is Blocked
  console.log('\n[Step 2] Testing Unapproved Teacher Login (Must be rejected with 403)...');
  const loginAttemptRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testTeacherPayload.email,
      password: testTeacherPayload.password,
    }),
  });

  const loginAttemptData = await loginAttemptRes.json();
  console.log(`Unapproved Login Status: ${loginAttemptRes.status}`, loginAttemptData);
  if (loginAttemptRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for pending teacher, got ${loginAttemptRes.status}`);
  }
  if (!loginAttemptData.error?.includes('pending administrator approval')) {
    throw new Error(`Expected pending approval message, got: ${loginAttemptData.error}`);
  }
  console.log('✓ Unapproved teacher login successfully blocked with friendly pending message.');

  // Step 3: Admin Login & Fetch Pending Teacher Requests
  console.log('\n[Step 3] Admin Login and Pending Requests Verification...');
  const adminLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@shawanschool.edu.pk',
      password: 'AdminPassword123!',
    }),
  });

  const adminLoginData = await adminLoginRes.json();
  const adminToken = adminLoginData.token;
  if (!adminToken) throw new Error('Admin login failed');

  const requestsRes = await fetch(`${API_BASE}/admin/teacher-requests`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const requestsData = await requestsRes.json();
  console.log(`Pending Requests Count: ${requestsData.requests?.length}`);
  const targetReq = requestsData.requests?.find((r: any) => r.email === testTeacherPayload.email);
  if (!targetReq) {
    throw new Error('Test teacher signup request not found in admin requests list');
  }
  console.log('✓ Found pending request for:', targetReq.name, targetReq.qualification);

  // Step 4: Admin Approves Teacher with Class Assignments
  console.log('\n[Step 4] Admin Approving Teacher and Assigning Classes & Duties...');
  const approveRes = await fetch(`${API_BASE}/admin/teacher-requests/${targetReq.user_id}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      classes: ['Class 9', 'Class 10', 'Class 11 (1st Year)'],
      subject: 'Physics',
      employment_status: 'Active',
      is_class_teacher: true,
      class_teacher_for: { class_name: 'Class 11 (1st Year)', section: 'A' },
      assignments: [
        { class_name: 'Class 9', section: 'A', subject: 'Physics' },
        { class_name: 'Class 10', section: 'A', subject: 'Physics' },
        { class_name: 'Class 11 (1st Year)', section: 'A', subject: 'Physics', is_class_teacher: true },
      ],
    }),
  });

  const approveData = await approveRes.json();
  console.log(`Approval Status: ${approveRes.status}`, approveData);
  if (approveRes.status !== 200 || !approveData.success) {
    throw new Error('Admin approval failed');
  }
  console.log('✓ Teacher approved and activated successfully.');

  // Step 5: Approved Teacher Signs In
  console.log('\n[Step 5] Approved Teacher Signs In...');
  const teacherLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testTeacherPayload.email,
      password: testTeacherPayload.password,
    }),
  });

  const teacherLoginData = await teacherLoginRes.json();
  console.log(`Teacher Login Status: ${teacherLoginRes.status}`, {
    role: teacherLoginData.user?.role,
    name: teacherLoginData.user?.name,
  });
  if (teacherLoginRes.status !== 200 || !teacherLoginData.token) {
    throw new Error('Approved teacher login failed');
  }
  const teacherToken = teacherLoginData.token;

  // Step 6: Teacher Dashboard & Portal APIs
  console.log('\n[Step 6] Verifying Teacher Dashboard & Portal API Responses...');
  const dashRes = await fetch(`${API_BASE}/teacher/dashboard`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  const dashData = await dashRes.json();
  console.log('Teacher Dashboard Data:', {
    assignedClasses: dashData.assignedClasses,
    totalClasses: dashData.totalClasses,
    totalStudents: dashData.totalStudents,
    isClassTeacher: dashData.isClassTeacher,
  });
  if (!dashData.assignedClasses?.includes('Class 11 (1st Year)')) {
    throw new Error('Assigned classes missing Class 11');
  }
  if (!dashData.isClassTeacher) {
    throw new Error('Expected isClassTeacher to be true');
  }
  console.log('✓ Teacher dashboard reflects live assignments and Class Teacher incharge status.');

  // Step 7: Admin Assigns Academic Task & Teacher Completes It
  console.log('\n[Step 7] Testing Task & Responsibility Assignment...');
  const createTaskRes = await fetch(`${API_BASE}/admin/teacher-tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      title: 'Prepare Class 11 Physics Lab Apparatus',
      description: 'Check screw gauge, vernier caliper, and spectrometer setups for practicals.',
      teacher_id: dashData.teacher?.id,
      class_name: 'Class 11 (1st Year)',
      section: 'A',
      priority: 'High',
      due_date: '2026-11-20',
    }),
  });
  const createTaskData = await createTaskRes.json();
  console.log(`Task Created: ${createTaskRes.status}`, createTaskData.task?.title);

  // Teacher views assigned tasks
  const getTasksRes = await fetch(`${API_BASE}/teacher/tasks`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  const getTasksData = await getTasksRes.json();
  console.log(`Teacher Received Tasks: ${getTasksData.tasks?.length}`);
  const targetTask = getTasksData.tasks?.find((t: any) => t.task_id === createTaskData.task?.task_id);
  if (!targetTask) throw new Error('Assigned task not found in teacher tasks list');

  // Teacher marks task completed
  const updateTaskRes = await fetch(`${API_BASE}/teacher/tasks/${targetTask.task_id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      status: 'Completed',
      completion_notes: 'All 8 lab stations verified and ready for student sessions.',
    }),
  });
  const updateTaskData = await updateTaskRes.json();
  console.log('Task Progress Updated:', updateTaskData.task?.status);
  if (updateTaskData.task?.status !== 'Completed') {
    throw new Error('Failed to complete task');
  }
  console.log('✓ Task management workflow verified successfully.');

  // Step 8: Teacher Homework Assignment
  console.log('\n[Step 8] Testing Homework Assignment...');
  const createHwRes = await fetch(`${API_BASE}/teacher/homework`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      title: 'Chapter 2 Vectors & Equilibrium Numericals 1 to 5',
      description: 'Solve problems on graph paper with full vector diagrams.',
      class_name: 'Class 11 (1st Year)',
      section: 'A',
      subject: 'Physics',
      due_date: '2026-11-18',
      total_marks: 15,
      instructions: 'Submit homework notebook during morning 1st period.',
    }),
  });
  const createHwData = await createHwRes.json();
  console.log(`Homework Created: ${createHwRes.status}`, createHwData.homework?.title);

  const getHwRes = await fetch(`${API_BASE}/teacher/homework`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  const getHwData = await getHwRes.json();
  console.log(`Teacher Homework Count: ${getHwData.homework?.length}`);
  if (getHwData.homework?.length === 0) throw new Error('Posted homework not returned');

  // Public/Student Homework Endpoint
  const pubHwRes = await fetch(`${API_BASE}/homework?class_name=Class%2011%20(1st%20Year)&section=A`);
  const pubHwData = await pubHwRes.json();
  console.log(`Public Homework Query Count: ${pubHwData.homework?.length}`);
  if (pubHwData.homework?.length === 0) throw new Error('Public homework not returned for class');
  console.log('✓ Homework assignment & student inquiry workflow verified.');

  // Step 9: Cleanup Synthetic Test Records
  console.log('\n[Step 9] Cleaning up synthetic test teacher records...');
  // Delete homework
  if (createHwData.homework?.id) {
    await fetch(`${API_BASE}/teacher/homework/${createHwData.homework.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
  }
  // Delete task
  if (targetTask?.task_id) {
    await fetch(`${API_BASE}/admin/teacher-tasks/${targetTask.task_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  }
  // Permanently delete test teacher and user
  await fetch(`${API_BASE}/teachers/${dashData.teacher.id}?permanent=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log('✓ Synthetic test records cleaned up completely.');

  console.log('\n======================================================');
  console.log('ALL TEACHER AUTHENTICATION & MANAGEMENT TESTS PASSED!');
  console.log('======================================================');
}

runTest().catch(err => {
  console.error('TEST RUNNER FAILED:', err);
  process.exit(1);
});
