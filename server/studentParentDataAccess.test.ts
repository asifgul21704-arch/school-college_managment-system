import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');

function routeBetween(startMarker: string, endMarker: string): string {
  const start = routes.indexOf(startMarker);
  const end = routes.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Could not locate route: ${startMarker}`);
  return routes.slice(start, end);
}

test('student fee summary resolves the live linked student record first', () => {
  const route = routeBetween("router.get('/parent/fees/summary'", "// 2. Get Public Payment Settings");
  assert.match(route, /user\.linked_id\s*\?\s*await findStudentByAnyId\(user\.linked_id\)/);
  assert.match(route, /studentIds = collectStudentPaymentIdentifiers\(studentDoc\)/);
});

test('student payment history resolves the live linked student record first', () => {
  const route = routeBetween("router.get('/parent/payments/history'", "// 5. Admin Payments Management");
  assert.match(route, /user\.linked_id\s*\?\s*await findStudentByAnyId\(user\.linked_id\)/);
  assert.match(route, /collectStudentPaymentIdentifiers\(studentDoc\)/);
});

test('parent portal AI includes admission number when matching child records', () => {
  const route = routeBetween("if (userRole === 'parent')", "// 20. TEACHER PORTAL");
  assert.match(route, /rawDoc\?\.admission_no/);
  assert.match(route, /AttendanceModel\.find\(\{ student_id: \{ \$in: parentIdList \} \}\)/);
  assert.match(route, /FeeModel\.find\(\{ student_id: \{ \$in: parentIdList \} \}\)/);
  assert.match(route, /ResultModel\.find\(\{ student_id: \{ \$in: parentIdList \}, published: \{ \$ne: false \} \}\)/);
});
