import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const harness = readFileSync(new URL('../run_phase5_verification.cjs', import.meta.url), 'utf8');

test('destructive E2E harness has no embedded JWT fallback or fixed test password', () => {
  assert.equal(harness.includes('process.env.JWT_SECRET ||'), false);
  assert.equal(harness.includes('shawan-school-and-college-secure-jwt-secret'), false);
  assert.equal(harness.includes('TeacherPassword123!'), false);
  assert.equal(harness.includes('WrongPassword123!'), false);
});

test('destructive E2E harness requires explicit opt-in and dedicated local database', () => {
  assert.match(harness, /E2E_ALLOW_MUTATIONS !== 'true'/);
  assert.match(harness, /E2E_EXPECTED_DATABASE_NAME/);
  assert.match(harness, /\^e2e\[_-\]/);
  assert.match(harness, /database\?\.isAtlas !== false/);
  assert.match(harness, /database\?\.databaseName !== E2E_EXPECTED_DATABASE_NAME/);
});

test('E2E test identity and password are supplied only by environment', () => {
  assert.match(harness, /process\.env\.E2E_TEACHER_EMAIL/);
  assert.match(harness, /process\.env\.E2E_TEACHER_PASSWORD/);
  assert.equal(harness.includes('teacher@shawanschool.edu.pk'), false);
});

const envLoader = readFileSync(new URL('./config/env.ts', import.meta.url), 'utf8');

test('environment loader never reads secrets from unrelated processes', () => {
  assert.equal(envLoader.includes('/proc'), false);
  assert.equal(envLoader.includes('/environ'), false);
  assert.equal(envLoader.includes('process.env.JWT_SECRET ='), false);
  assert.equal(envLoader.includes('process.env.MONGODB_URI ='), false);
});

test('local dotenv defaults do not overwrite explicitly injected environment variables', () => {
  assert.match(envLoader, /override: false/);
  assert.doesNotMatch(envLoader, /override: true/);
});
