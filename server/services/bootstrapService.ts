import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  UserModel,
  toUserDto,
  type UserDto,
  DataMigrationModel,
  AuditLogModel,
} from '../models/index.ts';
import { validateEmail } from '../auth.ts';

export const SUPER_ADMIN_BOOTSTRAP_LOCK_KEY = 'production_super_admin_bootstrap_v1';

export class BootstrapValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapValidationError';
  }
}

export class BootstrapForbiddenError extends Error {
  statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapForbiddenError';
  }
}

export class BootstrapConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapConflictError';
  }
}

export function validateBootstrapPasswordStrength(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Bootstrap password is required.' };
  }
  if (password.length < 12) {
    return {
      valid: false,
      message: 'Super Admin bootstrap password must be at least 12 characters long.',
    };
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return {
      valid: false,
      message:
        'Super Admin bootstrap password must include uppercase, lowercase, numeric, and special characters.',
    };
  }
  return { valid: true };
}

export function verifyBootstrapSecretConstantTime(providedSecret: unknown): boolean {
  const configured = String(process.env.BOOTSTRAP_SECRET || '').trim();
  if (!configured || configured.length < 32) {
    return false;
  }
  if (typeof providedSecret !== 'string' || !providedSecret.trim()) {
    return false;
  }
  const digestConfigured = crypto.createHash('sha256').update(configured).digest();
  const digestProvided = crypto.createHash('sha256').update(providedSecret.trim()).digest();
  return crypto.timingSafeEqual(digestConfigured, digestProvided);
}

/**
 * Atomically creates the single initial Super Admin account on a fresh database.
 * Cannot create duplicate Super Admin accounts under sequential or concurrent calls.
 * Never logs or returns passwords, hashes, or bootstrap secrets.
 */
export async function bootstrapInitialSuperAdmin(params: {
  email: string;
  password: string;
  name: string;
  phone?: string;
  source: 'cli' | 'api';
  ipAddress?: string;
}): Promise<UserDto> {
  const cleanEmail = String(params.email || '').trim().toLowerCase();
  const cleanName = String(params.name || '').trim();
  const cleanPhone = params.phone ? String(params.phone).trim().slice(0, 40) : '';

  if (!validateEmail(cleanEmail)) {
    throw new BootstrapValidationError('A valid Super Admin email address is required.');
  }
  if (cleanName.length < 2) {
    throw new BootstrapValidationError('Super Admin full name is required (minimum 2 characters).');
  }
  const strength = validateBootstrapPasswordStrength(params.password);
  if (!strength.valid) {
    throw new BootstrapValidationError(strength.message || 'Weak bootstrap password.');
  }

  const existingSuperAdminCount = await UserModel.countDocuments({ role: 'super_admin' });
  if (existingSuperAdminCount > 0) {
    throw new BootstrapConflictError(
      'Super Admin bootstrap denied: a super_admin account already exists in this database.'
    );
  }

  const existingEmailCount = await UserModel.countDocuments({ email: cleanEmail });
  if (existingEmailCount > 0) {
    throw new BootstrapConflictError('An account with this email address already exists.');
  }

  // Acquire atomic database lock via unique index on DataMigrationModel.module_name
  let lockAcquired = false;
  try {
    await DataMigrationModel.create({
      module_name: SUPER_ADMIN_BOOTSTRAP_LOCK_KEY,
      migrated_keys: ['initial_super_admin'],
      last_run_at: new Date(),
    });
    lockAcquired = true;
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new BootstrapConflictError(
        'Super Admin bootstrap has already been completed. Duplicate Super Admin bootstrap is prohibited.'
      );
    }
    throw err;
  }

  try {
    // Double-check after acquiring lock
    const recheckCount = await UserModel.countDocuments({ role: 'super_admin' });
    if (recheckCount > 0) {
      throw new BootstrapConflictError(
        'Super Admin bootstrap denied: a super_admin account already exists in this database.'
      );
    }

    const passwordHash = await bcrypt.hash(params.password, 12);
    const created = await UserModel.create({
      record_id: 'usr_super_admin_1',
      email: cleanEmail,
      password_hash: passwordHash,
      name: cleanName,
      role: 'super_admin',
      phone: cleanPhone,
      status: 'active',
    });

    const dto = toUserDto(created);

    await AuditLogModel.create({
      user_id: dto.id,
      user_name: dto.name,
      role: 'super_admin',
      action: 'Bootstrapped Initial Super Admin',
      entity: 'User',
      entity_id: dto.id,
      details: `One-time initial Super Admin bootstrap completed via ${params.source.toUpperCase()}`,
      ip_address: params.ipAddress || '',
      created_at: new Date(),
    }).catch(() => {});

    return dto;
  } catch (err) {
    if (lockAcquired) {
      const anySuperAdmin = await UserModel.countDocuments({ role: 'super_admin' }).catch(() => 1);
      if (anySuperAdmin === 0) {
        await DataMigrationModel.deleteOne({ module_name: SUPER_ADMIN_BOOTSTRAP_LOCK_KEY }).catch(() => {});
      }
    }
    throw err;
  }
}
