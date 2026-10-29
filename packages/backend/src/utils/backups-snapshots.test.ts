import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackup, deleteBackup, listBackups, snapshotDirOf } from './backups.js';

/** Settings rows plus one connection with WebQuery and one without. */
function fakePrisma(includeTsSnapshots: boolean) {
  const rows = new Map<string, string>([['backup_settings', JSON.stringify({ includeTsSnapshots })]]);
  return {
    appSetting: {
      findUnique: async ({ where }: any) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null),
      upsert: async ({ where, create }: any) => { rows.set(where.key, create.value); },
    },
    tsServerConfig: { findMany: async () => [{ id: 1, name: 'Main' }, { id: 2, name: 'Voice only' }] },
  } as any;
}

/** Connection 1 has two virtual servers; the second refuses its snapshot. Connection 2 has no WebQuery client. */
const pool = {
  tryGetClient: (id: number) => (id !== 1 ? null : {
    execute: async (sid: number, command: string) => {
      if (command === 'serverlist') return [{ virtualserver_id: '1', virtualserver_name: 'Lobby server' }, { virtualserver_id: '2', virtualserver_name: 'Second' }];
      if (command === 'serversnapshotcreate' && sid === 1) return [{ version: '3', data: 'KLUv/test' }];
      throw new Error('insufficient client permissions (2568)');
    },
  }),
} as any;

test('TeamSpeak snapshots: one file per virtual server, a failing one only noted, off means none, deleted with the backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-backups-snap-test-'));
  const dbFile = path.join(dir, 'ts6webui.db');
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbFile}`;
  try {
    const db = new DatabaseSync(dbFile);
    db.exec('CREATE TABLE t (v TEXT)');
    db.close();

    const off = await createBackup(fakePrisma(false), 'manual', 'x', new Date('2026-10-29T10:00:00.000Z'), pool);
    assert.equal(off.tsSnapshots, null);
    assert.ok(!fs.existsSync(snapshotDirOf(path.join(dir, 'backups', 'managed', off.name))));

    const on = await createBackup(fakePrisma(true), 'manual', 'x', new Date('2026-10-29T10:01:00.000Z'), pool);
    assert.equal(on.tsSnapshots, 1);
    const folder = snapshotDirOf(path.join(dir, 'backups', 'managed', on.name));
    assert.deepEqual(fs.readdirSync(folder), ['1-1.json']);
    // The Miscellaneous page's format, deployable as it is
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, '1-1.json'), 'utf8')), { version: '3', data: 'KLUv/test' });
    assert.equal(fs.statSync(path.join(folder, '1-1.json')).mode & 0o777, 0o600);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'backups', 'managed', on.name.replace(/\.db$/, '.json')), 'utf8'));
    assert.deepEqual(manifest.tsSnapshots.map((s: any) => [s.server, s.sid, s.virtualServer, s.file, s.error]), [
      ['Main', 1, 'Lobby server', '1-1.json', null],
      ['Main', 2, 'Second', null, 'insufficient client permissions (2568)'],
    ]);

    deleteBackup('manual', on.name);
    assert.ok(!fs.existsSync(folder));
    assert.deepEqual(listBackups().map((b) => b.name), [off.name]);
  } finally {
    process.env.DATABASE_URL = oldUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
