import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { isProductionEnvironment } from './runtime.ts';

let envInitialized = false;

export function loadLocalEnvIfNeeded(): void {
  if (envInitialized) return;
  envInitialized = true;

  // Production deployments (e.g., Railway) inject environment variables directly via process.env
  // and must never depend on or be overridden by a local .env file.
  if (isProductionEnvironment()) {
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

}

loadLocalEnvIfNeeded();
