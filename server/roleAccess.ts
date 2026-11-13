import type { UserRole } from './models/User.ts';

/** Standard authorization: super_admin inherits all allowed-role routes. */
export function hasAnyRole(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return userRole === 'super_admin' || allowedRoles.includes(userRole);
}

/** Exact authorization: no implicit super-admin bypass. */
export function hasExactRole(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(userRole);
}
