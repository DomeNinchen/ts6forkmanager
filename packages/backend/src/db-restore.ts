// Puts a backup in place of the database (R7). The Backups page only marks a restore as pending
// (data/backups/restore-pending.json) and restarts the backend; db-migrate.ts calls this at the
// next start, before it migrates and before the backend opens the database. Own process, nothing
// else has the database open. Built so that a crash at any point leaves either the old or the
// restored database, never a mix:
//   1. a copy of the current state ("before-restore"), recorded in the pending file so a rerun
//      after a crash does not overwrite it with the half-way state,
//   2. the backup copied next to the database under a temp name,
//   3. the current database checkpointed (its WAL folded in), then -wal/-shm removed: a stale WAL
//      would otherwise be replayed onto the restored file,
//   4. one rename: the switch,
//   5. sessions and trusted devices dropped (decision B), the pending file removed, the result
//      written for the Backups page.
// If the migrations that follow fail, rollbackRestore() puts the before-restore copy back the same way.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PENDING_FILE = 'restore-pending.json';
export const RESULT_FILE = 'restore-result.json';

export interface PendingRestore {
  /** Path of the backup relative to data/backups/ (e.g. "managed/ts6webui-...-manual.db"). */
  file: string;
  sha256: string;
  requestedBy: string;
  /** ISO 8601. */
  requestedAt: string;
  /** Set once the copy of the current state exists: a rerun after a crash keeps that one. */
  beforeRestore?: string;
}

export interface RestoreResult {
  at: string;
  ok: boolean;
  /** The backup that was (to be) restored, relative to data/backups/. */
  file: string;
  requestedBy: string;
  /** Name of the copy of the state before, in data/backups/managed/. */
  beforeRestore: string | null;
  /** The restore ran but the migrations after it failed, and the state before was put back. */
  rolledBack: boolean;
  error: string | null;
}

export function backupsDirOf(dbFile: string): string {
  return path.join(path.dirname(dbFile), 'backups');
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** Written to a temp name and renamed, readable by the backend user only. */
function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

export function readPending(dbFile: string): PendingRestore | null {
  return readJson<PendingRestore>(path.join(backupsDirOf(dbFile), PENDING_FILE));
}

export function writePending(dbFile: string, pending: PendingRestore): void {
  writeJson(path.join(backupsDirOf(dbFile), PENDING_FILE), pending);
}

export function clearPending(dbFile: string): void {
  fs.rmSync(path.join(backupsDirOf(dbFile), PENDING_FILE), { force: true });
}

export function readResult(dbFile: string): RestoreResult | null {
  return readJson<RestoreResult>(path.join(backupsDirOf(dbFile), RESULT_FILE));
}

function writeResult(dbFile: string, result: RestoreResult): void {
  writeJson(path.join(backupsDirOf(dbFile), RESULT_FILE), result);
}

export function sha256File(file: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** Applied migrations of a database, oldest first. */
function migrationsOf(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name').all() as Array<{ migration_name: string }>).map((r) => r.migration_name);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** A complete copy of the live database (WAL included) into managed/, with the manifest the Backups page reads. */
function copyCurrentState(dbFile: string, requestedBy: string, now: Date): string {
  const managed = path.join(backupsDirOf(dbFile), 'managed');
  fs.mkdirSync(managed, { recursive: true, mode: 0o700 });
  const stem = path.basename(dbFile, path.extname(dbFile));
  const name = `${stem}-${now.toISOString().replace(/[:.]/g, '-')}-before-restore.db`;
  const tmp = path.join(managed, `.${name}.tmp`);
  const db = new DatabaseSync(dbFile);
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  } finally {
    db.close();
  }
  fs.chmodSync(tmp, 0o600);
  const version = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8')).version as string;
    } catch {
      return 'unknown';
    }
  })();
  writeJson(path.join(managed, `${name.slice(0, -3)}.json`), {
    format: 1,
    createdAt: now.toISOString(),
    kind: 'before-restore',
    backendVersion: version,
    migrations: migrationsOf(tmp),
    sha256: sha256File(tmp),
    size: fs.statSync(tmp).size,
    integrity: 'ok',
    createdBy: requestedBy,
  });
  fs.renameSync(tmp, path.join(managed, name));
  return name;
}

/** Steps 2-4: `source` replaces the database in one rename. */
function swapIn(dbFile: string, source: string): void {
  const tmp = `${dbFile}.restore-tmp`;
  fs.copyFileSync(source, tmp);
  const fd = fs.openSync(tmp, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(dbFile)) {
    // Fold the WAL into the file so removing it loses nothing even if we stop right here.
    const db = new DatabaseSync(dbFile);
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
  }
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
  fs.renameSync(tmp, dbFile);
}

