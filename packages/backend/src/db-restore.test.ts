import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyPendingRestore, readPending, readResult, rollbackRestore, sha256File, writePending } from './db-restore.js';

/** A database in WAL mode with one user named `who`, a session, a trusted device and a change log. */
function makeDb(file: string, who: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS User (id INTEGER PRIMARY KEY, username TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS RefreshToken (id INTEGER PRIMARY KEY, token TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS TrustedDevice (id INTEGER PRIMARY KEY, token TEXT)');
  db.prepare('INSERT INTO User (username) VALUES (?)').run(who);
  db.exec("INSERT INTO RefreshToken (token) VALUES ('t'); INSERT INTO TrustedDevice (token) VALUES ('d')");
  return db;
}

const users = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT username FROM User ORDER BY id').all() as Array<{ username: string }>).map((r) => r.username);
  } finally {
    db.close();
  }
};
const count = (file: string, table: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare(`SELECT count(*) c FROM ${table}`).get() as { c: number }).c;
  } finally {
    db.close();
  }
};

/** data/ts6webui.db with "current" (one row only in the WAL) and a backup in managed/ with "restored". */
function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-restore-test-'));
  const dbFile = path.join(dir, 'ts6webui.db');
  const managed = path.join(dir, 'backups', 'managed');
  fs.mkdirSync(managed, { recursive: true });
  const backup = path.join(managed, 'ts6webui-2026-10-01T00-00-00-000Z-manual.db');
  const b = makeDb(backup, 'restored');
  b.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  b.close();
  for (const f of [`${backup}-wal`, `${backup}-shm`]) fs.rmSync(f, { force: true });
  // The state a crash or a stopped container leaves: the database file plus a WAL that holds the
  // newest row. Copied while the database is open, because closing it would fold the WAL in.
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  const live = makeDb(path.join(src, 'ts6webui.db'), 'current');
  live.prepare('INSERT INTO User (username) VALUES (?)').run('only-in-wal');
  for (const ext of ['', '-wal', '-shm']) fs.copyFileSync(path.join(src, `ts6webui.db${ext}`), `${dbFile}${ext}`);
  live.close();
  assert.ok(fs.statSync(`${dbFile}-wal`).size > 0, 'the rig has a WAL');
  const pending = { file: path.relative(path.join(dir, 'backups'), backup), sha256: sha256File(backup), requestedBy: 'testadmin', requestedAt: '2026-10-28T00:00:00.000Z' };
  return { dir, dbFile, managed, backup, pending };
}

const beforeRestoreCopies = (managed: string) => fs.readdirSync(managed).filter((n) => n.endsWith('-before-restore.db'));

test('no pending restore: nothing happens', () => {
  const r = rig();
  try {
    assert.deepEqual(applyPendingRestore(r.dbFile), { applied: false });
    assert.deepEqual(users(r.dbFile), ['current', 'only-in-wal']);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a restore: the backup is in place, the state before (WAL rows included) is kept, sessions are gone', () => {
  const r = rig();
  try {
    writePending(r.dbFile, r.pending);
    const out = applyPendingRestore(r.dbFile, new Date('2026-10-28T10:00:00.000Z'));
    assert.equal(out.applied, true);
    assert.deepEqual(users(r.dbFile), ['restored']);
    assert.equal(count(r.dbFile, 'RefreshToken'), 0);
    assert.equal(count(r.dbFile, 'TrustedDevice'), 0);
    assert.ok(!fs.existsSync(`${r.dbFile}-wal`) || fs.statSync(`${r.dbFile}-wal`).size === 0);
    const copies = beforeRestoreCopies(r.managed);
    assert.equal(copies.length, 1);
    assert.deepEqual(users(path.join(r.managed, copies[0])), ['current', 'only-in-wal']);
    const manifest = JSON.parse(fs.readFileSync(path.join(r.managed, copies[0].replace(/\.db$/, '.json')), 'utf8'));
    assert.equal(manifest.kind, 'before-restore');
    assert.equal(manifest.sha256, sha256File(path.join(r.managed, copies[0])));
    assert.equal(readPending(r.dbFile), null);
    assert.equal(readResult(r.dbFile)?.ok, true);
    assert.equal(readResult(r.dbFile)?.beforeRestore, copies[0]);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a crash after the copy of the current state: the database is still the old one, the rerun keeps that copy', () => {
  const r = rig();
  try {
    writePending(r.dbFile, r.pending);
    assert.throws(() => applyPendingRestore(r.dbFile, new Date('2026-10-28T10:00:00.000Z'), (step) => { if (step === 'copied-current') throw new Error('crash'); }));
    assert.deepEqual(users(r.dbFile), ['current', 'only-in-wal']);
    const first = beforeRestoreCopies(r.managed);
    assert.equal(readPending(r.dbFile)?.beforeRestore, first[0]);
    assert.equal(applyPendingRestore(r.dbFile, new Date('2026-10-28T10:05:00.000Z')).applied, true);
    assert.deepEqual(users(r.dbFile), ['restored']);
    assert.deepEqual(beforeRestoreCopies(r.managed), first);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a crash right after the switch: the database is the restored one, and the rerun ends the same', () => {
  const r = rig();
  try {
    writePending(r.dbFile, r.pending);
    assert.throws(() => applyPendingRestore(r.dbFile, new Date(), (step) => { if (step === 'swapped') throw new Error('crash'); }));
    assert.deepEqual(users(r.dbFile), ['restored']);
    assert.equal(applyPendingRestore(r.dbFile).applied, true);
    assert.deepEqual(users(r.dbFile), ['restored']);
    assert.equal(beforeRestoreCopies(r.managed).length, 1);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a backup changed after it was checked is not applied', () => {
  const r = rig();
  try {
    writePending(r.dbFile, { ...r.pending, sha256: '0'.repeat(64) });
    assert.deepEqual(applyPendingRestore(r.dbFile), { applied: false });
    assert.deepEqual(users(r.dbFile), ['current', 'only-in-wal']);
    assert.equal(readResult(r.dbFile)?.ok, false);
    assert.match(readResult(r.dbFile)?.error ?? '', /changed after it was checked/);
    assert.equal(readPending(r.dbFile), null);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a pending file pointing outside data/backups is refused', () => {
  const r = rig();
  try {
    writePending(r.dbFile, { ...r.pending, file: '../ts6webui.db' });
    assert.deepEqual(applyPendingRestore(r.dbFile), { applied: false });
    assert.match(readResult(r.dbFile)?.error ?? '', /outside/);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('rollback after failed migrations: the state before goes back in', () => {
  const r = rig();
  try {
    writePending(r.dbFile, r.pending);
    const out = applyPendingRestore(r.dbFile);
    assert.ok(out.applied);
    rollbackRestore(r.dbFile, out.pending, out.beforeRestore, 'the migrations failed');
    assert.deepEqual(users(r.dbFile), ['current', 'only-in-wal']);
    assert.equal(readResult(r.dbFile)?.rolledBack, true);
    assert.equal(readResult(r.dbFile)?.ok, false);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});
