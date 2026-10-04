import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DEFAULT_FILES_MAX_UPLOAD_MB = 100;

/** FILES_MAX_UPLOAD_MB as a byte count. Anything that is not a positive number
 * falls back to the default rather than silently allowing unlimited uploads. */
function parseFilesMaxUploadBytes(raw: string | undefined): number {
  const megabytes = raw === undefined || raw.trim() === '' ? DEFAULT_FILES_MAX_UPLOAD_MB : Number(raw);
  if (!Number.isFinite(megabytes) || megabytes <= 0) {
    console.warn(`[Config] Ignoring FILES_MAX_UPLOAD_MB="${raw}" (must be a positive number of megabytes) - using ${DEFAULT_FILES_MAX_UPLOAD_MB}`);
    return DEFAULT_FILES_MAX_UPLOAD_MB * 1024 * 1024;
  }
  return Math.floor(megabytes * 1024 * 1024);
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'file:./data/ts6webui.db',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me-in-production',
  jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  tsAllowSelfSigned: process.env.TS_ALLOW_SELF_SIGNED === 'true' || process.env.TS_ALLOW_SELF_SIGNED === '1',
  // Largest single file the Files page will upload to a channel's file repository.
  filesMaxUploadBytes: parseFilesMaxUploadBytes(process.env.FILES_MAX_UPLOAD_MB),
};
