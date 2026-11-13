import './server/config/env.ts';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDB, closeDB, sanitizeErrorMessage } from './server/config/db.ts';
import { seedMongoFromLocal, isLocalSeedBlocked } from './server/config/seed.ts';
import { router as apiRouter } from './server/routes.ts';
import { getJwtSecret } from './server/auth.ts';
import { ensureDefaultSuperAdminIfEmpty } from './server/services/bootstrapService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const rawPort = process.env.PORT ? Number(process.env.PORT) : 3000;
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
    console.error(`[FATAL Configuration Error] Invalid PORT value "${process.env.PORT}". Must be an integer between 1 and 65535.`);
    process.exit(1);
  }
  const PORT = rawPort;
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT_NAME === 'production';

  // In production, validate critical security secrets immediately before booting
  if (isProd) {
    try {
      getJwtSecret();
    } catch (err: any) {
      console.error('[FATAL Security Error] Production JWT security validation failed:', err.message);
      process.exit(1);
    }
  }

  // Connect to MongoDB Atlas (Fresh-Start policy enforced in production and on Atlas)
  const rawMongoUri = (process.env.MONGODB_URI || '').trim();
  const disableAutoSeed = isLocalSeedBlocked();

  let atlasRetryTimer: ReturnType<typeof setInterval> | null = null;

  const startDevAtlasWatcher = () => {
    if (atlasRetryTimer || !rawMongoUri.startsWith('mongodb')) return;
    atlasRetryTimer = setInterval(async () => {
      const currentState = Number(mongoose.connection.readyState);
      if (currentState === 1 || currentState === 2) {
        return;
      }
      try {
        await connectDB();
      } catch {
        // Remains in degraded 503 state until Atlas Network Access permits connection
      }
    }, 15000);
    atlasRetryTimer.unref();
  };

  if (isProd) {
    try {
      await connectDB();
      await ensureDefaultSuperAdminIfEmpty();
      if (disableAutoSeed) {
        console.log(
          '[MongoDB] Automatic startup seed/migration skipped (Atlas/seed safety guard active).'
        );
      } else {
        await seedMongoFromLocal();
      }
    } catch (err: any) {
      console.error('[FATAL Database Security Error] Production database connection failed:', sanitizeErrorMessage(err.message));
      process.exit(1);
    }
  }

  const app = express();
  app.disable('x-powered-by');
  const rawTrustProxy = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  const trustProxySetting =
    rawTrustProxy === 'true'
      ? true
      : rawTrustProxy && !isNaN(Number(rawTrustProxy))
      ? Number(rawTrustProxy)
      : 1;
  app.set('trust proxy', trustProxySetting);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Security headers, CORS, and Preflight handling
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const origin = req.headers.origin;
    if (isProd) {
      // Allow configured origins, known Vercel institutional domains, and project preview URLs
      const allowedDefaultOrigins = [
        'https://school-college-managment-system.vercel.app',
        'https://school-college_managment-system.vercel.app',
      ];
      const configuredOrigins = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',')
            .map(o => o.trim().replace(/^['"]+|['"]+$/g, '').trim().replace(/\/+$/, '').toLowerCase())
            .filter(Boolean)
        : [];

      const normalizedOrigin = origin ? origin.trim().replace(/\/+$/, '').toLowerCase() : '';
      const isAllowedVercelOrigin =
        Boolean(normalizedOrigin) &&
        (/^https:\/\/school-college[-_]managment[-_]system.*\.vercel\.app$/i.test(normalizedOrigin) ||
          allowedDefaultOrigins.includes(normalizedOrigin));

      const isExplicitOrigin =
        Boolean(normalizedOrigin) && configuredOrigins.includes(normalizedOrigin);

      if (origin && (isExplicitOrigin || isAllowedVercelOrigin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Vary', 'Origin');
      }
    } else {
      // In development, allow local dev origin or wildcard
      res.header('Access-Control-Allow-Origin', origin || '*');
      if (origin) {
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Vary', 'Origin');
      }
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Request logger for API calls
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[API] ${req.method} ${req.path}`);
    }
    next();
  });

  // Mount API Router
  app.use('/api', apiRouter);

  // Return 404 JSON for any unmatched /api/* endpoint in both development and production
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Mongoose / MongoDB offline & global sanitized error handling middleware
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
      return res.status(400).json({ error: 'Malformed JSON request payload.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request payload exceeds maximum allowed size.' });
    }
    if (err?.name === 'MongooseError' || err?.name === 'MongoNetworkError' || (err?.message && err.message.includes('buffering timed out'))) {
      return res.status(503).json({ error: 'Service temporarily unavailable (database offline)' });
    }
    console.error('[Server Error]', sanitizeErrorMessage(err?.message || 'Unexpected error'));
    return res.status(500).json({ error: 'An unexpected internal server error occurred.' });
  });

  // Serve image assets statically with nosniff protection and strict public-media boundary on /uploads
  app.use('/src/assets', express.static(path.resolve(__dirname, 'src/assets')));
  const uploadsDir = process.env.UPLOAD_STORAGE_DIR
    ? path.resolve(process.env.UPLOAD_STORAGE_DIR)
    : path.resolve(__dirname, 'data', 'uploads');
  const privateUploadsDir = path.resolve(uploadsDir, 'private');
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(privateUploadsDir)) {
      fs.mkdirSync(privateUploadsDir, { recursive: true, mode: 0o700 });
    }
  } catch (storageErr: any) {
    console.warn(
      `[Storage Warning] Upload directory "${uploadsDir}" could not be initialized (${sanitizeErrorMessage(storageErr?.message || 'permission error')}). Verify UPLOAD_STORAGE_DIR and attached Railway Volume permissions.`
    );
  }
  const publicMediaExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  app.use(
    '/uploads',
    (req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const normalizedReqPath = decodeURIComponent(req.path || '').replace(/\\/g, '/');
      if (
        normalizedReqPath.includes('..') ||
        normalizedReqPath === '/private' ||
        normalizedReqPath.startsWith('/private/')
      ) {
        return res.status(403).json({
          error: 'Private student and admission documents are not publicly accessible.',
        });
      }
      const ext = path.extname(normalizedReqPath).toLowerCase();
      if (!publicMediaExts.has(ext)) {
        return res.status(403).json({
          error: 'Only public school media images are served at /uploads. Private documents require authenticated access.',
        });
      }
      next();
    },
    express.static(uploadsDir, { dotfiles: 'deny', index: false })
  );

  let viteInstance: any = null;
  if (!isProd) {
    // Initialize Vite asynchronously so Express binds PORT immediately without startup probe timeouts
    const indexHtmlExists = fs.existsSync(path.resolve(__dirname, 'index.html'));
    const viteReadyPromise = indexHtmlExists
      ? import('vite').then(({ createServer }) =>
          createServer({
            server: { middlewareMode: true, port: PORT, host: '0.0.0.0' },
            appType: 'spa',
          }).then(v => {
            viteInstance = v;
            return v.middlewares;
          })
        )
      : Promise.resolve(null);

    app.use(async (req, res, next) => {
      try {
        const mw = await viteReadyPromise;
        if (mw) {
          return mw(req, res, next);
        }
        next();
      } catch (err) {
        next(err);
      }
    });
  } else {
    // In production, serve built static files from dist
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) {
          return res.status(404).json({ error: 'API endpoint not found' });
        }
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    } else {
      console.warn('Dist directory does not exist. Run "npm run build" first.');
    }
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Shawan School and College server running at http://0.0.0.0:${PORT}`);
    if (!isProd) {
      startDevAtlasWatcher();
      (async () => {
        try {
          await connectDB();
          await ensureDefaultSuperAdminIfEmpty();
          if (disableAutoSeed) {
            console.log(
              '[MongoDB] Automatic startup seed/migration skipped (Atlas/seed safety guard active).'
            );
          } else {
            await seedMongoFromLocal();
          }
        } catch (err: any) {
          console.warn(
            '[MongoDB] Running in degraded 503 mode until configured MONGODB_URI becomes reachable (no local fallback):',
            sanitizeErrorMessage(err?.message || String(err))
          );
        }
      })();
    }
  });

  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] Received ${signal}. Initiating graceful shutdown...`);
    const forceTimer = setTimeout(() => {
      console.error('[Server] Forced exit after graceful shutdown timeout.');
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    if (atlasRetryTimer) {
      clearInterval(atlasRetryTimer);
      atlasRetryTimer = null;
    }
    httpServer.close(async () => {
      if (viteInstance) {
        try {
          await viteInstance.close();
        } catch {}
      }
      await closeDB();
      console.log('[Server] HTTP server and database connections closed cleanly.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch(err => {
  console.error('Fatal server startup failure:', sanitizeErrorMessage(err?.message || String(err)));
  process.exit(1);
});

