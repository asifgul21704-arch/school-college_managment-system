import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

let envInitialized = false;

export function loadLocalEnvIfNeeded(): void {
  if (envInitialized) return;
  envInitialized = true;

  // Production deployments (e.g., Railway) inject environment variables directly via process.env
  // and must never depend on or be overridden by a local .env file.
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const __envFilename = fileURLToPath(import.meta.url);
  const __envDirname = path.dirname(__envFilename);
  const envPath = path.resolve(__envDirname, '../../.env');

  if (fs.existsSync(envPath)) {
    dotenv.config({
      path: envPath,
      override: true,
      quiet: true,
    });
  }

  // If running in development container where daemon holds MONGODB_URI
  if (!process.env.MONGODB_URI && fs.existsSync('/proc')) {
    try {
      const pids = fs.readdirSync('/proc').filter(p => /^\d+$/.test(p) && p !== String(process.pid));
      for (const pid of pids) {
        try {
          const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
          const entries = raw.split('\0');
          for (const entry of entries) {
            if (entry.startsWith('MONGODB_URI=') && !process.env.MONGODB_URI) {
              process.env.MONGODB_URI = entry.slice('MONGODB_URI='.length);
            }
            if (entry.startsWith('JWT_SECRET=') && !process.env.JWT_SECRET) {
              process.env.JWT_SECRET = entry.slice('JWT_SECRET='.length);
            }
          }
          if (process.env.MONGODB_URI) break;
        } catch {}
      }
    } catch {}
  }
}

loadLocalEnvIfNeeded();
