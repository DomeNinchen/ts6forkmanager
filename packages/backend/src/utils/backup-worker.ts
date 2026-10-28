// The SQLite and hashing work of a backup, in a child process of its own (see backups.ts):
// VACUUM INTO and an integrity check of a 100 MB database take seconds of synchronous work
// that must not stall the music bots, and the database has to be opened from another process,
// never from a second SQLite library inside the backend's own.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

export type BackupJob =
  | { job: 'create'; dbFile: string; target: string }
  | { job: 'inspect'; file: string; copy: string };

export interface InspectedDb {
  integrity: { ok: boolean; message: string };
  /** Applied migrations, oldest first; null without a `_prisma_migrations` table. */
  migrations: string[] | null;
  sha256: string;
  size: number;
  /** Encrypted values to try the running key on, by field. */
  encrypted: Array<{ field: string; value: string }>;
}

/** Where encrypted values live (see the encrypt() callers). A table or column an older schema lacks is skipped. */
const ENCRYPTED_COLUMNS: Array<[table: string, column: string]> = [
  ['TsServerConfig', 'apiKey'],
  ['TsServerConfig', 'botApiKey'],
  ['TsServerConfig', 'sshPassword'],
  ['User', 'totpSecret'],
  ['MusicBot', 'identityData'],
  ['AppSetting', 'value'],
];
const SAMPLES_PER_FIELD = 5;

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function inspect(dbFile: string): Omit<InspectedDb, 'sha256' | 'size'> {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
  } catch (err) {
    return { integrity: { ok: false, message: (err as Error).message }, migrations: null, encrypted: [] };
  }
  try {
    let integrity: { ok: boolean; message: string };
    try {
      const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      const message = rows.map((r) => r.integrity_check).join('; ');
      integrity = { ok: message === 'ok', message };
    } catch (err) {
      // "file is not a database", a truncated file
      return { integrity: { ok: false, message: (err as Error).message }, migrations: null, encrypted: [] };
    }
    const hasHistory = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'").get() !== undefined;
    const migrations = hasHistory
      ? (db.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name').all() as Array<{ migration_name: string }>).map((r) => r.migration_name)
      : null;
    const encrypted: InspectedDb['encrypted'] = [];
    for (const [table, column] of ENCRYPTED_COLUMNS) {
      try {
        const rows = db.prepare(`SELECT "${column}" AS v FROM "${table}" WHERE "${column}" LIKE 'enc:%' LIMIT ${SAMPLES_PER_FIELD}`).all() as Array<{ v: string }>;
        for (const r of rows) encrypted.push({ field: `${table}.${column}`, value: r.v });
      } catch {
        // not in this schema version
      }
    }
    try {
      // The SSO secret sits encrypted inside a JSON setting
      const row = db.prepare("SELECT value FROM AppSetting WHERE key = 'oidc_config'").get() as { value: string } | undefined;
      const secret = row ? JSON.parse(row.value)?.clientSecret : undefined;
      if (typeof secret === 'string' && secret.startsWith('enc:')) encrypted.push({ field: 'AppSetting.oidc_config.clientSecret', value: secret });
    } catch {
      // no such setting, or not JSON
    }
    return { integrity, migrations, encrypted };
  } finally {
    db.close();
  }
}

async function run(job: BackupJob): Promise<InspectedDb> {
  if (job.job === 'create') {
    const db = new DatabaseSync(job.dbFile);
    try {
      // The app may be writing; wait for a lock rather than failing at once.
      db.exec('PRAGMA busy_timeout = 10000');
      // Reads through the WAL: a consistent copy while the backend keeps running.
      db.prepare('VACUUM INTO ?').run(job.target);
    } finally {
      db.close();
    }
    const checked = inspect(job.target);
    return { ...checked, sha256: await sha256(job.target), size: fs.statSync(job.target).size };
  }
  // A copy is checked, never the backup itself: opening a database can leave -wal/-shm files beside it.
  fs.copyFileSync(job.file, job.copy);
  const checked = inspect(job.copy);
  return { ...checked, sha256: await sha256(job.file), size: fs.statSync(job.file).size };
}

// Started by backups.ts with an IPC channel: one job in, one answer out, then the process ends.
if (process.send) {
  process.once('message', (job: BackupJob) => {
    run(job).then(
      (result) => process.send!({ ok: true, result }, () => process.disconnect()),
      (err: Error) => process.send!({ ok: false, error: err.message }, () => process.disconnect()),
    );
  });
}
