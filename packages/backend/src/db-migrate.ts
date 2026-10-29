// Container start-time database migration (replaces `prisma db push --accept-data-loss`).
// Three states, each measured rather than assumed:
//   - fresh/empty database (new install)                 -> `migrate deploy` builds everything;
//   - existing database without migration history        -> baseline it (mark the committed
//     migrations as already applied), but ONLY when it actually matches those migrations; a
//     database that has drifted is refused (FATAL), never silently baselined;
//   - database with migration history                    -> `migrate deploy` applies what is pending.
// The R3 backup (dist/db-backup.js) runs before a deploy that would really change the database,
// keeping its semantics: once per version, a failed backup stops the start like a failed migration.
// DB_MIGRATE_SKIP is an emergency escape that starts the backend without touching the database.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { applyPendingRestore, recordRestoreInChangeLog, rollbackRestore } from './db-restore.js';

export const MIGRATIONS_DIR = 'prisma/migrations';

export interface DbState {
  /** At least one real (non-Prisma) table exists. */
  hasTables: boolean;
  /** Prisma's `_prisma_migrations` bookkeeping table exists. */
  hasHistory: boolean;
  /** Migrations recorded as fully applied in `_prisma_migrations` (0 without history). */
  appliedCount: number;
}

/** Measures the database: a missing or empty file is a fresh install. */
export function inspectDb(dbFile: string): DbState {
  if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size === 0) return { hasTables: false, hasHistory: false, appliedCount: 0 };
  const db = new DatabaseSync(dbFile);
  try {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    ).map((r) => r.name);
    const hasHistory = names.includes('_prisma_migrations');
    const appliedCount = hasHistory
      ? (db.prepare('SELECT count(*) c FROM _prisma_migrations WHERE finished_at IS NOT NULL').get() as { c: number }).c
      : 0;
    return { hasTables: names.some((n) => n !== '_prisma_migrations'), hasHistory, appliedCount };
  } finally {
    db.close();
  }
}

export type Step = 'backup' | 'baseline' | 'deploy' | 'abort-drift';

/**
 * Pure decision from the measured state. `dbMatchesMigrations` (a schema diff, only consulted
 * when baselining a history-less database) says whether the existing schema matches the
 * migrations. `pending` is how many migrations `migrate deploy` would apply. The backup precedes
 * any deploy that would apply a pending migration to a populated database, counting data-only
 * migrations a schema diff would miss; a fresh install has nothing to back up, and baselining a
 * matching database changes no data.
 */
export function planMigration(state: DbState, dbMatchesMigrations: boolean, pending: number): Step[] {
  if (!state.hasTables) return ['deploy'];
  if (!state.hasHistory) return dbMatchesMigrations ? ['baseline', 'deploy'] : ['abort-drift'];
  return pending > 0 ? ['backup', 'deploy'] : ['deploy'];
}

function prisma(args: string[], capture = false) {
  return spawnSync('prisma', args, { stdio: capture ? ['ignore', 'ignore', 'ignore'] : 'inherit' });
}

/** Migration directory names, sorted — the order Prisma applies and resolves them in. */
export function migrationNames(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function run(): void {
  if (process.env.DB_MIGRATE_SKIP) {
    console.warn('[db-migrate] WARNING: DB_MIGRATE_SKIP is set - starting WITHOUT applying database migrations.');
    console.warn('[db-migrate] The schema may not match this version. This is an emergency escape; unset DB_MIGRATE_SKIP to migrate normally.');
    return;
  }

  const url = process.env.DATABASE_URL || 'file:./data/ts6webui.db';
  const dbFile = path.resolve(url.replace(/^file:/, ''));
  // A restore marked on the Backups page goes in first, so the migrations below bring it up to date.
  const restore = applyPendingRestore(dbFile);
  // If they fail, the state before the restore goes back in: the start never ends on a half-migrated restore.
  const fatal = (code: number, reason: string): never => {
    if (restore.applied) rollbackRestore(dbFile, restore.pending, restore.beforeRestore, reason);
    process.exit(code);
  };
  const state = inspectDb(dbFile);

  // Schema drift only matters when baselining a database that has no migration history yet:
  // does its schema already match the committed migrations? (diff 0 = yes, 2 = no, 1 = error).
  let dbMatchesMigrations = true;
  if (state.hasTables && !state.hasHistory) {
    const diff = prisma(['migrate', 'diff', '--from-config-datasource', '--to-migrations', MIGRATIONS_DIR, '--exit-code'], true).status;
    if (diff === 1) {
      console.error('[db-migrate] FATAL: could not compare the existing database against the migrations.');
      fatal(1, 'the database could not be compared against the migrations');
    }
    dbMatchesMigrations = diff === 0;
  }
  // Migrations `migrate deploy` would still apply. Counted from the ledger, not a schema diff, so a
  // data-only migration (DELETE/UPDATE) is backed up too. Negative (database ahead of the image) = none.
  const pending = state.hasHistory ? migrationNames().length - state.appliedCount : 0;

  for (const step of planMigration(state, dbMatchesMigrations, pending)) {
    if (step === 'backup') {
      const r = spawnSync('node', ['dist/db-backup.js'], { stdio: 'inherit' });
      if (r.status !== 0) fatal(r.status ?? 1, 'the backup before the migrations failed'); // db-backup.js has already printed why
    } else if (step === 'baseline') {
      for (const name of migrationNames()) {
        const r = prisma(['migrate', 'resolve', '--applied', name]);
        if (r.status !== 0) {
          console.error(`[db-migrate] FATAL: could not baseline migration ${name}.`);
          fatal(r.status ?? 1, `migration ${name} could not be baselined`);
        }
      }
      console.log('[db-migrate] Baselined the existing database (no migration history found) against the committed migrations.');
    } else if (step === 'abort-drift') {
      console.error('[db-migrate] FATAL: the existing database does not match the expected schema (schema drift).');
      console.error('[db-migrate] It has no migration history and cannot be baselined safely. Differences:');
      prisma(['migrate', 'diff', '--from-migrations', MIGRATIONS_DIR, '--to-config-datasource']);
      console.error('[db-migrate] Restore from data/backups/ or reconcile the schema with a migration, then restart.');
      fatal(1, 'the database does not match the expected schema');
    } else if (step === 'deploy') {
      const r = prisma(['migrate', 'deploy']);
      if (r.status !== 0) {
        console.error('[db-migrate] FATAL: migrate deploy failed. The backend will not start against a half-migrated schema.');
        fatal(r.status ?? 1, 'the migrations failed');
      }
    }
  }
  if (restore.applied) recordRestoreInChangeLog(dbFile, restore.pending, restore.beforeRestore);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
