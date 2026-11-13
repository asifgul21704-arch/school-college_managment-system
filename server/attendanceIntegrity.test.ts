import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
const start = routes.indexOf("router.post('/attendance/batch'");
const end = routes.indexOf("router.get('/attendance/student/:studentId'", start);
assert.ok(start >= 0 && end > start);
const route = routes.slice(start, end);

test('batch attendance always stores canonical student identity and class metadata', () => {
  assert.equal((route.match(/student_name: studentDoc\.full_name/g) || []).length, 2);
  assert.equal((route.match(/class_name: studentDoc\.class_name/g) || []).length, 2);
  assert.equal((route.match(/section: studentDoc\.section \|\| 'A'/g) || []).length, 2);
  assert.doesNotMatch(route, /student_name: rec\.student_name|class_name: rec\.class_name|section: rec\.section/);
});
