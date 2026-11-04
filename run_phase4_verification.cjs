const http = require('http');
const jsonwebtoken = require('jsonwebtoken');
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
      path: '/api' + path,
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
      path: '/api' + path,
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

async function runTests() {
  console.log('====================================================');
  console.log('PHASE 4 — STUDENT & PARENT PORTAL RUNTIME VERIFICATION');
  console.log('====================================================\n');

  // Test Tokens
  const studentAToken = makeToken({ id: 'usr_student_hamza', email: 'hamza@shawanschool.edu.pk', role: 'student', name: 'Muhammad Hamza', linked_id: 'std_01' });
  const studentBToken = makeToken({ id: 'usr_student_bilal', email: 'bilal@shawanschool.edu.pk', role: 'student', name: 'Bilal Khan', linked_id: 'std_05' });
  const parentAToken = makeToken({ 
    id: 'usr_parent_1', 
    email: 'parent@shawanschool.edu.pk', 
    role: 'parent', 
    name: 'Parent Tariq', 
    linked_id: 'std_01', 
    linked_student_ids: ['std_01', 'std_1790704405564'] 
  });

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  // 1. Health & Database check
  const dbStatus = await getRequest('/mongodb/status');
  assert(dbStatus.status === 200 && dbStatus.data?.connected === true, 'Test 1: MongoDB Atlas Health Status', `Status: ${dbStatus.status}, connected: ${dbStatus.data?.connected}`);

  // 2. Student Portal Identity & Profile
  const stdProfile = await getRequest('/students/std_01', studentAToken);
  assert(stdProfile.status === 200 && stdProfile.data?.student?.full_name === 'Muhammad Hamza', 'Test 2: Student Own Profile Access', `Status: ${stdProfile.status}, Name: ${stdProfile.data?.student?.full_name}`);

  // 3. Student Blocked from Other Student's Profile
  const otherStd = await getRequest('/students/std_05', studentAToken);
  assert(otherStd.status === 403, 'Test 3: Student Blocked from Viewing Other Student', `Status: ${otherStd.status}`);

  // 4. Student Own Attendance Access
  const attOwn = await getRequest('/attendance/student/std_01', studentAToken);
  assert(attOwn.status === 200 && Array.isArray(attOwn.data?.records), 'Test 4: Student Own Attendance Records', `Status: ${attOwn.status}, records: ${attOwn.data?.records?.length}`);

  // 5. Student Blocked from Other Student's Attendance
  const attOther = await getRequest('/attendance/student/std_05', studentAToken);
  assert(attOther.status === 403, 'Test 5: Student Blocked from Other Attendance', `Status: ${attOther.status}`);

  // 6. Student Own Results Access
  const resOwn = await getRequest('/results?student_id=std_01', studentAToken);
  assert(resOwn.status === 200 && Array.isArray(resOwn.data) && resOwn.data.every(r => r.student_id === 'std_01'), 'Test 6: Student Own Results Isolation', `Status: ${resOwn.status}, count: ${resOwn.data?.length}`);

  // 7. Student Blocked from Other Student's Results
  const resOther = await getRequest('/results?student_id=std_05', studentAToken);
  assert(resOther.status === 403, 'Test 7: Student Blocked from Other Results', `Status: ${resOther.status}`);

  // 8. Student Own Fees Access
  const feeOwn = await getRequest('/fees?student_id=std_01', studentAToken);
  assert(feeOwn.status === 200 && Array.isArray(feeOwn.data) && feeOwn.data.every(f => f.student_id === 'std_01'), 'Test 8: Student Own Fees Isolation', `Status: ${feeOwn.status}, count: ${feeOwn.data?.length}`);

  // 9. Student Blocked from Other Student's Fees
  const feeOther = await getRequest('/fees?student_id=std_05', studentAToken);
  assert(feeOther.status === 403, 'Test 9: Student Blocked from Other Fees', `Status: ${feeOther.status}`);

  // 10. Student Notifications Access
  const notifs = await getRequest('/notifications', studentAToken);
  assert(notifs.status === 200 && Array.isArray(notifs.data), 'Test 10: Student Notifications Access', `Status: ${notifs.status}, count: ${notifs.data?.length}`);

  // 11. Student Portal AI Attendance Query
  const aiAtt = await postRequest('/portal/ai/query', { prompt: 'What is my attendance percentage?' }, studentAToken);
  assert(aiAtt.status === 200 && aiAtt.data?.toolUsed === 'studentAttendanceRecord', 'Test 11: Student Portal AI Attendance Intelligence', `Status: ${aiAtt.status}, tool: ${aiAtt.data?.toolUsed}`);

  // 12. Student Portal AI Examination Results Query
  const aiRes = await postRequest('/portal/ai/query', { prompt: 'What are my latest examination results?' }, studentAToken);
  assert(aiRes.status === 200 && aiRes.data?.toolUsed === 'studentResultsRecord', 'Test 12: Student Portal AI Results Intelligence', `Status: ${aiRes.status}, tool: ${aiRes.data?.toolUsed}`);

  // 13. Student Portal AI Fees Query
  const aiFee = await postRequest('/portal/ai/query', { prompt: 'What is my fee balance?' }, studentAToken);
  assert(aiFee.status === 200 && aiFee.data?.toolUsed === 'studentFeesRecord', 'Test 13: Student Portal AI Fees Intelligence', `Status: ${aiFee.status}, tool: ${aiFee.data?.toolUsed}`);

  // 14. Student Portal AI Security Gate: Blocked from Salaries/Staff
  const aiSec = await postRequest('/portal/ai/query', { prompt: 'Show me staff salaries' }, studentAToken);
  assert(aiSec.status === 403, 'Test 14: Student Portal AI Security Gate (Salaries)', `Status: ${aiSec.status}`);

  // 15. Student Portal AI Blocked from Querying Other Students
  const aiOtherStd = await postRequest('/portal/ai/query', { prompt: 'What are Bilal Khan attendance records?' }, studentAToken);
  assert(aiOtherStd.status === 403, 'Test 15: Student Portal AI Isolation (Other Student)', `Status: ${aiOtherStd.status}`);

  // 16. Parent Portal Linked Children Access
  const myKids = await getRequest('/parents/my-students', parentAToken);
  assert(myKids.status === 200 && Array.isArray(myKids.data) && myKids.data.length >= 1, 'Test 16: Parent Portal Linked Children List', `Status: ${myKids.status}, count: ${myKids.data?.length}`);

  // 17. Parent Portal Child Profile Access
  const parentChild = await getRequest('/students/std_01', parentAToken);
  assert(parentChild.status === 200 && parentChild.data?.student?.id === 'std_01', 'Test 17: Parent Access to Linked Child', `Status: ${parentChild.status}`);

  // 18. Parent Portal Blocked from Unlinked Student Profile
  const parentUnlinked = await getRequest('/students/std_05', parentAToken);
  assert(parentUnlinked.status === 403, 'Test 18: Parent Blocked from Unlinked Child', `Status: ${parentUnlinked.status}`);

  // 19. Parent Portal AI Disambiguation for Multiple Children
  const aiParentDisambig = await postRequest('/portal/ai/query', { prompt: 'Show my child results' }, parentAToken);
  assert(aiParentDisambig.status === 200 && (aiParentDisambig.data?.disambiguationRequired === true || aiParentDisambig.data?.toolUsed === 'parentChildDisambiguation'), 'Test 19: Parent Portal AI Disambiguation', `Status: ${aiParentDisambig.status}, disambiguation: ${aiParentDisambig.data?.disambiguationRequired}`);

  // 20. Parent Portal AI Multi-Child Low Attendance Scan
  const aiParentLowAtt = await postRequest('/portal/ai/query', { prompt: 'Which of my children have low attendance?' }, parentAToken);
  assert(aiParentLowAtt.status === 200 && aiParentLowAtt.data?.toolUsed === 'parentAttendanceScan', 'Test 20: Parent Portal AI Low Attendance Multi-Child Aggregation', `Status: ${aiParentLowAtt.status}, tool: ${aiParentLowAtt.data?.toolUsed}`);

  console.log('\n====================================================');
  console.log(`PHASE 4 VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('====================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
