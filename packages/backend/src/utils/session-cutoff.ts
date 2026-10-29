import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Written by a restore (db-restore.ts, ms since the epoch): every login issued before it belongs
 * to the database that was replaced, so its access token is refused too, not only its refresh
 * token - otherwise sessions of the replaced state would live on until the token expires.
 */
export const SESSION_CUTOFF_KEY = 'sessions_valid_after';

let cutoffSeconds = 0;

/** Read once at start: a restore, the only thing that sets it, is applied before the backend starts. */
export async function loadSessionCutoff(prisma: PrismaClient): Promise<void> {
  const row = await prisma.appSetting.findUnique({ where: { key: SESSION_CUTOFF_KEY } });
  const ms = Number(row?.value);
  cutoffSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

/** A token's `iat` (seconds) from before the last restore. */
export function issuedBeforeCutoff(iat: number | undefined): boolean {
  return cutoffSeconds > 0 && (iat ?? 0) < cutoffSeconds;
}
