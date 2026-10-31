// A backup before a deletion that a TeamSpeak snapshot can bring back (R9 stage 3): server and
// channel groups, channels, client profiles. A snapshot holds those, but no bans, icons, kicks or
// moves (measured on TS6), so the other bulk actions get no backup step. The backup is the
// manager's database plus a snapshot of the one virtual server, kind `before-bulk`.
import type { Request } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { AppError } from '../middleware/error-handler.js';
import { createBackup, getBackupSettings } from './backups.js';

/** A page deletes several groups as parallel requests: they share the first one's backup instead of writing one each. */
export const REUSE_MS = 2 * 60_000;

const inFlight = new Map<string, Promise<string>>();
const recent = new Map<string, { name: string; at: number }>();

const keyOf = (configId: number, sid: number) => `${configId}:${sid}`;

/**
 * A before-bulk backup of this virtual server: the one being written, one taken in the last two
 * minutes (unless `fresh`: a dialog's own request wants the state as it is now), or a new one.
 */
export async function ensureBulkBackup(prisma: PrismaClient, pool: ConnectionPool | undefined, configId: number, sid: number, by: string, now = Date.now(), fresh = false): Promise<string> {
  const key = keyOf(configId, sid);
  const last = recent.get(key);
  if (!fresh && last && now - last.at < REUSE_MS) return last.name;
  const running = inFlight.get(key);
  if (running) return running;
  const job = createBackup(prisma, 'before-bulk', by, new Date(now), pool, { configId, sid })
    .then((entry) => {
      recent.set(key, { name: entry.name, at: now });
      return entry.name;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/**
 * Called by a deleting route right before it deletes. Backs up first when the deletion is always
 * backed up (`count` omitted: a group or a channel) or deletes at least the threshold's number of
 * profiles. A failed backup refuses the deletion (409 BACKUP_FAILED); the dialog can then send
 * `skipBackup: true`, which the change log keeps with the request.
 */
export async function backupBeforeDeleting(req: Request, count?: number): Promise<void> {
  if (req.body?.skipBackup === true) return;
  const prisma = req.app.locals.prisma as PrismaClient;
  if (count !== undefined && count < (await getBackupSettings(prisma)).bulkBackupThreshold) return;
  try {
    await ensureBulkBackup(prisma, req.app.locals.connectionPool, Number(req.params.configId), Number(req.params.sid), req.user?.username ?? 'unknown');
  } catch (err) {
    const reason = err instanceof AppError && err.details ? `${err.message}: ${err.details}` : (err as Error).message;
    throw new AppError(409, 'The backup before this deletion failed, so nothing was deleted', reason, 'BACKUP_FAILED');
  }
}

/** For tests. */
export function resetBulkBackups(): void {
  inFlight.clear();
  recent.clear();
}
