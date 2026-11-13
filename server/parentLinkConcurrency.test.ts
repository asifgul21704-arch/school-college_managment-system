import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStudentParentClaimFilter } from './parentAccess.ts';
import { isClassAssignedToTeacher, normalizeClassAccessLabel } from './classAccess.ts';
import { isTeacherSubjectAssigned, isTeacherAssignedToClassSection } from './teacherHomeworkAccess.ts';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
const envConfig = readFileSync(new URL('./config/env.ts', import.meta.url), 'utf8');
const authConfig = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

test('parent claim filter permits only unclaimed or same-owner student records', () => {
  assert.deepEqual(buildStudentParentClaimFilter('student-mongo-id', 'parent-record-id', 'parent-mongo-id'), {
    _id: 'student-mongo-id',
    parent_user_id: { $in: [null, '', 'parent-record-id', 'parent-mongo-id'] },
  });
  assert.deepEqual(buildStudentParentClaimFilter('student-mongo-id', 'parent-record-id', 'parent-record-id'), {
    _id: 'student-mongo-id',
    parent_user_id: { $in: [null, '', 'parent-record-id'] },
  });
  assert.deepEqual(buildStudentParentClaimFilter('', '', ''), { _id: null });
});

test('both parent linking endpoints use one atomic conditional ownership update', () => {
  const helperStart = routes.indexOf('async function claimStudentForParent');
  const helperEnd = routes.indexOf("// Parent link student endpoint", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = routes.slice(helperStart, helperEnd);
  assert.match(helper, /StudentModel\.findOneAndUpdate\(/);
  assert.match(helper, /buildStudentParentClaimFilter\(studentDoc\._id, canonicalUserId, mongoUserId\)/);
  assert.match(helper, /\$set: \{ parent_user_id: canonicalUserId \}/);

  const firstStart = routes.indexOf("router.post('/parents/link-student'");
  const secondStart = routes.indexOf("router.post('/parents/confirm-link-child'");
  const unlinkStart = routes.indexOf("router.post('/parents/unlink-child'");
  assert.ok(firstStart >= 0 && secondStart > firstStart && unlinkStart > secondStart);
  const firstFlow = routes.slice(firstStart, secondStart);
  const secondFlow = routes.slice(secondStart, unlinkStart);
  assert.match(firstFlow, /claimStudentForParent\(studentDoc, canonicalUserId, userDoc\._id\.toString\(\)\)/);
  assert.match(secondFlow, /claimStudentForParent\(studentDoc, canonicalUserId, userDoc\._id\.toString\(\)\)/);
  assert.match(firstFlow, /\$addToSet: \{ linked_student_ids: canonicalStudentId \}/);
  assert.match(secondFlow, /\$addToSet: \{ linked_student_ids: canonicalStudentId \}/);
  assert.doesNotMatch(firstFlow, /studentDoc\.save\(\)/);
  assert.doesNotMatch(secondFlow, /studentDoc\.save\(\)/);

  const unlinkEnd = routes.indexOf('// Parent directory & profile CRUD', unlinkStart);
  const unlinkFlow = routes.slice(unlinkStart, unlinkEnd);
  assert.match(unlinkFlow, /StudentModel\.updateOne\([\s\S]*parent_user_id: \{ \$in:/);
  assert.doesNotMatch(unlinkFlow, /studentDoc\.save\(\)/);
});

test('parent payment history is limited to currently linked children', () => {
  const start = routes.indexOf("router.get('/parent/payments/history'");
  const end = routes.indexOf('// 5. Admin Payments Management', start);
  assert.ok(start >= 0 && end > start);
  const historyRoute = routes.slice(start, end);
  assert.match(historyRoute, /query = \{ student_id: \{ \$in: Array\.from\(linked\) \} \}/);
  assert.doesNotMatch(historyRoute, /\{\s*parent_user_id\s*:/);
  assert.match(historyRoute, /status\(403\)/);
  assert.doesNotMatch(historyRoute, /query = \{\s*\}/);
});

test('development env loader never reads other processes environment variables', () => {
  assert.doesNotMatch(envConfig, /\/proc/);
  assert.doesNotMatch(envConfig, /readFileSync/);
  assert.doesNotMatch(envConfig, /process\.env\.(MONGODB_URI|JWT_SECRET)\s*=/);
});

test('online gateway requests cannot be marked paid without provider verification', () => {
  const start = routes.indexOf('if (isOnlineGateway) {');
  assert.ok(start >= 0);
  const guard = routes.slice(start, start + 500);
  assert.match(guard, /status\(503\)/);
  assert.match(guard, /verified payment gateway integration/);
  assert.doesNotMatch(guard, /FeePaymentModel\.create/);
});

test('parent payment initiation is restricted to parent and student roles', () => {
  const start = routes.indexOf("router.post('/parent/payments/initiate'");
  const end = routes.indexOf("// 4. Parent Payment History", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['parent', 'student'\]\)/);
});

test('manual payment approval is locked and checks the exact voucher balance before marking paid', () => {
  const start = routes.indexOf("router.post('/admin/payments/:id/approve'");
  const end = routes.indexOf("// 7. Admin Reject Manual Payment", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /status: 'Pending Verification', verification_status: 'Pending'/);
  assert.match(route, /\$set: \{ status: 'Processing' \}/);
  assert.match(route, /pending_amount: currentPending, paid_amount: currentPaid/);
  assert.ok(route.indexOf('FeeModel.findOneAndUpdate') < route.indexOf("status: 'Paid',"));
  assert.match(route, /status: 'Pending Verification'/);
});

test('fee payment initiation verifies the voucher belongs to the authorized student', () => {
  const start = routes.indexOf("router.post('/parent/payments/initiate'");
  const end = routes.indexOf("// 4. Parent Payment History", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /authorizedStudentAliases\.has\(String\(feeDoc\.student_id/);
  assert.match(route, /This fee voucher does not belong to the selected student/);
});

test('fee summary is not accessible to teacher or other unsupported roles', () => {
  assert.match(
    routes,
    /router\.get\('\/parent\/fees\/summary', authenticateToken, requireRole\(\['parent', 'student', 'super_admin', 'admin'\]\)/
  );
});

test('payment rejection is an atomic one-time transition before notifications are sent', () => {
  const start = routes.indexOf("router.post('/admin/payments/:id/reject'");
  const end = routes.indexOf("// 8. Admin Payment & SMS Configuration", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /status: 'Pending Verification', verification_status: 'Pending'/);
  assert.match(route, /status: 'Rejected'/);
  assert.match(route, /findOneAndUpdate\(/);
  assert.doesNotMatch(route, /paymentDoc\.save\(\)/);
});

test('private notifications are scoped to their user and admin broadcasts stay admin-only', () => {
  const helperStart = routes.indexOf('function buildNotificationVisibilityFilter');
  const routeStart = routes.indexOf("router.get('/notifications'");
  const routeEnd = routes.indexOf('// ==========================================\n// 15. USER MANAGEMENT', routeStart);
  assert.ok(helperStart >= 0 && routeStart > helperStart && routeEnd > routeStart);
  const notificationCode = routes.slice(helperStart, routeEnd);
  assert.match(notificationCode, /\{ user_id: \{ \$in: allowedUserIds \} \}/);
  assert.match(notificationCode, /\{ role: 'all' \}/);
  assert.match(notificationCode, /userRole === 'super_admin' \|\| userRole === 'admin'/);
  assert.doesNotMatch(notificationCode, /\{ role: userRole \}/);
  assert.match(notificationCode, /findOneAndUpdate\([\s\S]*buildNotificationVisibilityFilter/);
  assert.match(notificationCode, /buildNotificationVisibilityFilter\(userRole, allowedUserIds\)/);
});

test('notification read and mark-all-read use the same private visibility filter', () => {
  const start = routes.indexOf("router.get('/notifications'");
  const end = routes.indexOf('// ==========================================\n// 15. USER MANAGEMENT', start);
  const code = routes.slice(start, end);
  assert.equal((code.match(/buildNotificationVisibilityFilter\(userRole, allowedUserIds\)/g) || []).length, 4);
  assert.match(code, /read: false,[\s\S]*buildNotificationVisibilityFilter\(userRole, allowedUserIds\)/);
});

test('authenticated requests resolve current user state rather than trusting stale token role or links', () => {
  const authStart = authConfig.indexOf('export async function authenticateToken');
  const authEnd = authConfig.indexOf('export async function authenticateOptionalToken', authStart);
  assert.ok(authStart >= 0 && authEnd > authStart);
  const authRoute = authConfig.slice(authStart, authEnd);
  assert.match(authRoute, /resolveLiveUserFromDecoded\(decoded\)/);
  assert.match(authRoute, /role: liveUser\.role/);
  assert.match(authRoute, /linked_student_ids: Array\.isArray\(liveUser\.linked_student_ids\)/);
  assert.match(authRoute, /isTokenRevokedAsync\(token\)/);
});

test('unlink removes all known child aliases from user and parent relationship records', () => {
  const start = routes.indexOf("router.post('/parents/unlink-child'");
  const end = routes.indexOf('// Parent directory & profile CRUD', start);
  assert.ok(start >= 0 && end > start);
  const unlink = routes.slice(start, end);
  assert.match(unlink, /\$pull: \{ linked_student_ids: \{ \$in: Array\.from\(idsToPull\) \} \}/);
  assert.match(unlink, /parent_user_id: \{ \$in:/);
  assert.match(unlink, /ParentModel\.updateMany\([\s\S]*\$pull: \{ linked_students: \{ \$in: Array\.from\(idsToPull\) \} \}/);
});

test('parent document downloads require a current child link even when parent uploaded the file', () => {
  const start = routes.indexOf("router.get('/documents/:filename'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /const isStudentScopedDocument = Boolean\(docMeta\.student_id\)/);
  assert.match(route, /user\.role === 'parent'[\s\S]*getLinkedStudentIdsForParent\(user\)[\s\S]*linkedSet\.has\(docMeta\.student_id\)/);
  assert.match(route, /else if \(!authorized\) \{[\s\S]*docMeta\.uploaded_by_user_id === user\.id/);
  assert.ok(route.indexOf('getLinkedStudentIdsForParent(user)') < route.indexOf('docMeta.uploaded_by_user_id === user.id'));
});

test('teacher class access uses exact normalized labels and prevents substring escalation', () => {
  assert.equal(isClassAssignedToTeacher(['1'], '1'), true);
  assert.equal(isClassAssignedToTeacher(['Class 1'], '1'), true);
  assert.equal(isClassAssignedToTeacher(['Grade 1'], 'Class 1'), true);
  assert.equal(isClassAssignedToTeacher(['1'], '10'), false);
  assert.equal(isClassAssignedToTeacher(['Class 10'], 'Class 1'), false);
  assert.equal(isClassAssignedToTeacher(['Grade 11'], 'Grade 1'), false);
  assert.equal(isClassAssignedToTeacher(['Class 1-A'], 'Class 1'), false);
  assert.equal(isClassAssignedToTeacher(['Class 1'], ''), false);
  assert.equal(normalizeClassAccessLabel('  GRADE   10 '), '10');
});

test('all teacher data-scope routes use the shared exact class access helper', () => {
  assert.match(routes, /import \{ isClassAssignedToTeacher, normalizeClassAccessLabel \} from '\.\/classAccess\.ts'/);
  assert.doesNotMatch(routes, /target\.includes\(c\) \|\| c\.includes\(target\)/);
});

test('teacher dashboard unread count cannot aggregate every teacher private notification', () => {
  const start = routes.indexOf("router.get('/teacher/dashboard'");
  const end = routes.indexOf('// 20.2 Teacher Profile', start);
  assert.ok(start >= 0 && end > start);
  const dashboard = routes.slice(start, end);
  assert.match(dashboard, /resolveNotificationAllowedUserIds\(req\.user!\)/);
  assert.match(dashboard, /buildNotificationVisibilityFilter\(req\.user!\.role, allowedNotificationUserIds\)/);
  assert.doesNotMatch(dashboard, /\{ role: 'teacher' \}/);
});

test('teacher homework creation is restricted to the authenticated teacher assignment scope', () => {
  const start = routes.indexOf("router.post('/teacher/homework'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /canAssignTeacherHomework\(/);
  assert.match(route, /Homework must match your assigned class, section, and subject/);
  assert.match(route, /teacher_id: teacher\.id/);
});

test('teacher subject scope uses exact subject names and supports explicit compound subjects', () => {
  assert.equal(isTeacherSubjectAssigned('Mathematics', [], 'Mathematics'), true);
  assert.equal(isTeacherSubjectAssigned('Mathematics & Science', [], 'Science'), true);
  assert.equal(isTeacherSubjectAssigned('English, Urdu', [], 'Urdu'), true);
  assert.equal(isTeacherSubjectAssigned('Computer Science', ['Physics'], 'Physics'), true);
  assert.equal(isTeacherSubjectAssigned('Mathematics', [], 'Math'), false);
  assert.equal(isTeacherSubjectAssigned('Physics', [], 'Physical Education'), false);
  assert.equal(isTeacherSubjectAssigned('', [], 'Mathematics'), false);
});

test('teacher section scope denies access to other sections when explicit assignments exist', () => {
  const teacherClasses = ['Class 1'];
  const assignments = [{ class_name: 'Class 1', section: 'A', subject: 'Mathematics' }];
  assert.equal(isTeacherAssignedToClassSection(teacherClasses, assignments, '1', 'A'), true);
  assert.equal(isTeacherAssignedToClassSection(teacherClasses, assignments, 'Class 1', 'Section A'), true);
  assert.equal(isTeacherAssignedToClassSection(teacherClasses, assignments, 'Class 1', 'B'), false);
  assert.equal(isTeacherAssignedToClassSection(teacherClasses, assignments, 'Class 10', 'A'), false);
});

test('legacy class-level teacher assignment remains compatible when no section assignments exist', () => {
  assert.equal(isTeacherAssignedToClassSection(['Grade 2'], [], '2', 'B'), true);
  assert.equal(isTeacherAssignedToClassSection(['Grade 2'], [{ class_name: 'Grade 2', section: '', subject: 'Math' }], '2', 'B'), true);
  assert.equal(isTeacherAssignedToClassSection(['Grade 2'], [], '3', 'B'), false);
});

test('teacher portal read and write routes enforce section-level assignment checks', () => {
  const routesToCheck = [
    "router.get('/teacher/students'",
    "router.get('/teacher/attendance'",
    "router.get('/teacher/results'",
    "router.post('/teacher/attendance'",
    "router.post('/teacher/results'",
    "router.get('/teacher/dashboard'",
  ];
  for (const marker of routesToCheck) {
    const start = routes.indexOf(marker);
    const end = routes.indexOf('\n});', start) + 4;
    assert.ok(start >= 0 && end > start, marker);
    assert.match(routes.slice(start, end), /isTeacherAssignedToClassSection/);
  }
});

test('teacher class overview only counts and lists assigned sections', () => {
  const start = routes.indexOf("router.get('/teacher/classes'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /getTeacherAssignmentScopes\(teacherIds\)/);
  assert.match(route, /studentsInClass[\s\S]*isTeacherAssignedToClassSection/);
  assert.match(route, /mongoSections[\s\S]*isTeacherAssignedToClassSection/);
  assert.match(route, /todayAttendanceMarked[\s\S]*isTeacherAssignedToClassSection/);
});

test('teacher timetable uses exact owner matching rather than partial name matching', () => {
  const start = routes.indexOf("router.get('/teacher/timetable'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /=== String\(teacher\.name \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.doesNotMatch(route, /\.includes\(teacher\.name/);
});

test('teacher AI query scopes student, attendance, and result data to assigned sections', () => {
  const start = routes.indexOf("router.post('/teacher/ai/query'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /getTeacherAssignmentScopes\(teacherIds\)/);
  assert.match(route, /const teacherScopeClauses = assignedClassNames\.flatMap/);
  assert.match(route, /const teacherScopeFilter = teacherScopeClauses\.length/);
  assert.match(route, /StudentModel\.find\(teacherScopeFilter\)/);
  assert.match(route, /AttendanceModel\.find\(teacherScopeFilter\)/);
  assert.match(route, /ResultModel\.find\(teacherScopeFilter\)/);
  assert.doesNotMatch(route, /StudentModel\\.find\\(\\)\\.lean\\(\\)/);
  assert.match(route, /const promptTokens = lower\.match\(\/\[a-z0-9\]\+\/g\)/);
  assert.match(route, /const containsStudentName = \(student: StudentDto\)/);
  assert.doesNotMatch(route, /lower\.includes\(s\.full_name\.toLowerCase\(\)\)/);
});

test('teacher AI confirmed actions revalidate live section and subject assignments', () => {
  const start = routes.indexOf("router.post('/teacher/ai/execute-action'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /isTeacherAssignedToClassSection/);
  assert.match(route, /isTeacherSubjectAssigned/);
  assert.match(route, /Student is outside your assigned class and section/);
  assert.match(route, /Subject is outside your teaching assignment/);
});

test('teacher homework read and delete routes revalidate current assignment scope', () => {
  const readStart = routes.indexOf("router.get('/teacher/homework'");
  const readEnd = routes.indexOf('\n});', readStart) + 4;
  assert.ok(readStart >= 0 && readEnd > readStart);
  const readRoute = routes.slice(readStart, readEnd);
  assert.match(readRoute, /getTeacherAssignmentScopes\(teacherIds\)/);
  assert.match(readRoute, /authorizedDocs = docs\.filter[\s\S]*isTeacherAssignedToClassSection/);

  const deleteStart = routes.indexOf("router.delete('/teacher/homework/:id'");
  const deleteEnd = routes.indexOf('\n});', deleteStart) + 4;
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
  const deleteRoute = routes.slice(deleteStart, deleteEnd);
  assert.match(deleteRoute, /ownedHomework = await HomeworkModel\.findOne/);
  assert.match(deleteRoute, /isTeacherAssignedToClassSection/);
  assert.match(deleteRoute, /findOneAndDelete\([\s\S]*ownedHomework\._id/);
});

test('student list endpoint restricts teachers to assigned sections and known roles', () => {
  const start = routes.indexOf("router.get('/students'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['super_admin', 'admin', 'teacher', 'parent', 'student'\]\)/);
  assert.match(route, /getTeacherAssignmentScopes\(teacherIds\)/);
  assert.match(route, /result = result\.filter\(student => isTeacherAssignedToClassSection/);
});

test('student dossier enforces active parent link and teacher section scope', () => {
  const start = routes.indexOf("router.get('/students/:id'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['super_admin', 'admin', 'teacher', 'parent', 'student'\]\)/);
  assert.match(route, /linkedSet\.has\(student\.admission_no\)/);
  assert.doesNotMatch(route, /student\.parent_user_id === req\.user\?\.id/);
  assert.match(route, /isTeacherAssignedToClassSection/);
});

test('student attendance endpoint restricts teacher access to assigned sections and known roles', () => {
  const start = routes.indexOf("router.get('/attendance/student/:studentId'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['super_admin', 'admin', 'teacher', 'parent', 'student'\]\)/);
  assert.match(route, /isTeacherAssignedToClassSection/);
});

test('attendance list endpoint limits teacher records to assigned class sections', () => {
  const start = routes.indexOf("router.get('/attendance'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['super_admin', 'admin', 'teacher', 'parent', 'student'\]\)/);
  assert.match(route, /getTeacherAssignmentScopes\(teacherIds\)/);
  assert.match(route, /filter\(a => isTeacherAssignedToClassSection/);
});

test('results list endpoint limits teacher records to assigned class sections', () => {
  const start = routes.indexOf("router.get('/results'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['super_admin', 'admin', 'teacher', 'parent', 'student'\]\)/);
  assert.match(route, /getTeacherAssignmentScopes\(teacherIds\)/);
  assert.match(route, /filter\(r => isTeacherAssignedToClassSection/);
});

test('fee list endpoint rejects roles outside the declared school roles', () => {
  const start = routes.indexOf("router.get('/fees'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['super_admin', 'admin', 'teacher', 'parent', 'student'\]\)/);
  assert.match(route, /Teachers do not have access to fee records/);
});

test('public parent signup uses atomic child claim instead of overwriting an existing parent link', () => {
  const start = routes.indexOf("router.post('/auth/register-parent'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /claimStudentForParent\(\s*pendingStudentDoc, newUserId, createdUser\._id\.toString\(\)/);
  assert.match(route, /if \(!claimedStudent\)[\s\S]*deleteOne\(\{ _id: createdUser\._id \}\)[\s\S]*409/);
  assert.doesNotMatch(route, /studentDoc\.parent_user_id\s*=\s*newUserId/);
  assert.match(route, /ParentModel\.create\([\s\S]*catch \(parentCreateError\)/);
  assert.match(route, /parent_user_id: newUserId[\s\S]*parent_user_id: ''/);
});

test('public teacher directory excludes private identity and contact fields', () => {
  const start = routes.indexOf("router.get('/teachers'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /const publicTeachers = teachers\.map\(t => \(\{/);
  assert.doesNotMatch(route, /\.\.\.t/);
  for (const privateField of ['user_id', 'father_name', 'cnic', 'contact_no', 'email', 'joining_date']) {
    assert.doesNotMatch(route, new RegExp('\\b' + privateField + '\\s*:'));
  }
  assert.match(route, /name: t\.name/);
  assert.match(route, /qualification: t\.qualification/);
  assert.match(route, /subject: t\.subject/);
});

test('full teacher profile endpoint is limited to admins and the teacher role', () => {
  const start = routes.indexOf("router.get('/teachers/:id'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireRole\(\['super_admin', 'admin', 'teacher'\]\)/);
  assert.match(route, /You may only view your own teacher profile/);
  assert.match(route, /Personnel staff profiles are restricted/);
});

test('teacher dashboard timetable uses exact teacher-name matching', () => {
  const start = routes.indexOf("router.get('/teacher/dashboard'");
  const end = routes.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /teacherTimetable = allTtDocs/);
  assert.match(route, /=== String\(teacher\.name/);
  assert.doesNotMatch(route, /teacher_name\.toLowerCase\(\)\.includes/);
});
