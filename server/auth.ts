import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jsonwebtoken from 'jsonwebtoken';
import mongoose from 'mongoose';
import { UserModel, type UserRole } from './models/User.ts';
import { RevokedTokenModel } from './models/RevokedToken.ts';
import { RateLimitBucketModel } from './models/RateLimitBucket.ts';
import { isProductionEnvironment } from './config/runtime.ts';

const DEFAULT_INSECURE_SECRET = 'shawan-school-and-college-secure-jwt-secret-2026-paharpur';
export const SESSION_COOKIE_NAME = 'shawan_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

// L1 bounded in-memory revoked token cache (keyed by SHA-256 of raw JWT -> expiry epoch ms),
// backed by shared persistent MongoDB `revoked_tokens` TTL collection for multi-instance deployments.
const revokedTokenHashes = new Map<string, number>();

function hashRawToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function revokeToken(
  token: string,
  expUnixSeconds?: number,
  reason = 'logout'
): Promise<void> {
  if (!token) return;
  const now = Date.now();
  if (revokedTokenHashes.size > 5000) {
    for (const [k, expMs] of revokedTokenHashes.entries()) {
      if (expMs <= now) revokedTokenHashes.delete(k);
    }
  }
  const expiryMs = expUnixSeconds ? expUnixSeconds * 1000 : now + SESSION_MAX_AGE_SECONDS * 1000;
  const key = hashRawToken(token);
  revokedTokenHashes.set(key, expiryMs);

  if (mongoose.connection.readyState === 1 && expiryMs > now) {
    try {
      await RevokedTokenModel.updateOne(
        { token_hash: key },
        {
          $set: {
            token_hash: key,
            expires_at: new Date(expiryMs),
            revoked_at: new Date(now),
            reason,
          },
        },
        { upsert: true }
      );
    } catch {
      // L1 memory revocation remains active even if MongoDB experiences a transient write hiccup
    }
  }
}

export function clearLocalRevokedTokenCache(): void {
  revokedTokenHashes.clear();
}

export function isTokenRevoked(token: string): boolean {
  if (!token) return false;
  const key = hashRawToken(token);
  const expMs = revokedTokenHashes.get(key);
  if (!expMs) return false;
  if (expMs <= Date.now()) {
    revokedTokenHashes.delete(key);
    return false;
  }
  return true;
}

export async function isTokenRevokedAsync(token: string): Promise<boolean> {
  if (!token) return false;
  if (isTokenRevoked(token)) return true;
  if (mongoose.connection.readyState !== 1) return false;

  const key = hashRawToken(token);
  try {
    const persisted = await RevokedTokenModel.findOne({
      token_hash: key,
      expires_at: { $gt: new Date() },
    })
      .select({ expires_at: 1 })
      .lean();
    if (persisted?.expires_at) {
      revokedTokenHashes.set(key, new Date(persisted.expires_at).getTime());
      return true;
    }
  } catch {
    // Defer to downstream readyState / liveUser verification if DB query fails
  }
  return false;
}

function extractCookieSessionToken(req: Request): string | null {
  const rawCookie = req.headers.cookie;
  if (typeof rawCookie === 'string' && rawCookie.length > 0) {
    const pairs = rawCookie.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      if (name === SESSION_COOKIE_NAME) {
        try {
          const val = decodeURIComponent(pair.slice(idx + 1).trim());
          if (val) return val;
        } catch {
          const rawVal = pair.slice(idx + 1).trim();
          if (rawVal) return rawVal;
        }
      }
    }
  }
  return null;
}

function extractBearerHeaderToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  return null;
}

/**
 * Prefers the secure HttpOnly session cookie first, falling back to Authorization: Bearer
 * for API clients and browsers with strict cross-origin third-party cookie blocking.
 */
export function extractTokenFromRequest(req: Request): string | null {
  const cookieToken = extractCookieSessionToken(req);
  if (cookieToken) return cookieToken;
  return extractBearerHeaderToken(req);
}

export function extractAllTokensFromRequest(req: Request): string[] {
  const tokens = new Set<string>();
  const cookieToken = extractCookieSessionToken(req);
  if (cookieToken) tokens.add(cookieToken);
  const bearerToken = extractBearerHeaderToken(req);
  if (bearerToken) tokens.add(bearerToken);
  return Array.from(tokens);
}

