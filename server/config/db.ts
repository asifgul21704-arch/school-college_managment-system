import './env.ts';
import mongoose from 'mongoose';

export interface MongoConnectionStatus {
  connected: boolean;
  state: 'connected' | 'connecting' | 'disconnected' | 'error';
  isAtlas: boolean;
  databaseName: string;
  host: string;
  uriMasked: string;
  error?: string;
  latencyMs?: number;
  collectionsCount?: number;
  collections?: { name: string; count: number }[];
  lastChecked: string;
}

let isInitialized = false;
let listenersAttached = false;
let memoryServerInstance: any = null;
let lastAtlasFallbackError = '';
let lastLoggedAtlasError = '';

function ensureConnectionListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on('connected', () => {
    lastAtlasFallbackError = '';
  });
  mongoose.connection.on('error', (err: any) => {
    if (err?.message) {
      lastAtlasFallbackError = sanitizeErrorMessage(err.message);
    }
  });
  mongoose.connection.on('disconnected', () => {
    if (!lastAtlasFallbackError && process.env.MONGODB_URI?.trim()) {
      lastAtlasFallbackError =
        'MongoDB Atlas connection was interrupted. Automatic reconnection is in progress.';
    }
  });
}

export function getLastAtlasFallbackError(): string {
  return lastAtlasFallbackError;
}

/**
 * Mask sensitive credentials from Mongo URI for safe display and logging
 */
export function maskMongoUri(uri: string): string {
  if (!uri) return 'Not Configured';
  try {
    return uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  } catch {
    return 'Masked Mongo URI';
  }
}

