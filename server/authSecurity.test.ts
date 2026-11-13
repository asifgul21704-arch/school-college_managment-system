import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getJwtSecret, extractTokenFromRequest, isValidUserRole } from './auth.ts';

test('production rejects missing JWT_SECRET', () => {
  const mode = process.env.NODE_ENV, secret = process.env.JWT_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    assert.throws(() => getJwtSecret(), /JWT_SECRET is missing or empty/);
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  }
});

test('production rejects short and placeholder JWT secrets', () => {
  const mode = process.env.NODE_ENV, secret = process.env.JWT_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'too-short';
    assert.throws(() => getJwtSecret(), /minimum 32 characters/);
    process.env.JWT_SECRET = 'replace_with_a_real_secret_value_123456789';
    assert.throws(() => getJwtSecret(), /placeholder JWT_SECRET/);
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  }
});

test('development fallback is process-generated and sufficiently strong', () => {
  const mode = process.env.NODE_ENV, secret = process.env.JWT_SECRET;
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    const first = getJwtSecret();
    assert.equal(first.length, 64);
    assert.equal(getJwtSecret(), first);
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  }
});

test('request token extraction prefers the session cookie over bearer token', () => {
  const req = { headers: { cookie: 'theme=dark; shawan_session=cookie-token', authorization: 'Bearer bearer-token' } } as any;
  assert.equal(extractTokenFromRequest(req), 'cookie-token');
});

test('request token extraction falls back to bearer credentials', () => {
  assert.equal(extractTokenFromRequest({ headers: { authorization: 'Bearer api-token' } } as any), 'api-token');
});

test('request token extraction rejects malformed and empty credentials', () => {
  assert.equal(extractTokenFromRequest({ headers: { authorization: 'Basic abc' } } as any), null);
  assert.equal(extractTokenFromRequest({ headers: { cookie: 'theme=dark' } } as any), null);
});

async function runAuthentication(headers: Record<string, string>) {
  let statusCode = 200;
  let body: unknown;
  let nextCalled = false;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  const { authenticateToken } = await import('./auth.ts');
  await authenticateToken(
    { headers, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as any,
    response as any,
    () => { nextCalled = true; }
  );
  return { statusCode, body, nextCalled };
}

test('authentication middleware rejects a missing token before database access', async () => {
  const result = await runAuthentication({});
  assert.equal(result.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test('authentication middleware rejects an invalid bearer token before database access', async () => {
  const result = await runAuthentication({ authorization: 'Bearer definitely-not-a-jwt' });
  assert.equal(result.statusCode, 401);
  assert.equal(result.nextCalled, false);
});


test('live account roles are allowlisted and malformed roles fail closed', () => {
  for (const role of ['super_admin', 'admin', 'teacher', 'parent', 'student']) {
    assert.equal(isValidUserRole(role), true);
  }
  for (const role of ['guest', 'owner', 'ADMIN', '', null, undefined, 1, {}]) {
    assert.equal(isValidUserRole(role), false);
  }
});


test('authenticated requests resolve role and parent links from the live MongoDB user record', () => {
  const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');
  assert.match(source, /const liveUser = await resolveLiveUserFromDecoded\(decoded\)/);
  assert.match(source, /role: liveUser\.role as UserRole/);
  assert.match(source, /linked_id: liveUser\.linked_id/);
  assert.match(source, /linked_student_ids: Array\.isArray\(liveUser\.linked_student_ids\)/);
  assert.doesNotMatch(source, /linked_id: decoded\.linked_id/);
  assert.doesNotMatch(source, /linked_student_ids: decoded\.linked_student_ids/);
});

test('live account lookup uses stable user ID and email fallback only for legacy records', () => {
  const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function resolveLiveUserFromDecoded');
  const end = source.indexOf('export async function authenticateToken', start);
  assert.ok(start >= 0 && end > start);
  const lookup = source.slice(start, end);
  assert.match(lookup, /record_id: rawId/);
  assert.match(lookup, /_id: new mongoose\.Types\.ObjectId\(rawId\)/);
  assert.match(lookup, /record_id: \{ \$exists: false \}/);
  assert.match(lookup, /record_id: null/);
  assert.match(lookup, /record_id: ''/);
});