function isRequestHttps(req: Request): boolean {
  if (req.secure) return true;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const rawProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (typeof rawProto === 'string') {
    const firstHopProto = rawProto.split(',')[0].trim().toLowerCase();
    if (firstHopProto === 'https') return true;
  }
  return false;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isProd = isProductionEnvironment();
  const isHttps = isRequestHttps(req);
  const hasCrossOriginConfig = Boolean(process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.trim());
  const useSecure = isProd && (isHttps || hasCrossOriginConfig);
  const sameSite = isProd && isHttps && hasCrossOriginConfig ? 'None' : 'Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    `SameSite=${sameSite}`,
  ];
  if (useSecure) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isProd = isProductionEnvironment();
  const isHttps = isRequestHttps(req);
  const hasCrossOriginConfig = Boolean(process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.trim());
  const useSecure = isProd && (isHttps || hasCrossOriginConfig);
  const sameSite = isProd && isHttps && hasCrossOriginConfig ? 'None' : 'Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    `SameSite=${sameSite}`,
  ];
  if (useSecure) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

const EXAMPLE_PLACEHOLDER_SECRET = 'replace_with_minimum_32_character_cryptographic_secret';

/**
 * Validates and retrieves the JWT secret.
 * In production mode, an explicit, strong JWT_SECRET is strictly required.
 */
export function getJwtSecret(): string {
  const rawSecret = typeof process.env.JWT_SECRET === 'string' ? process.env.JWT_SECRET.trim() : '';
  const isProd = isProductionEnvironment();
  if (isProd) {
    if (!rawSecret) {
      throw new Error(
        '[JWT Security] JWT_SECRET is missing or empty in process.env. Configure a unique JWT_SECRET (minimum 32 characters) in your service environment variables.'
      );
    }
    if (
      rawSecret === DEFAULT_INSECURE_SECRET ||
      rawSecret === EXAMPLE_PLACEHOLDER_SECRET ||
      /^(replace_with|your_|changeme)/i.test(rawSecret)
    ) {
      throw new Error(
        '[JWT Security] Default or placeholder JWT_SECRET values are strictly prohibited in production. Configure a unique cryptographic JWT_SECRET (minimum 32 characters).'
      );
    }
    if (rawSecret.length < 32) {
      throw new Error(
        '[JWT Security] In production mode, a strong, unique JWT_SECRET (minimum 32 characters) must be configured in environment variables.'
      );
    }
    return rawSecret;
  }
  return rawSecret || DEFAULT_INSECURE_SECRET;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    name: string;
    phone?: string;
    linked_id?: string;
    linked_student_ids?: string[];
  };
}

export interface TokenSubject {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  phone?: string;
  linked_id?: string;
  linked_student_ids?: string[];
}

export function generateToken(user: TokenSubject): string {
  return jsonwebtoken.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      phone: user.phone,
      linked_id: user.linked_id,
      linked_student_ids: user.linked_student_ids || [],
      iat_ms: Date.now(),
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

// Shared MongoDB-backed rate limiting (with automatic bounded in-memory fallback when DB is offline)
interface RateRecord {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateRecord>();

function enforceLocalRateLimit(
  key: string,
  now: number,
  options: { windowMs: number; max: number; message: string },
  res: Response,
  next: NextFunction
) {
  if (rateBuckets.size > 10000) {
    for (const [k, rec] of rateBuckets.entries()) {
      if (now > rec.resetAt) rateBuckets.delete(k);
    }
  }
  const record = rateBuckets.get(key);
  if (!record || now > record.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return next();
  }
  if (record.count >= options.max) {
    const retryAfterSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: options.message });
  }
  record.count++;
  return next();
}

export function createRateLimiter(options: { windowMs: number; max: number; message: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'ip';
    const key = `${req.baseUrl || ''}${req.path}:${ip}`;
    const now = Date.now();

    if (mongoose.connection.readyState !== 1) {
      return enforceLocalRateLimit(key, now, options, res, next);
    }

    try {
      const nowDate = new Date(now);
      const nextResetDate = new Date(now + options.windowMs);

      let bucket = await RateLimitBucketModel.findOneAndUpdate(
        { bucket_key: key, reset_at: { $gt: nowDate } },
        { $inc: { count: 1 } },
        { returnDocument: 'after' }
      ).lean();

      if (!bucket) {
        try {
          bucket = await RateLimitBucketModel.findOneAndUpdate(
            { bucket_key: key, reset_at: { $lte: nowDate } },
            { $set: { count: 1, reset_at: nextResetDate } },
            { upsert: true, returnDocument: 'after' }
          ).lean();
        } catch (err: any) {
          if (err?.code === 11000) {
            bucket = await RateLimitBucketModel.findOneAndUpdate(
              { bucket_key: key },
              { $inc: { count: 1 } },
              { returnDocument: 'after' }
            ).lean();
          } else {
            throw err;
          }
        }
      }

      if (bucket && bucket.count > options.max) {
        const resetMs = bucket.reset_at ? new Date(bucket.reset_at).getTime() : now + options.windowMs;
        const retryAfterSec = Math.max(1, Math.ceil((resetMs - now) / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({ error: options.message });
      }

      return next();
    } catch {
      return enforceLocalRateLimit(key, now, options, res, next);
    }
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 30, // 30 attempts per 15 mins
  message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
});

export const contactRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many messages sent. Please wait before submitting again.',
});

