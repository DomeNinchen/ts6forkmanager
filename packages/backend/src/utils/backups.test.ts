import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupsToDelete } from '../db-backup.js';
import { migrationNames } from '../db-migrate.js';
import { encrypt } from './crypto.js';
import {
  BACKUP_DEFAULTS,
  isValidBackupSettings,
  beforeUpdatePattern,
  checkBackup,
  checkKey,
  compareMigrations,
  createBackup,
  deleteBackup,
  listBackups,
  managedName,
  managedPattern,
  resolveBackup,
  scheduledToDelete,
  timeFromStamp,
} from './backups.js';

const stem = 'ts6webui';
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 3, 30));

test('a scheduled backup and a before-update copy never match each other\'s pattern or rotation', () => {
  const scheduled = managedName(stem, 'scheduled', day(1));
  const before = 'ts6webui-2026-10-01T00-00-00-000Z-before-2.71.0.db';
  assert.ok(managedPattern(stem).test(scheduled));
  assert.ok(!managedPattern(stem).test(before));
  assert.ok(beforeUpdatePattern(stem).test(before));
  assert.ok(!beforeUpdatePattern(stem).test(scheduled));
  // Mine live in managed/; db-backup.ts only rotates the top folder, where managed/ is a folder name.
  assert.deepEqual(backupsToDelete([before, 'managed'], '/d/ts6webui.db', 1), []);
  assert.deepEqual(scheduledToDelete([before], stem, 0, null, day(30)), []);
});

test('retention: newest `keep` scheduled ones stay, older-than-max-age go, manual ones are never touched', () => {
  const names = [1, 2, 3, 4, 5].map((d) => managedName(stem, 'scheduled', day(d)));
  const manual = managedName(stem, 'manual', day(1));
  const all = [...names, manual, `${names[0].slice(0, -3)}.json`];
  assert.deepEqual(scheduledToDelete(all, stem, 3, null, day(6)).sort(), [names[0], names[1]].sort());
  // 2 days max age at day 6 03:30: days 1-3 are older
  assert.deepEqual(scheduledToDelete(all, stem, 10, 2, day(6)).sort(), [names[0], names[1], names[2]].sort());
});

test('before-bulk backups have their own count: they never push out scheduled ones, nor the reverse', () => {
  const scheduled = [1, 2, 3].map((d) => managedName(stem, 'scheduled', day(d)));
  const bulk = [4, 5, 6, 7].map((d) => managedName(stem, 'before-bulk', day(d)));
  const all = [...scheduled, ...bulk];
  assert.ok(bulk.every((n) => managedPattern(stem).exec(n)?.[2] === 'before-bulk'));
  // Four newer before-bulk ones leave the three scheduled ones alone...
  assert.deepEqual(scheduledToDelete(all, stem, 3, null, day(8)), []);
  // ...and keeping 2 before-bulk ones drops the two oldest of those only.
  assert.deepEqual(scheduledToDelete(all, stem, 2, null, day(8), 'before-bulk').sort(), [bulk[0], bulk[1]].sort());
});

test('the backup threshold for deletions is part of valid settings, 1 to 500', () => {
  const ok = { ...BACKUP_DEFAULTS };
  assert.equal(ok.bulkBackupThreshold, 10);
  assert.ok(isValidBackupSettings(ok));
  for (const bad of [0, 501, 2.5, '10', null]) assert.ok(!isValidBackupSettings({ ...ok, bulkBackupThreshold: bad }), String(bad));
  const { bulkBackupThreshold: _, ...without } = ok;
  assert.ok(!isValidBackupSettings(without));
});

test('names round-trip to their time', () => {
  const m = managedPattern(stem).exec(managedName(stem, 'manual', new Date('2026-10-28T09:05:01.234Z')))!;
  assert.equal(timeFromStamp(m[1]), '2026-10-28T09:05:01.234Z');
});

test('a name outside its kind\'s pattern cannot be resolved (no path tricks)', () => {
  for (const [kind, name] of [
    ['manual', '../ts6webui.db'],
    ['manual', 'ts6webui.db'],
    ['scheduled', managedName(stem, 'manual', day(1))],
    ['before-update', managedName(stem, 'manual', day(1))],
    ['nonsense', managedName(stem, 'manual', day(1))],
  ]) {
    assert.throws(() => resolveBackup(kind, name), /No such backup/, `${kind} ${name}`);
  }
});

test('migrations: same, older (forward), newer (refused), from before migrations', () => {
  assert.deepEqual(compareMigrations(['a', 'b'], ['a', 'b']), { state: 'ok', pending: [], unknown: [] });
  assert.deepEqual(compareMigrations(['a'], ['a', 'b']), { state: 'older', pending: ['b'], unknown: [] });
  assert.deepEqual(compareMigrations(['a', 'b', 'c'], ['a', 'b']), { state: 'newer', pending: [], unknown: ['c'] });
  assert.equal(compareMigrations(null, ['a']).state, 'no-history');
});

