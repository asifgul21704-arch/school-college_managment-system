const http = require('http');
const jsonwebtoken = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'shawan-school-and-college-secure-jwt-secret-2026-paharpur';

function makeToken(payload) {
  return jsonwebtoken.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function postRequest(path, data, token) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(data);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 500, error: err.message }));
    req.write(postData);
    req.end();
  });
}

function getRequest(path, token) {
  return new Promise((resolve) => {
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.get({
      hostname: 'localhost',
      port: 3000,
      path,
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', err => resolve({ status: 500, error: err.message }));
  });
}

async function main() {
  console.log('====================================================');
  console.log('PHASE 2 - RUNTIME VERIFICATION EXECUTION');
  console.log('====================================================\n');

  // Tokens for all 5 roles
  const superAdminToken = makeToken({ id: 'u_super_admin', email: 'admin@shawanschool.edu.pk', role: 'super_admin', name: 'Principal' });
  const adminToken = makeToken({ id: 'u_admin', email: 'office@shawanschool.edu.pk', role: 'admin', name: 'Admin Officer' });
  const teacherToken = makeToken({ id: 'u_teacher', email: 'teacher@shawanschool.edu.pk', role: 'teacher', name: 'Teacher' });
  const studentToken = makeToken({ id: 'u_student', email: 'student@shawanschool.edu.pk', role: 'student', name: 'Student' });
  const parentToken = makeToken({ id: 'u_parent', email: 'parent@shawanschool.edu.pk', role: 'parent', name: 'Parent' });

  // ----------------------------------------------------
  // TEST 4: MongoDB Status Endpoint
  // ----------------------------------------------------
  console.log('--- TEST 4: DATABASE STATUS ---');
  const dbStatus = await getRequest('/api/mongodb/status');
  console.log('HTTP Status:', dbStatus.status);
  console.log('Connected:', dbStatus.data?.connected);
  console.log('Database Name:', dbStatus.data?.databaseName);
  console.log('Collections Count:', dbStatus.data?.collectionsCount);
  console.log('Host (safe):', dbStatus.data?.host);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 5: ADMIN AUTHORIZATION
  // ----------------------------------------------------
  console.log('--- TEST 5: ADMIN AUTHORIZATION ---');
  const testPayload = { prompt: 'Give me the school overview' };

  const resUnauth = await postRequest('/api/admin/ai/query', testPayload, null);
  console.log('A. Unauthenticated request: HTTP', resUnauth.status, '(Expected: 401)');

  const resStudent = await postRequest('/api/admin/ai/query', testPayload, studentToken);
  console.log('B. Student token request:    HTTP', resStudent.status, '(Expected: 403)');

  const resTeacher = await postRequest('/api/admin/ai/query', testPayload, teacherToken);
  console.log('C. Teacher token request:    HTTP', resTeacher.status, '(Expected: 403)');

  const resParent = await postRequest('/api/admin/ai/query', testPayload, parentToken);
  console.log('D. Parent token request:     HTTP', resParent.status, '(Expected: 403)');

  const resAdmin = await postRequest('/api/admin/ai/query', testPayload, adminToken);
  console.log('E. Admin token request:      HTTP', resAdmin.status, '(Expected: 200)');

  const resSuperAdmin = await postRequest('/api/admin/ai/query', testPayload, superAdminToken);
  console.log('F. Super Admin token request:HTTP', resSuperAdmin.status, '(Expected: 200)');
  console.log('\n');

  // ----------------------------------------------------
  // TEST 6: REAL TEACHER QUERY
  // ----------------------------------------------------
  console.log('--- TEST 6: REAL TEACHER QUERY ---');
  const qTeacher = await postRequest('/api/admin/ai/query', { prompt: 'Give me complete information about teacher Muhammad Ali.' }, superAdminToken);
  console.log('HTTP Status:', qTeacher.status);
  console.log('Tool Used:', qTeacher.data?.toolUsed);
  console.log('Response Snippet:\n' + qTeacher.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 7: REAL STUDENT QUERY
  // ----------------------------------------------------
  console.log('--- TEST 7: REAL STUDENT QUERY ---');
  const qStudent = await postRequest('/api/admin/ai/query', { prompt: "Show Ahmad Khan's complete record." }, superAdminToken);
  console.log('HTTP Status:', qStudent.status);
  console.log('Tool Used:', qStudent.data?.toolUsed);
  console.log('Response Snippet:\n' + qStudent.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 8: MULTI-TOOL QUERY
  // ----------------------------------------------------
  console.log('--- TEST 8: MULTI-TOOL QUERY ---');
  const qMulti = await postRequest('/api/admin/ai/query', { prompt: "Show Ahmad Khan's attendance and fee status together." }, superAdminToken);
  console.log('HTTP Status:', qMulti.status);
  console.log('Tool Used:', qMulti.data?.toolUsed);
  console.log('Response Snippet:\n' + qMulti.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 9: LOW ATTENDANCE
  // ----------------------------------------------------
  console.log('--- TEST 9: LOW ATTENDANCE QUERY ---');
  const qLowAtt = await postRequest('/api/admin/ai/query', { prompt: 'Which students have attendance below 75%?' }, superAdminToken);
  console.log('HTTP Status:', qLowAtt.status);
  console.log('Tool Used:', qLowAtt.data?.toolUsed);
  console.log('Response Snippet:\n' + qLowAtt.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 10: UNPAID FEES
  // ----------------------------------------------------
  console.log('--- TEST 10: UNPAID FEES QUERY ---');
  const qUnpaid = await postRequest('/api/admin/ai/query', { prompt: 'Which students have unpaid fees?' }, superAdminToken);
  console.log('HTTP Status:', qUnpaid.status);
  console.log('Tool Used:', qUnpaid.data?.toolUsed);
  console.log('Response Snippet:\n' + qUnpaid.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 11: INTERSECTION QUERY
  // ----------------------------------------------------
  console.log('--- TEST 11: INTERSECTION QUERY ---');
  const qIntersect = await postRequest('/api/admin/ai/query', { prompt: 'Show students who have both low attendance and unpaid fees.' }, superAdminToken);
  console.log('HTTP Status:', qIntersect.status);
  console.log('Tool Used:', qIntersect.data?.toolUsed);
  console.log('Response Snippet:\n' + qIntersect.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 12: TODAY ATTENDANCE
  // ----------------------------------------------------
  console.log('--- TEST 12: TODAY ATTENDANCE QUERY ---');
  const qToday = await postRequest('/api/admin/ai/query', { prompt: "Give me a summary of today's school attendance." }, superAdminToken);
  console.log('HTTP Status:', qToday.status);
  console.log('Tool Used:', qToday.data?.toolUsed);
  console.log('Response Snippet:\n' + qToday.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 13: CLASS AGGREGATION
  // ----------------------------------------------------
  console.log('--- TEST 13: CLASS AGGREGATION QUERY ---');
  const qClass = await postRequest('/api/admin/ai/query', { prompt: 'How many students are in each class?' }, superAdminToken);
  console.log('HTTP Status:', qClass.status);
  console.log('Tool Used:', qClass.data?.toolUsed);
  console.log('Response Snippet:\n' + qClass.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 14: PARENT RESOLUTION
  // ----------------------------------------------------
  console.log('--- TEST 14: PARENT RESOLUTION QUERY ---');
  const qParent = await postRequest('/api/admin/ai/query', { prompt: "Tell me Ahmad Khan's parents and their contact information." }, superAdminToken);
  console.log('HTTP Status:', qParent.status);
  console.log('Tool Used:', qParent.data?.toolUsed);
  console.log('Response Snippet:\n' + qParent.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 15: NON-EXISTENT RECORD (ZERO HALLUCINATION)
  // ----------------------------------------------------
  console.log('--- TEST 15: NON-EXISTENT RECORD QUERY ---');
  const qNonExistent = await postRequest('/api/admin/ai/query', { prompt: 'Show me the complete record of student NonExistent Person.' }, superAdminToken);
  console.log('HTTP Status:', qNonExistent.status);
  console.log('Tool Used:', qNonExistent.data?.toolUsed);
  console.log('Response Text:\n' + qNonExistent.data?.text);
  console.log('\n');

  // ----------------------------------------------------
  // TEST 16: MULTIPLE RECORD DISAMBIGUATION
  // ----------------------------------------------------
  console.log('--- TEST 16: MULTIPLE RECORD DISAMBIGUATION ---');
  const qDisambig = await postRequest('/api/admin/ai/query', { prompt: 'Show student record for Khan' }, superAdminToken);
  console.log('HTTP Status:', qDisambig.status);
  console.log('Tool Used:', qDisambig.data?.toolUsed);
  console.log('Disambiguation Required:', qDisambig.data?.disambiguationRequired);
  console.log('Candidates Count:', qDisambig.data?.candidates?.length);
  console.log('Candidates:', qDisambig.data?.candidates?.map(c => ({ name: c.name, roll: c.roll_no, class: c.class_name })));
  console.log('\n');

  // ----------------------------------------------------
  // TEST 17: SENSITIVE ACTION CONFIRMATION
  // ----------------------------------------------------
  console.log('--- TEST 17: SENSITIVE ACTION CONFIRMATION ---');
  const qSms = await postRequest('/api/admin/ai/query', { prompt: 'Prepare an SMS alert for students who are absent today.' }, superAdminToken);
  console.log('HTTP Status:', qSms.status);
  console.log('Requires Confirmation:', qSms.data?.requiresConfirmation);
  console.log('Pending Action Type:', qSms.data?.pendingAction?.actionType);
  console.log('Pending Action Title:', qSms.data?.pendingAction?.title);
  console.log('Recipient Count:', qSms.data?.pendingAction?.recipientCount);
  console.log('Preview Text:', qSms.data?.pendingAction?.previewText);

  // Test executing WITHOUT confirmation
  const unconfirmedExec = await postRequest('/api/admin/ai/execute-action', {
    actionType: qSms.data?.pendingAction?.actionType,
    payload: qSms.data?.pendingAction?.payload,
    confirmed: false
  }, superAdminToken);
  console.log('Attempting execution with confirmed=false: HTTP', unconfirmedExec.status, '(Expected: 400)');
  console.log('\n');

  // ----------------------------------------------------
  // TEST 18: AUDIT LOG INSPECTION IN MONGODB
  // ----------------------------------------------------
  console.log('--- TEST 18: AUDIT LOG VERIFICATION IN MONGODB ---');
  await mongoose.connect(process.env.MONGODB_URI);
  const recentLogs = await mongoose.connection.collection('auditlogs')
    .find({})
    .sort({ timestamp: -1 })
    .limit(5)
    .toArray();
  console.log('Recent Audit Logs from MongoDB Atlas: (count:', recentLogs.length, ')');
  recentLogs.forEach((log, idx) => {
    console.log(`[Log ${idx + 1}] User: ${log.user_name} (${log.user_role}) | Action: ${log.action} | Target: ${log.target_type} | Time: ${log.timestamp}`);
    console.log(`         Details: ${log.details}`);
  });
  console.log('\n====================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('Execution Error:', err);
  process.exit(1);
});