/** Everybody signs in again: sessions and remembered devices of the restored state would otherwise come back to life. */
function dropSessions(dbFile: string): void {
  const db = new DatabaseSync(dbFile);
  try {
    for (const table of ['RefreshToken', 'TrustedDevice']) {
      try {
        db.exec(`DELETE FROM "${table}"`);
      } catch {
        // not in this schema version
      }
    }
  } finally {
    db.close();
  }
}

export type RestoreStep = 'copied-current' | 'swapped';

/**
 * Applies a pending restore, if there is one. Returns what was done; never throws for a problem
 * with the backup itself (the result file says why and the start goes on with the current
 * database). `afterStep` lets a test stop at a step, the way a crash would.
 */
export function applyPendingRestore(
  dbFile: string,
  now = new Date(),
  afterStep: (step: RestoreStep) => void = () => {},
): { applied: false } | { applied: true; pending: PendingRestore; beforeRestore: string | null } {
  const pending = readPending(dbFile);
  if (!pending) return { applied: false };
  const fail = (error: string, beforeRestore: string | null = pending.beforeRestore ?? null) => {
    console.error(`[db-restore] The restore of ${pending.file} was not applied: ${error}`);
    clearPending(dbFile);
    writeResult(dbFile, { at: now.toISOString(), ok: false, file: pending.file, requestedBy: pending.requestedBy, beforeRestore, rolledBack: false, error });
    return { applied: false as const };
  };

  const source = path.resolve(backupsDirOf(dbFile), pending.file);
  if (!source.startsWith(backupsDirOf(dbFile) + path.sep)) return fail('the backup is outside data/backups');
  if (!fs.existsSync(source)) return fail('the backup file is gone');
  if (sha256File(source) !== pending.sha256) return fail('the backup file changed after it was checked');

  let beforeRestore = pending.beforeRestore && fs.existsSync(path.join(backupsDirOf(dbFile), 'managed', pending.beforeRestore)) ? pending.beforeRestore : null;
  const hasDb = fs.existsSync(dbFile) && fs.statSync(dbFile).size > 0;
  if (!beforeRestore && hasDb) {
    try {
      beforeRestore = copyCurrentState(dbFile, pending.requestedBy, now);
    } catch (err) {
      // No copy of the current state, no restore: nothing has been touched yet.
      return fail(`the current state could not be saved first (${(err as Error).message})`, null);
    }
    writePending(dbFile, { ...pending, beforeRestore });
    console.log(`[db-restore] Current state saved as ${beforeRestore}`);
  }
  afterStep('copied-current');

  swapIn(dbFile, source);
  afterStep('swapped');
  dropSessions(dbFile);
  clearPending(dbFile);
  writeResult(dbFile, { at: now.toISOString(), ok: true, file: pending.file, requestedBy: pending.requestedBy, beforeRestore, rolledBack: false, error: null });
  console.log(`[db-restore] Restored ${pending.file} (requested by ${pending.requestedBy}); everybody has to sign in again.`);
  return { applied: true, pending, beforeRestore };
}

/** The migrations after a restore failed: the state before goes back in, the same way. */
export function rollbackRestore(dbFile: string, pending: PendingRestore, beforeRestore: string | null, error: string, now = new Date()): void {
  if (beforeRestore) {
    swapIn(dbFile, path.join(backupsDirOf(dbFile), 'managed', beforeRestore));
    console.error(`[db-restore] The database was put back to the state before the restore (${beforeRestore}).`);
  }
  writeResult(dbFile, { at: now.toISOString(), ok: false, file: pending.file, requestedBy: pending.requestedBy, beforeRestore, rolledBack: beforeRestore !== null, error });
}

/** The change log of the restored database gets the restore itself (the request was logged in the database it replaced). */
export function recordRestoreInChangeLog(dbFile: string, pending: PendingRestore, beforeRestore: string | null, now = new Date()): void {
  try {
    const db = new DatabaseSync(dbFile);
    try {
      db.prepare(`INSERT INTO UiChangeLog (createdAt, username, role, method, area, routePattern, body, status, httpStatus, durationMs, loggedToTeamSpeak)
        VALUES (?, ?, 'admin', 'POST', 'backups', '/backups (restore applied at start)', ?, 'ok', 200, 0, 0)`)
        .run(now.toISOString().replace('Z', '+00:00'), pending.requestedBy, JSON.stringify({ backup: pending.file, beforeRestore }));
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(`[db-restore] Could not record the restore in the change log: ${(err as Error).message}`);
  }
}
