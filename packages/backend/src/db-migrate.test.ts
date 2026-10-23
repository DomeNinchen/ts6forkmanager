import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectDb, planMigration } from './db-migrate.js';

test('planMigration: fresh/empty database just deploys', () => {
  assert.deepEqual(planMigration({ hasTables: false, hasHistory: false, appliedCount: 0 }, false, 0), ['deploy']);
  assert.deepEqual(planMigration({ hasTables: false, hasHistory: false, appliedCount: 0 }, true, 0), ['deploy']);
});

test('planMigration: existing database without history is baselined only when its schema matches', () => {
  assert.deepEqual(planMigration({ hasTables: true, hasHistory: false, appliedCount: 0 }, true, 0), ['baseline', 'deploy']);
  assert.deepEqual(planMigration({ hasTables: true, hasHistory: false, appliedCount: 0 }, false, 0), ['abort-drift']);
});

test('planMigration: database with history backs up before a deploy only when something is pending', () => {
  assert.deepEqual(planMigration({ hasTables: true, hasHistory: true, appliedCount: 1 }, true, 0), ['deploy']);
  assert.deepEqual(planMigration({ hasTables: true, hasHistory: true, appliedCount: 1 }, true, 2), ['backup', 'deploy']);
  // Pending counts data-only migrations too (a schema diff would miss a DELETE/UPDATE migration).
  assert.deepEqual(planMigration({ hasTables: true, hasHistory: true, appliedCount: 1 }, true, 1), ['backup', 'deploy']);
  // Database ahead of the image (downgrade): nothing pending, no backup, deploy is a no-op.
  assert.deepEqual(planMigration({ hasTables: true, hasHistory: true, appliedCount: 3 }, true, -2), ['deploy']);
});

test('inspectDb: missing file is a fresh install', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-'));
  assert.deepEqual(inspectDb(path.join(dir, 'nope.db')), { hasTables: false, hasHistory: false, appliedCount: 0 });
});

test('inspectDb: empty file is a fresh install', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-'));
  const f = path.join(dir, 'empty.db');
  fs.writeFileSync(f, '');
  assert.deepEqual(inspectDb(f), { hasTables: false, hasHistory: false, appliedCount: 0 });
});

test('inspectDb: user tables without history (a db-push database)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-'));
  const f = path.join(dir, 'push.db');
  const db = new DatabaseSync(f);
  db.exec('CREATE TABLE "User" (id INTEGER PRIMARY KEY)');
  db.close();
  assert.deepEqual(inspectDb(f), { hasTables: true, hasHistory: false, appliedCount: 0 });
});

test('inspectDb: counts only fully applied migrations in the history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-'));
  const f = path.join(dir, 'mig.db');
  const db = new DatabaseSync(f);
  db.exec('CREATE TABLE "User" (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE "_prisma_migrations" (id TEXT PRIMARY KEY, finished_at DATETIME)');
  db.exec("INSERT INTO _prisma_migrations (id, finished_at) VALUES ('a', CURRENT_TIMESTAMP)");
  db.exec("INSERT INTO _prisma_migrations (id, finished_at) VALUES ('b', CURRENT_TIMESTAMP)");
  db.exec("INSERT INTO _prisma_migrations (id, finished_at) VALUES ('c', NULL)"); // a failed/unfinished one is not counted
  db.close();
  assert.deepEqual(inspectDb(f), { hasTables: true, hasHistory: true, appliedCount: 2 });
});

test('inspectDb: only the history table present counts as no user tables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-'));
  const f = path.join(dir, 'only-hist.db');
  const db = new DatabaseSync(f);
  db.exec('CREATE TABLE "_prisma_migrations" (id TEXT PRIMARY KEY, finished_at DATETIME)');
  db.close();
  assert.deepEqual(inspectDb(f), { hasTables: false, hasHistory: true, appliedCount: 0 });
});
