import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');

test('link persistence failure verifies database state before releasing claimed ownership', () => {
  const helperStart = routes.indexOf('async function persistParentStudentLink');
  const helperEnd = routes.indexOf("// Parent link student endpoint", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = routes.slice(helperStart, helperEnd);
  assert.match(helper, /result\.matchedCount !== 1/);
  assert.match(helper, /UserModel\.findOne\(\{ _id: userDoc\._id, role: 'parent' \}\)\.lean\(\)/);
  assert.match(helper, /if \(!linkPersisted\)[\s\S]*?StudentModel\.updateOne\([\s\S]*?buildStudentParentReleaseFilter/);
  assert.match(helper, /throw linkError/);
});


test('administrator parent linking cannot bypass the atomic student ownership claim', () => {
  const start = routes.indexOf("router.post('/admin/parent-links/link'");
  const end = routes.indexOf("router.post('/admin/parent-links/unlink'", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /claimStudentForParent\(studentDoc, canonicalParentId, parentUser\._id\.toString\(\)\)/);
  assert.match(route, /persistParentStudentLink\(parentUser, studentDoc, canonicalStudentId, canonicalParentId\)/);
  assert.match(route, /already linked to another parent account/);
  assert.doesNotMatch(route, /parentUser\.save\(\)|studentDoc\.save\(\)/);
});

test('administrator unlink clears current links and releases only the selected parent ownership', () => {
  const start = routes.indexOf("router.post('/admin/parent-links/unlink'");
  const end = routes.indexOf("router.get('/auth/me'", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /getLinkedStudentIdsForParent\([\s\S]*?id: canonicalParentId/);
  assert.match(route, /linked_student_ids: remainingLinksExpression/);
  assert.match(route, /updatePipeline: true/);
  assert.match(route, /unlinkResult\.matchedCount !== 1/);
  assert.match(route, /buildStudentParentReleaseFilter\(studentDoc\._id, canonicalParentId, parentUser\._id\.toString\(\)\)/);
  assert.match(route, /\$unset: \{ parent_user_id: '' \}/);
  assert.doesNotMatch(route, /parentUser\.save\(\)|studentDoc\.save\(\)/);
});


test('public parent registration uses the same verified atomic student claim as portal linking', () => {
  const start = routes.indexOf("router.post('/auth/register-parent'");
  const end = routes.indexOf("router.post('/auth/register-teacher'", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /claimStudentForParent\([\s\S]*?canonicalParentId[\s\S]*?createdUser\._id\.toString\(\)/);
  assert.match(route, /persistParentStudentLink\(createdUser, verifiedChild, canonicalStudentId, canonicalParentId\)/);
  assert.match(route, /already linked to another parent account/);
  assert.match(route, /buildStudentParentReleaseFilter\(verifiedChild\._id, canonicalParentId, createdUser\._id\.toString\(\)\)/);
  assert.doesNotMatch(route, /verifiedChild\.parent_user_id\s*=|verifiedChild\.save\(\)/);
});


test('parent child discovery does not disclose student details already claimed by another parent', () => {
  const start = routes.indexOf("router.post('/parents/find-child'");
  const end = routes.indexOf("router.post('/parents/confirm-link-child'", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /isStudentClaimedByAnotherParent\(rawDoc\.parent_user_id, currentParentIdentifiers\)/);
  assert.match(route, /const currentParentIdentifiers = \[canonicalUserId, userDoc\._id\.toString\(\)\]/);
});
