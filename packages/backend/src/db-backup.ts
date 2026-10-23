// Copies the SQLite database into data/backups/ before the container's schema sync
// (Dockerfile.backend CMD runs `node dist/db-backup.js` when the sync would change the schema).
// Own process, before the backend starts: nothing else has the database open.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_KEEP = 5;

/** `ts6webui-2026-10-23T12-00-00-000Z-before-2.71.0.db`: sorts by time, names the version that was about to start. */
export function backupFileName(dbFile: string, version: string, now: Date): string {
  const stem = path.basename(dbFile, path.extname(dbFile));
  return `${stem}-${now.toISOString().replace(/[:.]/g, '-')}-before-${version}.db`;
}

/** Backups (and temp files of interrupted runs) beyond the newest `keep`, oldest first. */
export function backupsToDelete(names: string[], dbFile: string, keep: number): string[] {
  const stem = path.basename(dbFile, path.extname(dbFile));
  const ours = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}T.*\\.db$`);
  const backups = names.filter((n) => ours.test(n)).sort();
  const stale = names.filter((n) => /^\..+\.tmp$/.test(n) && ours.test(n.slice(1, -4)));
  return [...stale, ...backups.slice(0, Math.max(0, backups.length - keep))];
}

export function parseKeep(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_KEEP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.warn(`[db-backup] DB_BACKUP_KEEP=${raw} is not a whole number of at least 1, keeping ${DEFAULT_KEEP}`);
    return DEFAULT_KEEP;
  }
  return n;
}

/** Writes a consistent copy (WAL contents included) and prunes old ones. Returns the backup and whether it was just written, or null without a database. */
export function backupDatabase(dbFile: string, version: string, keep: number, now = new Date()): { file: string; created: boolean } | null {
  // Empty on a first start: `prisma migrate diff` has just created the file.
  if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size === 0) return null;
  const dir = path.join(path.dirname(dbFile), 'backups');
  // A failed sync restarts the container with the schema still different (and db push may have
  // applied part of it): the copy from before the first attempt is the one to keep, not rotate out.
  const stem = path.basename(dbFile, path.extname(dbFile));
  const earlier = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((n) => n.startsWith(`${stem}-`) && n.endsWith(`-before-${version}.db`)).sort()
    : [];
  if (earlier.length > 0) return { file: path.join(dir, earlier[0]), created: false };
  // Password hashes, refresh tokens, encrypted credentials: readable by the backend user only.
  const oldMask = process.umask(0o077);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const name = backupFileName(dbFile, version, now);
    const tmp = path.join(dir, `.${name}.tmp`);
    const db = new DatabaseSync(dbFile);
    try {
      // VACUUM INTO reads through the WAL a crash may have left behind; the temp name keeps a half-written file from counting as a backup.
      db.prepare('VACUUM INTO ?').run(tmp);
    } catch (err) {
      // SQLite leaves the partial copy behind (a full disk, say); it would only take the space a retry needs.
      fs.rmSync(tmp, { force: true });
      throw err;
    } finally {
      db.close();
    }
    fs.chmodSync(tmp, 0o600);
    const target = path.join(dir, name);
    fs.renameSync(tmp, target);
    for (const old of backupsToDelete(fs.readdirSync(dir), dbFile, keep)) fs.rmSync(path.join(dir, old), { force: true });
    return { file: target, created: true };
  } finally {
    process.umask(oldMask);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Same default as prisma.config.ts, relative to the backend directory the container starts in.
  const url = process.env.DATABASE_URL || 'file:./data/ts6webui.db';
  const dbFile = path.resolve(url.replace(/^file:/, ''));
  const version = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8')).version as string;
  try {
    const backup = backupDatabase(dbFile, version, parseKeep(process.env.DB_BACKUP_KEEP));
    if (!backup) console.log(`[db-backup] No database at ${dbFile} yet, nothing to back up`);
    else if (backup.created) console.log(`[db-backup] Database backed up to ${backup.file}`);
    else console.log(`[db-backup] Keeping the backup taken before the first start of ${version}: ${backup.file}`);
  } catch (err) {
    console.error(`[db-backup] FATAL: could not back up ${dbFile} before the schema sync: ${(err as Error).message}`);
    console.error('[db-backup] The schema sync was not run. Free space on the backend-data volume or fix the permissions of its backups/ folder, then restart.');
    process.exit(1);
  }
}
