const http = require('http');
const EXPECTED_DATABASE_NAME = process.env.E2E_EXPECTED_DATABASE_NAME;
const TEST_USERS = {
  superAdmin: [process.env.E2E_SUPER_ADMIN_EMAIL, process.env.E2E_SUPER_ADMIN_PASSWORD],
  admin: [process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD],
  teacher: [process.env.E2E_TEACHER_EMAIL, process.env.E2E_TEACHER_PASSWORD],
  student: [process.env.E2E_STUDENT_EMAIL, process.env.E2E_STUDENT_PASSWORD],
  parent: [process.env.E2E_PARENT_EMAIL, process.env.E2E_PARENT_PASSWORD],
};

function getHealth() {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port: 3000, path: '/api/health' }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', () => resolve({ status: 500, data: null }));
  });
}

function queryAi(prompt, extraBody = {}, token) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ prompt, ...extraBody });
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/admin/ai/query',
        method: 'POST',
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', (err) => resolve({ status: 500, error: err.message }));
    req.write(postData);
    req.end();
  });
}

async function runTests() {
  if (process.env.E2E_ALLOW_AI_QUERIES !== 'true') {
    throw new Error('Blocked: set E2E_ALLOW_AI_QUERIES=true only for an intentional local AI test run.');
  }
  if (!EXPECTED_DATABASE_NAME || !/^e2e[_-]/i.test(EXPECTED_DATABASE_NAME)) {
    throw new Error('Blocked: E2E_EXPECTED_DATABASE_NAME must identify an isolated e2e_ or e2e- database.');
  }
  for (const [role, credentials] of Object.entries(TEST_USERS)) {
    if (!credentials[0] || !credentials[1]) {
      throw new Error(`Blocked: E2E credentials are required for the ${role} test account.`);
    }
  }
  const health = await getHealth();
  if (
    health.status !== 200 ||
    health.data?.connected !== true ||
    health.data?.database?.connected !== true ||
    health.data?.database?.isAtlas !== false ||
    health.data?.database?.databaseName !== EXPECTED_DATABASE_NAME
  ) {
    throw new Error('Blocked: AI tests require the expected isolated local MongoDB database. No AI queries were sent.');
  }

  console.log('====================================================');
  console.log('PHASE 2 — AI ASSISTANT ACCURACY & REAL DATABASE DATA');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  function loginRealUser(email, password) {
    return new Promise((resolve) => {
      const postData = JSON.stringify({ email, password });
      const req = http.request(
        {
          hostname: 'localhost',
          port: 3000,
          path: '/api/auth/login',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body)?.token || '');
            } catch {
              resolve('');
            }
          });
        }
      );
      req.on('error', () => resolve(''));
      req.write(postData);
      req.end();
    });
  }

  const superAdminToken = await loginRealUser(...TEST_USERS.superAdmin);
  const adminToken = await loginRealUser(...TEST_USERS.admin);
  const teacherToken = await loginRealUser(...TEST_USERS.teacher);
  const studentToken = await loginRealUser(...TEST_USERS.student);
  const parentToken = await loginRealUser(...TEST_USERS.parent);

  // ----------------------------------------------------
  // TEST GROUP 1: Natural Language Admissions & Date Ranges (Objectives 1, 3, 5)
  // ----------------------------------------------------
  console.log('--- TEST GROUP 1: ADMISSIONS & DATE-RANGE ACCURACY ---');

  // 1. "Show new admitted students."
  const qNewAdmissions = await queryAi('Show new admitted students.', {}, superAdminToken);
  assert(
    qNewAdmissions.status === 200 &&
      qNewAdmissions.data?.toolUsed === 'getRecentAdmissions' &&
      qNewAdmissions.data?.data?.totalCount > 0 &&
      qNewAdmissions.data?.text.includes('Admissions Registered'),
    '1. "Show new admitted students." resolves to admissions tool and returns real database records',
    `toolUsed: ${qNewAdmissions.data?.toolUsed}, totalCount: ${qNewAdmissions.data?.data?.totalCount}`
  );

  // 2. "Show recent admissions this month." (No admissions in October 2026 -> must say no records found, never silent fallback)
  const qThisMonth = await queryAi('Show recent admissions this month.', {}, superAdminToken);
  assert(
    qThisMonth.status === 200 &&
      qThisMonth.data?.toolUsed === 'getRecentAdmissions' &&
      qThisMonth.data?.data?.totalCount === 0 &&
      qThisMonth.data?.text.includes('No student admissions were registered for **This Month'),
    '2. "Show recent admissions this month." correctly reports 0 admissions and NO false recent substitution',
    `text: ${qThisMonth.data?.text?.substring(0, 100)}`
  );

  // 3. Admissions in September 2026 (6 admissions were registered in September)
  const qSept = await queryAi('Show admissions in September 2026.', {}, superAdminToken);
  assert(
    qSept.status === 200 &&
      qSept.data?.toolUsed === 'getRecentAdmissions' &&
      qSept.data?.data?.totalCount === 6 &&
      qSept.data?.text.includes('ADM-2026-6577'),
    '3. "Show admissions in September 2026." retrieves all 6 real September admissions',
    `totalCount: ${qSept.data?.data?.totalCount}`
  );

  // ----------------------------------------------------
  // TEST GROUP 2: Teacher Details & Faculty Directory (Objective 3)
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 2: TEACHER DETAILS & ASSIGNED CLASSES ---');

  // 4. General query: "Show teacher details and assigned classes." -> returns faculty directory, NOT defaulting to Class 9!
  const qTeacherGen = await queryAi('Show teacher details and assigned classes.', {}, superAdminToken);
  assert(
    qTeacherGen.status === 200 &&
      qTeacherGen.data?.toolUsed === 'getFacultyDirectoryWithClasses' &&
      qTeacherGen.data?.data?.count >= 4 &&
      qTeacherGen.data?.text.includes('Faculty Directory & Assigned Classes'),
    '4. "Show teacher details and assigned classes." returns institutional faculty directory with assigned classes',
    `toolUsed: ${qTeacherGen.data?.toolUsed}, count: ${qTeacherGen.data?.data?.count}`
  );

  // 5. Specific teacher: "Show teacher details and assigned classes for Prof. Tariq Mahmood"
  const qTariq = await queryAi('Show teacher details and assigned classes for Prof. Tariq Mahmood', {}, superAdminToken);
  assert(
    qTariq.status === 200 &&
      qTariq.data?.toolUsed === 'getTeacherRecord' &&
      qTariq.data?.data?.teacher?.name === 'Prof. Tariq Mahmood' &&
      qTariq.data?.data?.teacher?.classes.includes('Grade 9 - Matric'),
    '5. Specific teacher query retrieves real profile and assigned classes without guessing',
    `teacher: ${qTariq.data?.data?.teacher?.name}`
  );

  // ----------------------------------------------------
  // TEST GROUP 3: Complete Student Record & Disambiguation (Objectives 3, 6, 7, 8)
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 3: STUDENT RECORDS, DISAMBIGUATION & CONTEXT ---');

  // 6. Complete record of a specific student: Muhammad Hamza
  const qHamza = await queryAi('Give me the complete record of Muhammad Hamza', {}, superAdminToken);
  assert(
    qHamza.status === 200 &&
      qHamza.data?.toolUsed === 'getStudentProfile' &&
      qHamza.data?.data?.profile?.full_name === 'Muhammad Hamza' &&
      qHamza.data?.activeEntity?.name === 'Muhammad Hamza' &&
      qHamza.data?.text.includes('Official Student Dossier: Muhammad Hamza'),
    '6. "Give me the complete record of Muhammad Hamza" retrieves complete dossier and sets activeEntity',
    `student: ${qHamza.data?.data?.profile?.full_name}, activeEntity: ${qHamza.data?.activeEntity?.name}`
  );

  // 7. Context follow-up: "Give me the complete record of this student." with activeEntity in context
  const qContextRecord = await queryAi(
    'Give me the complete record of this student.',
    { activeEntity: { type: 'student', id: 'std_01', name: 'Muhammad Hamza' } },
    superAdminToken
  );
  assert(
    qContextRecord.status === 200 &&
      qContextRecord.data?.toolUsed === 'getStudentProfile' &&
      qContextRecord.data?.data?.profile?.full_name === 'Muhammad Hamza',
    '7. "Give me the complete record of this student." successfully resolves activeEntity from context',
    `name: ${qContextRecord.data?.data?.profile?.full_name}`
  );

  // 8. Without context and without name: asks user to specify, never defaults to Ahmad Khan
  const qNoContextRecord = await queryAi('Give me the complete record of this student.', {}, superAdminToken);
  assert(
    qNoContextRecord.status === 200 &&
      qNoContextRecord.data?.text.includes('Please specify which student'),
    '8. "Give me the complete record of this student." without context prompts admin to specify student (zero guessing)',
    `text: ${qNoContextRecord.data?.text}`
  );

  // 9. Disambiguation when multiple students match ("gul")
  const qDisambig = await queryAi('Show student record for gul', {}, superAdminToken);
  assert(
    qDisambig.status === 200 &&
      qDisambig.data?.disambiguationRequired === true &&
      Array.isArray(qDisambig.data?.candidates) &&
      qDisambig.data?.candidates.length >= 2,
    '9. Ambiguous name ("gul") prompts admin to select candidate with disambiguationRequired: true',
    `candidates count: ${qDisambig.data?.candidates?.length}`
  );

  // 10. Follow-up query using selected database ID (Objective 6)
  const candidateId = qDisambig.data?.candidates?.[0]?.databaseId || qDisambig.data?.candidates?.[0]?.id;
  const qFollowUpId = await queryAi(
    'Show record',
    { selectedId: candidateId },
    superAdminToken
  );
  assert(
    qFollowUpId.status === 200 &&
      (qFollowUpId.data?.data?.profile?.id === candidateId ||
        qFollowUpId.data?.data?.profile?.database_id === candidateId),
    '10. Follow-up query with selected database ID directly retrieves exact record without re-disambiguating',
    `retrieved id: ${qFollowUpId.data?.data?.profile?.id}`
  );

  // ----------------------------------------------------
  // TEST GROUP 4: Multi-Part Questions & Combined Status (Objectives 3, 4)
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 4: MULTI-PART & COMBINED STATUS ---');

  // 11. "Show student attendance and fee status." with student name
  const qAttFees = await queryAi('Show student attendance and fee status for Muhammad Hamza', {}, superAdminToken);
  assert(
    qAttFees.status === 200 &&
      qAttFees.data?.toolUsed === 'getStudentAttendanceAndFees' &&
      qAttFees.data?.data?.attendance !== undefined &&
      qAttFees.data?.data?.fees !== undefined &&
      qAttFees.data?.text.includes('Combined Status: Muhammad Hamza'),
    '11. "Show student attendance and fee status for Muhammad Hamza" combines attendance + fees',
    `toolUsed: ${qAttFees.data?.toolUsed}`
  );

  // 12. "Show parent details for this student." with active context
  const qParent = await queryAi(
    'Show parent details for this student.',
    { activeEntity: { type: 'student', id: 'std_01', name: 'Muhammad Hamza' } },
    superAdminToken
  );
  assert(
    qParent.status === 200 &&
      qParent.data?.toolUsed === 'getStudentParents' &&
      qParent.data?.data?.studentName === 'Muhammad Hamza' &&
      qParent.data?.text.includes('Parent & Guardian Record: Muhammad Hamza'),
    '12. "Show parent details for this student." retrieves linked parent details for active context student',
    `studentName: ${qParent.data?.data?.studentName}`
  );

  // 13. Missing fields rule (Objective 7): returns "Not available in database."
  const qAskhaq = await queryAi('Show Askhaq complete profile', {}, superAdminToken);
  assert(
    qAskhaq.status === 200 &&
      qAskhaq.data?.data?.profile?.full_name === 'Askhaq' &&
      qAskhaq.data?.data?.profile?.address === 'Not available in database.',
    '13. Empty address returns "Not available in database." without guessing or hardcoded town names',
    `address: ${qAskhaq.data?.data?.profile?.address}`
  );

  // 14. Multi-tool: Low attendance AND unpaid fees
  const qLowAttUnpaid = await queryAi('Show students who have attendance below 75% AND unpaid fees', {}, superAdminToken);
  assert(
    qLowAttUnpaid.status === 200 &&
      qLowAttUnpaid.data?.toolUsed === 'getStudentsWithLowAttendanceAndUnpaidFees',
    '14. Multi-tool query for Low Attendance AND Unpaid Fees executes authorized join',
    `toolUsed: ${qLowAttUnpaid.data?.toolUsed}`
  );

  // ----------------------------------------------------
  // TEST GROUP 5: Role-Based Access Enforcement (Objective 10)
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 5: ROLE-BASED ACCESS CONTROL ---');

  // 15. Super admin allowed
  const qSa = await queryAi('Give me the school overview', {}, superAdminToken);
  assert(qSa.status === 200, '15. Super Admin role granted access (HTTP 200)');

  // 16. Admin allowed
  const qAdm = await queryAi('Give me the school overview', {}, adminToken);
  assert(qAdm.status === 200, '16. Admin role granted access (HTTP 200)');

  // 17. Teacher denied
  const qTch = await queryAi('Give me the school overview', {}, teacherToken);
  assert(qTch.status === 403, '17. Teacher role blocked from Admin AI Assistant (HTTP 403)');

  // 18. Student denied
  const qStd = await queryAi('Give me the school overview', {}, studentToken);
  assert(qStd.status === 403, '18. Student role blocked from Admin AI Assistant (HTTP 403)');

  // 19. Parent denied
  const qPar = await queryAi('Give me the school overview', {}, parentToken);
  assert(qPar.status === 403, '19. Parent role blocked from Admin AI Assistant (HTTP 403)');

  // 20. Unauthenticated denied
  const qUnauth = await queryAi('Give me the school overview', {}, null);
  assert(qUnauth.status === 401, '20. Unauthenticated request rejected (HTTP 401)');

  console.log('\n====================================================');
  console.log(`PHASE 2 ACCURACY VERIFICATION: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
