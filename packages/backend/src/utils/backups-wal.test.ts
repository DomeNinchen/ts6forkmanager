import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createBackup } from './backups.js';

// The backend writes through Prisma's better-sqlite3, a SQLite library of its own. A backup must
// never touch that connection's WAL: SQLite's file locks are per process, so a second SQLite
// library in the same process takes the WAL for unused when it closes, folds it in and deletes
// it, and the backend goes on writing into a file nobody else can see (lost on a crash, missing
// from every later backup).
const requireFromAdapter = createRequire(createRequire(import.meta.url).resolve('@prisma/adapter-better-sqlite3'));
const BetterSqlite3 = requireFromAdapter('better-sqlite3') as new (file: string) => {
  pragma(sql: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown };
  close(): void;
};

const usersIn = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT name FROM u ORDER BY name').all() as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
};

test('a backup leaves the running connection\'s WAL alone, and the next backup has what was written after the first', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-backup-wal-test-'));
  const dbFile = path.join(dir, 'ts6webui.db');
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbFile}`;
  const live = new BetterSqlite3(dbFile);
  try {
    live.pragma('journal_mode = WAL');
    live.exec('CREATE TABLE u (name TEXT)');
    live.prepare('INSERT INTO u VALUES (?)').run('before');
    const rows = new Map<string, string>();
    const prisma = {
      appSetting: {
        findUnique: async ({ where }: any) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null),
        upsert: async ({ where, create }: any) => { rows.set(where.key, create.value); },
      },
    } as any;

    const first = await createBackup(prisma, 'manual', 'test', new Date('2026-10-28T10:00:00.000Z'));
    assert.ok(fs.existsSync(`${dbFile}-wal`), 'the WAL of the running connection is still there');
    live.prepare('INSERT INTO u VALUES (?)').run('after');
    const second = await createBackup(prisma, 'manual', 'test', new Date('2026-10-28T10:01:00.000Z'));
    const managed = path.join(dir, 'backups', 'managed');
    assert.deepEqual(usersIn(path.join(managed, first.name)), ['before']);
    assert.deepEqual(usersIn(path.join(managed, second.name)), ['after', 'before']);
  } finally {
    live.close();
    process.env.DATABASE_URL = oldUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
