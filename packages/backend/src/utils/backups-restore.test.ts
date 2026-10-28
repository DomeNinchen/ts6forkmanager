import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrationNames } from '../db-migrate.js';
import { readPending } from '../db-restore.js';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { encrypt } from './crypto.js';
import { cancelRestore, checkBackup, createBackup, deleteBackup, importUpload, listBackups, requestRestore, uploadTempFile } from './backups.js';
import { ZipWriter } from './zip-stream.js';
import { extractZipEntry, listZip } from './zip-read.js';

/** What a value stored by an installation with another ENCRYPTION_KEY looks like. */
function encryptWithOtherKeyForTest(plain: string): string {
  const key = scryptSync('another-installations-key', 'ts6-webui-enc-v1', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = cipher.update(plain, 'utf8', 'hex') + cipher.final('hex');
  return `enc:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data}`;
}

/** A ZIP the way the download route writes it. */
async function writeZip(target: string, files: Array<{ name: string; data: Buffer }>): Promise<void> {
  const out = fs.createWriteStream(target);
  const zip = new ZipWriter(out);
  for (const f of files) {
    await zip.addFile(f.name, f.data.length, Date.now(), async (sink) => {
      await new Promise<void>((resolve, reject) => sink.end(f.data, (err?: Error | null) => (err ? reject(err) : resolve())));
    });
  }
  await zip.finish();
  await new Promise<void>((resolve) => out.on('close', () => resolve()));
}

test('zip-read takes back what zip-stream writes, and notices a damaged byte', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-zip-test-'));
  try {
    const zipFile = path.join(dir, 'a.zip');
    const data = Buffer.from('x'.repeat(100_000) + 'end');
    await writeZip(zipFile, [{ name: 'a.db', data }, { name: 'a.json', data: Buffer.from('{}') }]);
    const entries = listZip(zipFile);
    assert.deepEqual(entries.map((e) => [e.name, e.size]), [['a.db', data.length], ['a.json', 2]]);
    extractZipEntry(zipFile, entries[0], path.join(dir, 'out.db'));
    assert.ok(fs.readFileSync(path.join(dir, 'out.db')).equals(data));

    const bytes = fs.readFileSync(zipFile);
    bytes[entries[0].dataOffset + 500] ^= 0xff;
    fs.writeFileSync(zipFile, bytes);
    assert.throws(() => extractZipEntry(zipFile, entries[0], path.join(dir, 'out2.db')), /checksum mismatch/);

    fs.writeFileSync(path.join(dir, 'cut.zip'), bytes.subarray(0, 1000));
    assert.throws(() => listZip(path.join(dir, 'cut.zip')), /cut off|Not a ZIP/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A temp data directory with a real database (migration history of this backend, one encrypted value). */
function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-backups-restore-test-'));
  const dbFile = path.join(dir, 'ts6webui.db');
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbFile}`;
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at TEXT, rolled_back_at TEXT)');
  const insert = db.prepare("INSERT INTO _prisma_migrations VALUES (?, '2026-01-01', NULL)");
  for (const m of migrationNames()) insert.run(m);
  db.exec('CREATE TABLE TsServerConfig (id INTEGER PRIMARY KEY, apiKey TEXT, botApiKey TEXT, sshPassword TEXT)');
  db.prepare('INSERT INTO TsServerConfig (apiKey) VALUES (?)').run(encrypt('apikey'));
  db.close();
  const rows = new Map<string, string>();
  const prisma = {
    appSetting: {
      findUnique: async ({ where }: any) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null),
      upsert: async ({ where, create }: any) => { rows.set(where.key, create.value); },
    },
  } as any;
  return { dir, dbFile, prisma, done: () => { process.env.DATABASE_URL = oldUrl; fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('upload: a downloaded ZIP and a bare .db become "uploaded" backups; anything else is refused and leaves nothing', async () => {
  const r = rig();
  try {
    const made = await createBackup(r.prisma, 'manual', 'testadmin', new Date('2026-10-28T10:00:00.000Z'));
    const managed = path.join(r.dir, 'backups', 'managed');
    const db = fs.readFileSync(path.join(managed, made.name));
    const json = fs.readFileSync(path.join(managed, made.name.replace(/\.db$/, '.json')));

    const zipTmp = uploadTempFile();
    await writeZip(zipTmp, [{ name: made.name, data: db }, { name: made.name.replace(/\.db$/, '.json'), data: json }]);
    const fromZip = importUpload(zipTmp, new Date('2026-10-28T11:00:00.000Z'));
    assert.equal(fromZip.kind, 'uploaded');
    assert.equal(fromZip.createdBy, 'testadmin'); // from the manifest that came along
    assert.ok(!fs.existsSync(zipTmp));

    const dbTmp = uploadTempFile();
    fs.writeFileSync(dbTmp, db);
    const bare = importUpload(dbTmp, new Date('2026-10-28T12:00:00.000Z'));
    assert.equal(bare.kind, 'uploaded');
    assert.equal(bare.backendVersion, null); // no manifest
    // ...so there is no checksum to compare, which is not a failure
    const bareCheck = await checkBackup('uploaded', bare.name);
    assert.equal(bareCheck.checksum, null);
    assert.equal(bareCheck.ok, true, JSON.stringify(bareCheck));
    assert.deepEqual((await checkBackup('uploaded', fromZip.name)).checksum, { ok: true });

    const junk = uploadTempFile();
    fs.writeFileSync(junk, 'hello');
    assert.throws(() => importUpload(junk, new Date('2026-10-28T13:00:00.000Z')), /neither a backup ZIP/);
    const twoDbs = uploadTempFile();
    await writeZip(twoDbs, [{ name: 'a.db', data: db }, { name: 'b.db', data: db }]);
    assert.throws(() => importUpload(twoDbs, new Date('2026-10-28T14:00:00.000Z')), /exactly one \.db/);
    assert.deepEqual(fs.readdirSync(managed).filter((n) => n.startsWith('.')), []);
    assert.equal(listBackups().filter((b) => b.kind === 'uploaded').length, 2);
  } finally {
    r.done();
  }
});

test('restore request: refused for a damaged, newer or foreign-key backup unless accepted; marked otherwise; cancel removes it', async () => {
  const r = rig();
  try {
    const ok = await createBackup(r.prisma, 'manual', 'testadmin', new Date('2026-10-28T10:00:00.000Z'));
    const managed = path.join(r.dir, 'backups', 'managed');

    // A value from another installation's key
    const foreignDb = new DatabaseSync(r.dbFile);
    foreignDb.prepare('UPDATE TsServerConfig SET apiKey = ?').run(encryptWithOtherKeyForTest('apikey'));
    foreignDb.close();
    const foreign = await createBackup(r.prisma, 'manual', 'testadmin', new Date('2026-10-28T10:01:00.000Z'));
    await assert.rejects(requestRestore('manual', foreign.name, 'testadmin', false), (err: any) => err.code === 'KEY_MISMATCH');
    assert.equal(readPending(r.dbFile), null);
    await requestRestore('manual', foreign.name, 'testadmin', true);
    assert.equal(readPending(r.dbFile)?.file, `managed/${foreign.name}`);

    // From a newer backend
    const newerDb = new DatabaseSync(r.dbFile);
    newerDb.prepare("INSERT INTO _prisma_migrations VALUES ('29991231000000_future', '2026-01-01', NULL)").run();
    newerDb.close();
    const newer = await createBackup(r.prisma, 'manual', 'testadmin', new Date('2026-10-28T10:02:00.000Z'));
    await assert.rejects(requestRestore('manual', newer.name, 'testadmin', true), (err: any) => err.code === 'NEWER');

    // Damaged
    fs.truncateSync(path.join(managed, ok.name), 4096);
    await assert.rejects(requestRestore('manual', ok.name, 'testadmin', true), (err: any) => err.code === 'DAMAGED' || err.code === 'CHECKSUM');

    // The marked one is still the foreign-key one, and it cannot be deleted while marked
    assert.equal(readPending(r.dbFile)?.file, `managed/${foreign.name}`);
    assert.throws(() => deleteBackup('manual', foreign.name), /marked for a restore/);
    assert.equal(cancelRestore(), true);
    assert.equal(readPending(r.dbFile), null);
    assert.equal(cancelRestore(), false);
  } finally {
    r.done();
  }
});
