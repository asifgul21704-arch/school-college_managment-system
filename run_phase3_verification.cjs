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
  console.log('PHASE 3 — AUTHENTICATION & OBJECT-LEVEL AUTHORIZATION VERIFICATION');
  console.log('====================================================\n');

  // Test Tokens
  const superAdminToken = makeToken({ id: 'usr_super', email: 'admin@shawanschool.edu.pk', role: 'super_admin', name: 'Principal' });
  const adminToken = makeToken({ id: 'usr_admin', email: 'office@shawanschool.edu.pk', role: 'admin', name: 'Admin Officer' });
  
  // Teacher: Prof. Tariq Mahmood (assigned to Grade 9, Grade 10, 1st Year F.Sc, 2nd Year F.Sc)
  const teacherToken = makeToken({ id: 'usr_teacher_tariq', email: 'tariq.physics@shawanschool.edu.pk', role: 'teacher', name: 'Prof. Tariq Mahmood', linked_id: 'tch_01' });
  
  // Student A: Muhammad Hamza (id: std_01, class: Grade 10 - Matric)
  const studentAToken = makeToken({ id: 'usr_student_hamza', email: 'hamza@shawanschool.edu.pk', role: 'student', name: 'Muhammad Hamza', linked_id: 'std_01' });

  // Student B: Bilal Khan (id: std_05, class: Grade 7 - Middle)
  const studentBToken = makeToken({ id: 'usr_student_bilal', email: 'bilal@shawanschool.edu.pk', role: 'student', name: 'Bilal Khan', linked_id: 'std_05' });

  // Parent A: linked to std_01 (Muhammad Hamza) and std_1790704405564 (Usman Ghani)
  const parentAToken = makeToken({ 
    id: 'usr_parent_1', 
    email: 'parent@shawanschool.edu.pk', 
    role: 'parent', 
    name: 'Parent Tariq', 
    linked_id: 'std_01', 
    linked_student_ids: ['std_01', 'std_1790704405564'] 
  });

  // ----------------------------------------------------
  // SECTION 1: PHASE 2 REGRESSION TESTS
  // ----------------------------------------------------
  console.log('--- SECTION 1: PHASE 2 REGRESSION TESTS ---');
  
  // 1. Admin AI -> 200
  const qAdminAi = await postRequest('/api/admin/ai/query', { prompt: 'Give me the school overview' }, adminToken);
  console.log('1. Admin AI Query:              HTTP', qAdminAi.status, '(Expected: 200) ->', qAdminAi.status === 200 ? 'PASS' : 'FAIL');

  // 2. Super Admin AI -> 200
  const qSuperAdminAi = await postRequest('/api/admin/ai/query', { prompt: 'Give me the school overview' }, superAdminToken);
  console.log('2. Super Admin AI Query:        HTTP', qSuperAdminAi.status, '(Expected: 200) ->', qSuperAdminAi.status === 200 ? 'PASS' : 'FAIL');

  // 3. Student AI -> 403 where admin-only
  const qStudentAi = await postRequest('/api/admin/ai/query', { prompt: 'Give me the school overview' }, studentAToken);
  console.log('3. Student Admin AI Query:      HTTP', qStudentAi.status, '(Expected: 403) ->', qStudentAi.status === 403 ? 'PASS' : 'FAIL');

  // 4. Teacher AI -> 403 where admin-only
  const qTeacherAi = await postRequest('/api/admin/ai/query', { prompt: 'Give me the school overview' }, teacherToken);
  console.log('4. Teacher Admin AI Query:      HTTP', qTeacherAi.status, '(Expected: 403) ->', qTeacherAi.status === 403 ? 'PASS' : 'FAIL');

  // 5. Parent AI -> 403 where admin-only
  const qParentAi = await postRequest('/api/admin/ai/query', { prompt: 'Give me the school overview' }, parentAToken);
  console.log('5. Parent Admin AI Query:       HTTP', qParentAi.status, '(Expected: 403) ->', qParentAi.status === 403 ? 'PASS' : 'FAIL');

  // 6. Non-existent student -> zero hallucination
  const qNonExistent = await postRequest('/api/admin/ai/query', { prompt: 'Show me the complete record of student NonExistent Person.' }, superAdminToken);
  const zeroHallucination = qNonExistent.data?.text && qNonExistent.data.text.includes('No matching record was found');
  console.log('6. Zero Hallucination:          HTTP', qNonExistent.status, '| Output matches "No matching record":', zeroHallucination ? 'PASS' : 'FAIL');

  // 7. Multiple student names -> disambiguation
  const qDisambig = await postRequest('/api/admin/ai/query', { prompt: 'Show student record for Khan' }, superAdminToken);
  const disambigPass = qDisambig.data?.disambiguationRequired === true && qDisambig.data?.candidates?.length >= 2;
  console.log('7. Multi-Record Disambiguation: HTTP', qDisambig.status, '| Required:', qDisambig.data?.disambiguationRequired, '| Candidates:', qDisambig.data?.candidates?.length, '->', disambigPass ? 'PASS' : 'FAIL');

  // 8. Sensitive action without confirmation -> blocked
  const unconfirmedExec = await postRequest('/api/admin/ai/execute-action', {
    actionType: 'SEND_SMS_ABSENT',
    payload: { date: '2026-10-03' },
    confirmed: false
  }, superAdminToken);
  console.log('8. Sensitive Action Gate:       HTTP', unconfirmedExec.status, '(Expected: 400) ->', unconfirmedExec.status === 400 ? 'PASS' : 'FAIL');

  // 9. Audit log created
  const dbStatus = await getRequest('/api/mongodb/status');
  console.log('10. MongoDB Atlas Connected:    HTTP', dbStatus.status, '| Connected:', dbStatus.data?.connected, '->', dbStatus.data?.connected ? 'PASS' : 'FAIL');
  console.log('\n');

  // ----------------------------------------------------
  // SECTION 2: OBJECT-LEVEL AUTHORIZATION TESTS
  // ----------------------------------------------------
  console.log('--- SECTION 2: OBJECT-LEVEL AUTHORIZATION TESTS ---');

  // 11. Student A accessing own record (std_01) -> 200
  const resOwnStudent = await getRequest('/api/students/std_01', studentAToken);
  console.log('11. Student A accessing OWN record (std_01):        HTTP', resOwnStudent.status, '(Expected: 200) ->', resOwnStudent.status === 200 ? 'PASS' : 'FAIL');

  // 12. Student A attempting Student B record (std_05) -> 403 Forbidden
  const resOtherStudent = await getRequest('/api/students/std_05', studentAToken);
  console.log('12. Student A attempting Student B record (std_05):  HTTP', resOtherStudent.status, '(Expected: 403) ->', resOtherStudent.status === 403 ? 'PASS' : 'FAIL');

  // 13. Student A attempting other student attendance -> 403 Forbidden
  const resOtherStudentAtt = await getRequest('/api/attendance/student/std_05', studentAToken);
  console.log('13. Student A attempting Student B attendance:       HTTP', resOtherStudentAtt.status, '(Expected: 403) ->', resOtherStudentAtt.status === 403 ? 'PASS' : 'FAIL');

  // 14. Student A attempting other student fees -> 403 Forbidden
  const resOtherStudentFees = await getRequest('/api/fees?student_id=std_05', studentAToken);
  console.log('14. Student A attempting Student B fees:             HTTP', resOtherStudentFees.status, '(Expected: 403) ->', resOtherStudentFees.status === 403 ? 'PASS' : 'FAIL');

  // 15. Parent A accessing linked child record (std_01) -> 200
  const resLinkedChild = await getRequest('/api/students/std_01', parentAToken);
  console.log('15. Parent A accessing LINKED child (std_01):        HTTP', resLinkedChild.status, '(Expected: 200) ->', resLinkedChild.status === 200 ? 'PASS' : 'FAIL');

  // 16. Parent A attempting UNRELATED child record (std_05) -> 403 Forbidden
  const resUnlinkedChild = await getRequest('/api/students/std_05', parentAToken);
  console.log('16. Parent A attempting UNRELATED child (std_05):    HTTP', resUnlinkedChild.status, '(Expected: 403) ->', resUnlinkedChild.status === 403 ? 'PASS' : 'FAIL');

  // 17. Parent A attempting unrelated child attendance -> 403 Forbidden
  const resUnlinkedChildAtt = await getRequest('/api/attendance/student/std_05', parentAToken);
  console.log('17. Parent A attempting UNRELATED child attendance:  HTTP', resUnlinkedChildAtt.status, '(Expected: 403) ->', resUnlinkedChildAtt.status === 403 ? 'PASS' : 'FAIL');

  // 18. Teacher (assigned to Grade 9, 10, F.Sc) accessing student in Grade 10 (std_01) -> 200
  const resTeacherAssigned = await getRequest('/api/students/std_01', teacherToken);
  console.log('18. Teacher accessing student in ASSIGNED class:     HTTP', resTeacherAssigned.status, '(Expected: 200) ->', resTeacherAssigned.status === 200 ? 'PASS' : 'FAIL');
  console.log('    Teacher fee access check (fees stripped):', Array.isArray(resTeacherAssigned.data?.fees) && resTeacherAssigned.data.fees.length === 0 ? 'PASS (fees hidden)' : 'FAIL');

  // 19. Teacher attempting student in UNASSIGNED class (Grade 7 - Middle, std_05) -> 403 Forbidden
  const resTeacherUnassigned = await getRequest('/api/students/std_05', teacherToken);
  console.log('19. Teacher accessing student in UNASSIGNED class:   HTTP', resTeacherUnassigned.status, '(Expected: 403) ->', resTeacherUnassigned.status === 403 ? 'PASS' : 'FAIL');

  // 20. Teacher attempting direct access to fees endpoint -> 403 Forbidden
  const resTeacherFees = await getRequest('/api/fees', teacherToken);
  console.log('20. Teacher attempting direct access to fees API:    HTTP', resTeacherFees.status, '(Expected: 403) ->', resTeacherFees.status === 403 ? 'PASS' : 'FAIL');

  // 21. Teacher attempting to mark attendance for unassigned class (Grade 7 - Middle) -> 403 Forbidden
  const resTeacherMarkUnassigned = await postRequest('/api/attendance/batch', {
    date: '2026-10-03',
    records: [{
      student_id: 'std_05',
      student_name: 'Bilal Khan',
      class_name: 'Grade 7 - Middle',
      section: 'A',
      status: 'Present'
    }]
  }, teacherToken);
  console.log('21. Teacher marking attendance for UNASSIGNED class: HTTP', resTeacherMarkUnassigned.status, '(Expected: 403) ->', resTeacherMarkUnassigned.status === 403 ? 'PASS' : 'FAIL');

  // 22. Teacher attempting to record exam result for unassigned class (std_05) -> 403 Forbidden
  const resTeacherResultUnassigned = await postRequest('/api/results', {
    exam_id: 'ex_mid',
    exam_title: 'Mid Term 2026',
    student_id: 'std_05',
    subjects: [{ subject_name: 'Science', total_marks: 100, obtained_marks: 85 }]
  }, teacherToken);
  console.log('22. Teacher recording result for UNASSIGNED student: HTTP', resTeacherResultUnassigned.status, '(Expected: 403) ->', resTeacherResultUnassigned.status === 403 ? 'PASS' : 'FAIL');

  // 23. Student querying Student/Parent Portal AI -> 200 (only own data)
  const resStudentPortalAi = await postRequest('/api/portal/ai/query', { prompt: 'Show my academic summary' }, studentAToken);
  console.log('23. Student querying Portal AI:                      HTTP', resStudentPortalAi.status, '(Expected: 200) ->', resStudentPortalAi.status === 200 ? 'PASS' : 'FAIL');
  console.log('    Snippet:', resStudentPortalAi.data?.text?.substring(0, 100) + '...');

  // 24. Student attempting unauthorized administrative query via Portal AI -> 403
  const resStudentPortalAiBlocked = await postRequest('/api/portal/ai/query', { prompt: 'Show teacher salary and admin password' }, studentAToken);
  console.log('24. Student attempting admin data via Portal AI:     HTTP', resStudentPortalAiBlocked.status, '(Expected: 403) ->', resStudentPortalAiBlocked.status === 403 ? 'PASS' : 'FAIL');

  // 25. Parent querying Portal AI -> 200 (only linked children)
  const resParentPortalAi = await postRequest('/api/portal/ai/query', { prompt: 'Show my children status' }, parentAToken);
  console.log('25. Parent querying Portal AI:                       HTTP', resParentPortalAi.status, '(Expected: 200) ->', resParentPortalAi.status === 200 ? 'PASS' : 'FAIL');
  console.log('    Snippet:', resParentPortalAi.data?.text?.substring(0, 100) + '...');
  console.log('\n====================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('Phase 3 verification error:', err);
  process.exit(1);
});