export const sensitiveActionRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: 'Too many verification or upload requests from this IP. Please wait before trying again.',
});

export const aiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Too many AI assistant requests from this IP. Please wait a few minutes.',
});

export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many password reset requests from this IP. Please wait 15 minutes before trying again.',
});

export const bootstrapRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many bootstrap attempts from this IP. Please wait 15 minutes.',
});

export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim().toLowerCase());
}

export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  if (password.length < 6) {
    return { valid: false, message: 'Password must be at least 6 characters long' };
  }
  return { valid: true };
}

export async function resolveLiveUserFromDecoded(decoded: any): Promise<any | null> {
  const rawId = decoded?.id ? String(decoded.id).trim() : '';
  if (rawId) {
    const clauses: Record<string, any>[] = [{ record_id: rawId }];
    if (mongoose.Types.ObjectId.isValid(rawId) && /^[a-fA-F0-9]{24}$/.test(rawId)) {
      clauses.push({ _id: new mongoose.Types.ObjectId(rawId) });
    }
    const byId = await UserModel.findOne(clauses.length === 1 ? clauses[0] : { $or: clauses }).lean();
    if (byId) {
      return byId;
    }
  }

  // Fallback only for pre-Phase-9 documents without record_id
  const rawEmail = decoded?.email ? String(decoded.email).trim().toLowerCase() : '';
  if (rawEmail) {
    const byEmail = await UserModel.findOne({
      email: rawEmail,
      $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
    }).lean();
    if (byEmail) {
      return byEmail;
    }
  }

  return null;
}

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Authenticated school records contain personal and financial data; never allow shared/browser caching.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const token = extractTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Token missing.' });
  }

  if (await isTokenRevokedAsync(token)) {
    return res.status(401).json({ error: 'Session has been logged out or revoked. Please sign in again.' });
  }

  let decoded: any;
  try {
    decoded = jsonwebtoken.verify(token, getJwtSecret());
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: 'Database service temporarily unavailable. Write/read aborted safely without modifying local fallback state.',
    });
  }

  try {
    const liveUser = await resolveLiveUserFromDecoded(decoded);
    if (!liveUser) {
      return res.status(401).json({ error: 'Invalid or expired session. User account not found.' });
    }

    if (liveUser.password_changed_at) {
      const changedAtMs = new Date(liveUser.password_changed_at).getTime();
      const tokenIssuedMs =
        typeof decoded.iat_ms === 'number'
          ? decoded.iat_ms
          : typeof decoded.iat === 'number'
          ? decoded.iat * 1000
          : 0;
      if (!isNaN(changedAtMs) && tokenIssuedMs < changedAtMs) {
        return res.status(401).json({
          error: 'Session expired due to a password change. Please sign in again.',
        });
      }
    }

    if (liveUser.status && liveUser.status !== 'active') {
      return res.status(403).json({
        error: 'Account is deactivated or inactive. Access denied.',
      });
    }

    req.user = {
      id: String(liveUser.record_id || liveUser._id),
      email: String(liveUser.email || '').toLowerCase(),
      role: liveUser.role as UserRole,
      name: String(liveUser.name || ''),
      phone: liveUser.phone ? String(liveUser.phone) : '',
      linked_id: liveUser.linked_id ? String(liveUser.linked_id) : undefined,
      linked_student_ids: Array.isArray(liveUser.linked_student_ids)
        ? liveUser.linked_student_ids.map((s: unknown) => String(s)).filter(Boolean)
        : [],
    };
    return next();
  } catch {
    return res.status(503).json({
      error: 'Database service temporarily unavailable during authentication check.',
    });
  }
}

export async function authenticateOptionalToken(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = extractTokenFromRequest(req);
  if (!token) return next();
  if (await isTokenRevokedAsync(token)) return next();
  try {
    const decoded: any = jsonwebtoken.verify(token, getJwtSecret());
    if (mongoose.connection.readyState === 1) {
      const liveUser = await resolveLiveUserFromDecoded(decoded);
      if (liveUser) {
        req.user = {
          id: String(liveUser.record_id || liveUser._id),
          email: String(liveUser.email),
          role: String(liveUser.role) as any,
          name: String(liveUser.name),
          phone: liveUser.phone,
          linked_id: liveUser.linked_id,
          linked_student_ids: liveUser.linked_student_ids,
        };
      }
    }
  } catch {}
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (req.user.role === 'super_admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      error: `Access denied. Requires one of roles: ${allowedRoles.join(', ')}`,
    });
  };
}

export function requireExactRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Token missing.' });
    }

    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      error: `Access denied. Requires role: ${allowedRoles.join(', ')}`,
    });
  };
}