export function extractConfiguredDbName(uri?: string): string {
  const raw = (uri ?? process.env.MONGODB_URI ?? '').trim();
  if (!raw) return 'shawan_school';
  try {
    const withoutProto = raw.replace(/^mongodb(\+srv)?:\/\//i, '');
    const afterAuth = withoutProto.includes('@')
      ? withoutProto.slice(withoutProto.lastIndexOf('@') + 1)
      : withoutProto;
    const slashIdx = afterAuth.indexOf('/');
    if (slashIdx === -1) return 'shawan_school';
    const dbSegment = afterAuth.slice(slashIdx + 1).split('?')[0].trim();
    if (!dbSegment) return 'shawan_school';
    try {
      return decodeURIComponent(dbSegment);
    } catch {
      return dbSegment;
    }
  } catch {
    return 'shawan_school';
  }
}

/**
 * Strips sensitive connection strings and credentials from error messages
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return '';
  let clean = String(message)
    .replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@[^\s"']+/gi, 'mongodb$1://***:***@masked-host')
    .replace(/\r?\n\s+at\s+[\s\S]*$/g, '');
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret && jwtSecret.length >= 8) {
    clean = clean.split(jwtSecret).join('[REDACTED]');
  }
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey && geminiKey.length >= 8) {
    clean = clean.split(geminiKey).join('[REDACTED]');
  }
  return clean;
}

/**
 * Connect to MongoDB Atlas (or fallback embedded Mongo instance in development) using Mongoose.
 * In production mode, connecting to real MongoDB Atlas is strictly required and in-memory fallback is disabled.
 */
export async function connectDB(): Promise<typeof mongoose> {
  const customUri = process.env.MONGODB_URI?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  // If already connected, return mongoose
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  // Prevent multiple simultaneous connection attempts
  if (mongoose.connection.readyState === 2) {
    return mongoose;
  }

  ensureConnectionListeners();
  mongoose.set('strictQuery', false);
  mongoose.set('bufferCommands', false); // Fail fast, do not hang on offline DB

  if (isProduction) {
    if (!customUri || !customUri.startsWith('mongodb')) {
      throw new Error(
        '[Database Security] In production mode (NODE_ENV=production), MONGODB_URI is strictly required and must point to a persistent MongoDB Atlas cluster. Ephemeral in-memory database fallback is strictly disabled in production.'
      );
    }

    try {
      const maxPoolSize = Math.max(2, Number(process.env.MONGO_MAX_POOL_SIZE) || 20);
      const minPoolSize = Math.max(1, Math.min(maxPoolSize, Number(process.env.MONGO_MIN_POOL_SIZE) || 2));
      console.log(`[MongoDB] Connecting to MongoDB Atlas cluster at: ${maskMongoUri(customUri)}`);
      await mongoose.connect(customUri, {
        maxPoolSize,
        minPoolSize,
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 45000,
      });
      console.log(`[MongoDB] Connected successfully to MongoDB Atlas database: "${mongoose.connection.name}"`);
      isInitialized = true;
      return mongoose;
    } catch (err: any) {
      const sanitizedError = sanitizeErrorMessage(err.message);
      console.error(`[Database Security] Failed to connect to MongoDB Atlas in production: ${sanitizedError}`);
      throw new Error(
        `[Database Security] Failed to connect to MongoDB Atlas cluster in production: ${sanitizedError}. Ephemeral in-memory database fallback is strictly disabled in production.`
      );
    }
  }

  // Non-production environment WITH explicit MONGODB_URI configured:
  // Never silently fall back to MongoMemoryServer or a local database when an explicit URI is configured.
  if (customUri && customUri.startsWith('mongodb')) {
    try {
      const maxPoolSize = Math.max(2, Number(process.env.MONGO_MAX_POOL_SIZE) || 20);
      const minPoolSize = Math.max(1, Math.min(maxPoolSize, Number(process.env.MONGO_MIN_POOL_SIZE) || 2));
      if (!isInitialized) {
        console.log(`[MongoDB] Connecting to configured MongoDB cluster at: ${maskMongoUri(customUri)}`);
      }
      await mongoose.connect(customUri, {
        maxPoolSize,
        minPoolSize,
        connectTimeoutMS: 5000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      console.log(`[MongoDB] Connected successfully to MongoDB database: "${mongoose.connection.name}"`);
      lastAtlasFallbackError = '';
      lastLoggedAtlasError = '';
      isInitialized = true;
      return mongoose;
    } catch (err: any) {
      lastAtlasFallbackError = sanitizeErrorMessage(err?.message || 'Atlas connection failed');
      if (lastAtlasFallbackError !== lastLoggedAtlasError) {
        lastLoggedAtlasError = lastAtlasFallbackError;
        console.warn(`[MongoDB Atlas] Connection to configured MONGODB_URI deferred (silent local fallback disabled): ${lastAtlasFallbackError}`);
      }
      throw new Error(lastAtlasFallbackError);
    }
  }

  // Development-only fallback ONLY when MONGODB_URI is not configured at all
  try {
    if (!memoryServerInstance) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServerInstance = await MongoMemoryServer.create({
        instance: {
          port: 27017,
          dbName: 'shawan_school',
        },
      });
    }
    const memUri = memoryServerInstance.getUri('shawan_school');
    console.log(`[MongoDB] No MONGODB_URI configured; starting local development MongoDB engine (Database: shawan_school)`);
    await mongoose.connect(memUri);
    console.log(`[MongoDB] Successfully connected Mongoose to MongoDB engine at "${mongoose.connection.name}"`);
    isInitialized = true;
    return mongoose;
  } catch (err: any) {
    console.error('[MongoDB] Failed to initialize embedded MongoDB engine:', sanitizeErrorMessage(err.message));
    throw err;
  }
}

/**
 * Get comprehensive MongoDB live server status and collection statistics
 */
export async function getMongoStatus(): Promise<MongoConnectionStatus> {
  const readyState = mongoose.connection.readyState;
  const customUri = process.env.MONGODB_URI || '';
  const activeHost = String(mongoose.connection.host || '');
  const isAtlas =
    readyState === 1
      ? activeHost.includes('.mongodb.net')
      : customUri.includes('mongodb+srv') || customUri.includes('.mongodb.net');

  let latencyMs = 0;
  let collections: { name: string; count: number }[] = [];
  let pingVerified = false;
  let pingError: string | undefined;

  if (readyState === 1 && mongoose.connection.db) {
    try {
      const start = Date.now();
      await mongoose.connection.db.admin().ping();
      latencyMs = Date.now() - start;
      pingVerified = true;

      const collList = await mongoose.connection.db.listCollections().toArray();
      for (const col of collList) {
        try {
          const count = await mongoose.connection.db.collection(col.name).countDocuments();
          collections.push({ name: col.name, count });
        } catch {
          collections.push({ name: col.name, count: 0 });
        }
      }
    } catch (e: any) {
      pingVerified = false;
      pingError = sanitizeErrorMessage(e?.message || 'Database ping failed');
      console.warn('[MongoDB Status Check]:', pingError);
    }
  }

  const isConnected = readyState === 1 && pingVerified;
  const fallbackErr = !isConnected ? pingError || lastAtlasFallbackError || undefined : undefined;

  return {
    connected: isConnected,
    state: isConnected ? 'connected' : pingError ? 'error' : readyState === 2 ? 'connecting' : 'disconnected',
    isAtlas,
    databaseName: mongoose.connection.name || extractConfiguredDbName(customUri),
    host: mongoose.connection.host || (isAtlas ? 'atlas-cluster (unreachable)' : 'localhost:27017'),
    uriMasked: customUri ? maskMongoUri(customUri) : 'mongodb://localhost:27017/shawan_school (Local Engine)',
    ...(fallbackErr ? { error: fallbackErr } : {}),
    latencyMs,
    collectionsCount: collections.length,
    collections,
    lastChecked: new Date().toISOString(),
  };
}

/**
 * Cleanly closes Mongoose connection pool and any development embedded server on shutdown.
 */
export async function closeDB(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
  } catch (err: any) {
    console.warn('[MongoDB] Error closing Mongoose connection:', sanitizeErrorMessage(err?.message || 'close error'));
  }
  if (memoryServerInstance) {
    try {
      await memoryServerInstance.stop();
    } catch {}
    memoryServerInstance = null;
  }
  isInitialized = false;
}

