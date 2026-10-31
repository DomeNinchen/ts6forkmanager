import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { lastBackupWithSnapshot, listBackups, snapshotDirOf } from './backups.js';
import { backupBeforeDeleting, ensureBulkBackup, resetBulkBackups, REUSE_MS } from './bulk-backup.js';

/** Snapshots switched off on the page, threshold 3; connection 1 has WebQuery, 2 does not. */
function fakePrisma() {
  const rows = new Map<string, string>([['backup_settings', JSON.stringify({ includeTsSnapshots: false, bulkBackupThreshold: 3 })]]);
  return {
    appSetting: {
      findUnique: async ({ where }: any) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null),
      upsert: async ({ where, create }: any) => { rows.set(where.key, create.value); },
    },
    tsServerConfig: {
      findMany: async ({ where }: any) => [{ id: 1, name: 'Main' }, { id: 2, name: 'Voice only' }].filter((c) => where.id === undefined || c.id === where.id),
    },
  } as any;
}

/** Connection 1: virtual server 1 snapshots, 2 refuses. Counts the snapshots taken. */
let snapshots = 0;
const pool = {
  tryGetClient: (id: number) => (id !== 1 ? null : {
    execute: async (sid: number, command: string) => {
      if (command === 'serverlist') return [{ virtualserver_id: '1', virtualserver_name: 'Lobby' }, { virtualserver_id: '2', virtualserver_name: 'Second' }];
      if (command === 'serversnapshotcreate' && sid === 1) { snapshots++; return [{ version: '3', data: 'KLUv/test' }]; }
      throw new Error('insufficient client permissions (2568)');
    },
  }),
} as any;

const reqFor = (prisma: any, sid: number, body: unknown = {}) =>
  ({ body, params: { configId: '1', sid: String(sid) }, user: { username: 'mod' }, app: { locals: { prisma, connectionPool: pool } } }) as any;

test('before a deletion: one backup with only this server\'s snapshot, shared by parallel deletes, reused for two minutes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-bulk-backup-test-'));
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(dir, 'ts6webui.db')}`;
  resetBulkBackups();
  snapshots = 0;
  try {
    const db = new DatabaseSync(path.join(dir, 'ts6webui.db'));
    db.exec('CREATE TABLE t (v TEXT)');
    db.close();
    const prisma = fakePrisma();
    const now = Date.parse('2026-10-31T12:00:00.000Z');

    // Three groups deleted at once: one backup, the same name for all three.
    const names = await Promise.all([1, 2, 3].map(() => ensureBulkBackup(prisma, pool, 1, 1, 'mod', now)));
    assert.equal(new Set(names).size, 1);
    assert.equal(snapshots, 1);
    const [entry] = listBackups();
    assert.equal(entry.kind, 'before-bulk');
    assert.equal(entry.createdBy, 'mod');
    // Only virtual server 1 of connection 1, although the snapshot switch is off.
    assert.deepEqual(fs.readdirSync(snapshotDirOf(path.join(dir, 'backups', 'managed', entry.name))), ['1-1.json']);
    assert.deepEqual(lastBackupWithSnapshot(1, 1), { kind: 'before-bulk', name: entry.name, createdAt: entry.createdAt });
    assert.equal(lastBackupWithSnapshot(1, 2), null);

    // Within two minutes the same backup; "back up now" (fresh) still a new one; after that a new one too.
    assert.equal(await ensureBulkBackup(prisma, pool, 1, 1, 'mod', now + REUSE_MS - 1), names[0]);
    const fresh = await ensureBulkBackup(prisma, pool, 1, 1, 'mod', now + 1000, true);
    assert.notEqual(fresh, names[0]);
    // ...and the deletions right after it reuse that fresh one.
    assert.equal(await ensureBulkBackup(prisma, pool, 1, 1, 'mod', now + 2000), fresh);
    const later = await ensureBulkBackup(prisma, pool, 1, 1, 'mod', now + 1000 + REUSE_MS + 1000);
    assert.notEqual(later, fresh);
    assert.equal(listBackups().length, 3);
  } finally {
    process.env.DATABASE_URL = oldUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the route guard: below the threshold and with skipBackup nothing is backed up; no snapshot refuses the deletion', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-bulk-guard-test-'));
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(dir, 'ts6webui.db')}`;
  resetBulkBackups();
  try {
    const db = new DatabaseSync(path.join(dir, 'ts6webui.db'));
    db.exec('CREATE TABLE t (v TEXT)');
    db.close();
    const prisma = fakePrisma();

    await backupBeforeDeleting(reqFor(prisma, 1), 2); // 2 profiles, threshold 3
    await backupBeforeDeleting(reqFor(prisma, 1, { skipBackup: true })); // a group, the admin went on without
    await backupBeforeDeleting(reqFor(prisma, 1, { skipBackup: 'true' }), 2); // only the JSON boolean counts, still below
    assert.equal(listBackups().length, 0);

    // Positive control: at the threshold it backs up.
    await backupBeforeDeleting(reqFor(prisma, 1), 3);
    assert.equal(listBackups().length, 1);

    // Virtual server 2 refuses its snapshot: the deletion is refused with TeamSpeak's reason, and no
    // useless database-only copy stays behind to push a good one out of the ten.
    await assert.rejects(backupBeforeDeleting(reqFor(prisma, 2)), (err: any) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'BACKUP_FAILED');
      assert.match(err.details, /No snapshot of this virtual server could be taken: insufficient client permissions \(2568\)/);
      return true;
    });
    assert.equal(listBackups().length, 1);
    assert.equal(fs.readdirSync(path.join(dir, 'backups', 'managed')).length, 3); // the good one: .db, .json, .teamspeak/
    assert.equal(JSON.parse((await prisma.appSetting.findUnique({ where: { key: 'backup_last_run' } })).value).ok, false);
  } finally {
    process.env.DATABASE_URL = oldUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
