import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB, closeDB, sanitizeErrorMessage } from '../server/config/db.ts';
import { bootstrapInitialSuperAdmin } from '../server/services/bootstrapService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: !process.env.PORT || process.env.PORT === '3000',
});

async function main() {
  const email = String(process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || '').trim();
  const password = String(process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || '');
  const name = String(process.env.BOOTSTRAP_SUPER_ADMIN_NAME || 'Principal / Super Admin').trim();
  const phone = String(process.env.BOOTSTRAP_SUPER_ADMIN_PHONE || '').trim();

  if (!email || !password) {
    console.error(
      '[Bootstrap Aborted] BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD environment variables are required.'
    );
    process.exit(1);
  }

  try {
    await connectDB();
    const dto = await bootstrapInitialSuperAdmin({
      email,
      password,
      name,
      phone,
      source: 'cli',
    });
    console.log(
      JSON.stringify(
        {
          success: true,
          message: 'Initial Super Admin created successfully on fresh database.',
          databaseName: mongoose.connection.name,
          user: {
            id: dto.id,
            email: dto.email,
            name: dto.name,
            role: dto.role,
            status: dto.status,
          },
        },
        null,
        2
      )
    );
    await closeDB();
    process.exit(0);
  } catch (err: any) {
    console.error(
      '[Bootstrap Failed]',
      sanitizeErrorMessage(err?.message || 'Unable to bootstrap Super Admin')
    );
    await closeDB().catch(() => {});
    process.exit(1);
  }
}

main();
