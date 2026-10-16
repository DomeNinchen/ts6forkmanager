import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTrustProxy } from './utils/trust-proxy.js';

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

const DEFAULT_REFRESH_EXPIRY = '7d';
const EXPIRY_UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** JWT_REFRESH_EXPIRY in milliseconds: a whole number with s, m, h, d or w ("7d", "12h"), the
 * form JWT_ACCESS_EXPIRY uses too. Anything else falls back to 7 days instead of letting refresh
 * tokens expire at once or never. */
export function parseRefreshExpiryMs(raw: string | undefined): number {
  const match = (raw === undefined || raw.trim() === '' ? DEFAULT_REFRESH_EXPIRY : raw.trim()).match(/^(\d+)\s*([smhdw])$/i);
  const ms = match ? Number(match[1]) * EXPIRY_UNIT_MS[match[2].toLowerCase()] : 0;
  if (ms > 0) return ms;
  console.warn(`[Config] Ignoring JWT_REFRESH_EXPIRY="${raw}" (must be a number with s, m, h, d or w, e.g. 7d) - using ${DEFAULT_REFRESH_EXPIRY}`);
  return 7 * EXPIRY_UNIT_MS.d;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'file:./data/ts6webui.db',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me-in-production',
  jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  // How long a login lasts without use: every refresh starts this period again
  jwtRefreshExpiryMs: parseRefreshExpiryMs(process.env.JWT_REFRESH_EXPIRY),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  tsAllowSelfSigned: process.env.TS_ALLOW_SELF_SIGNED === 'true' || process.env.TS_ALLOW_SELF_SIGNED === '1',
  // Largest single file the Files page will upload to a channel's file repository.
  filesMaxUploadBytes: parseFilesMaxUploadBytes(process.env.FILES_MAX_UPLOAD_MB),
  // How many proxies (or which addresses) in front of the backend may vouch for the
  // visitor's address in X-Forwarded-For; see utils/trust-proxy.ts.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // Emergency switch: with IP_BANS_DISABLED=true no address is turned away, whatever the
  // ban list says - for the day an admin has banned the address they come in from.
  ipBansDisabled: process.env.IP_BANS_DISABLED === 'true' || process.env.IP_BANS_DISABLED === '1',
};

if (config.trustProxy.warning) console.warn(`[Config] ${config.trustProxy.warning}`);