test('key check: values from the running key pass, a tampered one fails by field', () => {
  const good = encrypt('secret');
  const [, iv, tag, data] = good.split(':');
  const bad = `enc:${iv}:${tag}:${data.slice(0, -2)}${data.endsWith('00') ? '11' : '00'}`;
  assert.deepEqual(checkKey([{ field: 'A.x', value: good }]), { checked: 1, failed: 0, failedFields: [] });
  assert.deepEqual(checkKey([{ field: 'A.x', value: good }, { field: 'B.y', value: bad }]), { checked: 2, failed: 1, failedFields: ['B.y'] });
});

/** A fake AppSetting table: enough for the settings and last-run rows. */
function fakePrisma() {
  const rows = new Map<string, string>();
  return {
    rows,
    appSetting: {
      findUnique: async ({ where }: any) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null),
      upsert: async ({ where, create }: any) => { rows.set(where.key, create.value); },
    },
  } as any;
}

test('a real backup: written beside the WAL rows, private, checks out; a corrupted one and a newer one do not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-backups-test-'));
  const dbFile = path.join(dir, 'ts6webui.db');
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbFile}`;
  const live = new DatabaseSync(dbFile);
  try {
    live.exec('PRAGMA journal_mode = WAL');
    live.exec('CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at TEXT, rolled_back_at TEXT)');
    const insert = live.prepare("INSERT INTO _prisma_migrations VALUES (?, '2026-01-01', NULL)");
    for (const m of migrationNames()) insert.run(m);
    live.exec('CREATE TABLE TsServerConfig (id INTEGER PRIMARY KEY, apiKey TEXT, botApiKey TEXT, sshPassword TEXT)');
    live.prepare('INSERT INTO TsServerConfig (apiKey) VALUES (?)').run(encrypt('apikey'));
    live.exec('CREATE TABLE AppSetting (key TEXT PRIMARY KEY, value TEXT)');
    live.prepare("INSERT INTO AppSetting VALUES ('oidc_config', ?)").run(JSON.stringify({ clientSecret: encrypt('sso') }));

    const prisma = fakePrisma();
    const entry = await createBackup(prisma, 'manual', 'testadmin', new Date('2026-10-28T10:00:00.000Z'));
    assert.equal(entry.kind, 'manual');
    assert.equal(entry.createdBy, 'testadmin');
    assert.equal(entry.migrationCount, migrationNames().length);
    const file = path.join(dir, 'backups', 'managed', entry.name);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    // The row only in the WAL (no checkpoint yet) is in the copy
    const copy = new DatabaseSync(file, { readOnly: true });
    assert.equal((copy.prepare('SELECT count(*) c FROM TsServerConfig').get() as { c: number }).c, 1);
    copy.close();
    assert.equal(JSON.parse(prisma.rows.get('backup_last_run')).ok, true);

    const ok = await checkBackup('manual', entry.name);
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.deepEqual(ok.key, { checked: 2, failed: 0, failedFields: [] });
    assert.equal(ok.migrations.state, 'ok');
    assert.deepEqual(ok.checksum, { ok: true });

    // A second backup while the first runs is refused
    const a = createBackup(prisma, 'manual', 'x', new Date('2026-10-28T10:00:01.000Z'));
    await assert.rejects(createBackup(prisma, 'manual', 'x', new Date('2026-10-28T10:00:02.000Z')), /already being written/);
    const second = await a;

    // Truncated: checksum and integrity fail
    fs.truncateSync(path.join(dir, 'backups', 'managed', second.name), 4096);
    const broken = await checkBackup('manual', second.name);
    assert.equal(broken.ok, false);
    assert.deepEqual(broken.checksum, { ok: false });
    assert.equal(broken.integrity.ok, false);

    // From a newer backend: an unknown migration is refused
    live.prepare("INSERT INTO _prisma_migrations VALUES ('29991231000000_from_the_future', '2026-01-01', NULL)").run();
    const newer = await createBackup(prisma, 'manual', 'x', new Date('2026-10-28T10:00:03.000Z'));
    const verdict = await checkBackup('manual', newer.name);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.migrations.state, 'newer');
    assert.deepEqual(verdict.migrations.unknown, ['29991231000000_from_the_future']);

    assert.equal(listBackups().length, 3);
    deleteBackup('manual', newer.name);
    assert.equal(listBackups().length, 2);
    assert.ok(!fs.existsSync(path.join(dir, 'backups', 'managed', `${newer.name.slice(0, -3)}.json`)));
  } finally {
    live.close();
    process.env.DATABASE_URL = oldUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
