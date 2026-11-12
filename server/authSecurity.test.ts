import test from 'node:test';
import assert from 'node:assert/strict';
import { getJwtSecret, extractTokenFromRequest } from './auth.ts';

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
