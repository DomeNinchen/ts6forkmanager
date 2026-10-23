import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, backupFileName, backupsToDelete, parseKeep } from './db-backup.js';

test('backup names sort by time and carry the version about to start', () => {
  const a = backupFileName('/d/ts6webui.db', '2.71.0', new Date('2026-10-23T09:05:00.000Z'));
  const b = backupFileName('/d/ts6webui.db', '2.70.2', new Date('2026-10-23T10:00:00.000Z'));
  assert.equal(a, 'ts6webui-2026-10-23T09-05-00-000Z-before-2.71.0.db');
  assert.deepEqual([b, a].sort(), [a, b]);
});

test('only the oldest backups beyond the limit go, plus temp files of interrupted runs', () => {
  const names = [
    'ts6webui-2026-10-01T00-00-00-000Z-before-1.0.0.db',
    'ts6webui-2026-10-03T00-00-00-000Z-before-1.0.2.db',
    'ts6webui-2026-10-02T00-00-00-000Z-before-1.0.1.db',
    '.ts6webui-2026-10-04T00-00-00-000Z-before-1.0.3.db.tmp',
    'my-own-copy.db',
    'ts6webui.db',
  ];
  assert.deepEqual(backupsToDelete(names, '/d/ts6webui.db', 2), [
    '.ts6webui-2026-10-04T00-00-00-000Z-before-1.0.3.db.tmp',
    'ts6webui-2026-10-01T00-00-00-000Z-before-1.0.0.db',
  ]);
  assert.deepEqual(backupsToDelete(names, '/d/ts6webui.db', 5), ['.ts6webui-2026-10-04T00-00-00-000Z-before-1.0.3.db.tmp']);
});

test('DB_BACKUP_KEEP falls back to 5 unless it is a whole number of at least 1', () => {
  assert.equal(parseKeep(undefined), 5);
  assert.equal(parseKeep(''), 5);
  assert.equal(parseKeep('3'), 3);
  assert.equal(parseKeep('0'), 5);
  assert.equal(parseKeep('two'), 5);
});

test('the backup holds rows still in the WAL, is private, and old ones are pruned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-backup-'));
  try {
    const dbFile = path.join(dir, 'ts6webui.db');
    const db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t(v TEXT); INSERT INTO t VALUES ('in-wal')");
    assert.ok(fs.statSync(`${dbFile}-wal`).size > 0); // still open: the row is in the WAL only

    const files = [1, 2, 3].map((i) => backupDatabase(dbFile, `9.9.${i}`, 2, new Date(Date.UTC(2026, 9, i)))!.file);
    // a restart of the same version (its sync failed) keeps the copy from before the first attempt
    assert.deepEqual(backupDatabase(dbFile, '9.9.3', 2, new Date(Date.UTC(2026, 9, 4))), { file: files[2], created: false });
    db.close();

    const copy = new DatabaseSync(files[2], { readOnly: true });
    assert.deepEqual(copy.prepare('SELECT v FROM t').all().map((r) => r.v), ['in-wal']);
    copy.close();
    assert.deepEqual(fs.readdirSync(path.join(dir, 'backups')).sort(), files.slice(1).map((f) => path.basename(f)));
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(files[2]).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.join(dir, 'backups')).mode & 0o777, 0o700);
    }
    assert.equal(backupDatabase(path.join(dir, 'missing.db'), '9.9.9', 2), null);
    assert.ok(!fs.existsSync(path.join(dir, 'missing.db')));
    fs.writeFileSync(path.join(dir, 'empty.db'), '');
    assert.equal(backupDatabase(path.join(dir, 'empty.db'), '9.9.9', 2), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
