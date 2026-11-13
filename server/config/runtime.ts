/**
 * Shared deployment-mode detection.
 * Railway sets RAILWAY_ENVIRONMENT_NAME even when NODE_ENV is not set to production.
 */
export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT_NAME === 'production';
}
