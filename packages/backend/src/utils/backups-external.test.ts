import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { decryptFile, encryptedSize, encryptor, isEncrypted, PBKDF2_ITERATIONS } from './backup-crypt.js';
import { checkTargetDir, createBackup, deleteBackup, getBackupSettings, listBackups, localOfExternal, setBackupSettings, setPassphrase } from './backups.js';
import { listZip } from './zip-read.js';

const PASS = 'correct horse battery staple';

async function encryptToFile(plain: Buffer, file: string, passphrase: string): Promise<void> {
  const { header, cipher } = await encryptor(passphrase);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  fs.writeFileSync(file, Buffer.concat([header, body]));
}

const hasOpenssl = (() => { try { execFileSync('openssl', ['version']); return true; } catch { return false; } })();

test('encryption: the standard openssl tool opens it, the size is predictable, a wrong passphrase fails', { skip: !hasOpenssl && 'no openssl on this machine' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-crypt-test-'));
  try {
    for (const size of [0, 15, 16, 17, 100_000]) {
      const plain = Buffer.alloc(size, 7);
      const enc = path.join(dir, `x${size}.enc`);
      await encryptToFile(plain, enc, PASS);
      assert.equal(fs.statSync(enc).size, encryptedSize(size));
      assert.ok(isEncrypted(enc));
      const out = path.join(dir, `x${size}.openssl`);
      execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-md', 'sha256', '-iter', String(PBKDF2_ITERATIONS), '-in', enc, '-out', out, '-pass', `pass:${PASS}`]);
      assert.ok(fs.readFileSync(out).equals(plain), `openssl round trip ${size}`);
      const ours = path.join(dir, `x${size}.ours`);
      await decryptFile(enc, ours, PASS);
      assert.ok(fs.readFileSync(ours).equals(plain));
    }
    // And the other way round: what openssl encrypts, we open
    fs.writeFileSync(path.join(dir, 'plain'), 'from openssl');
    execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-md', 'sha256', '-iter', String(PBKDF2_ITERATIONS), '-in', path.join(dir, 'plain'), '-out', path.join(dir, 'o.enc'), '-pass', `pass:${PASS}`]);
    await decryptFile(path.join(dir, 'o.enc'), path.join(dir, 'o.out'), PASS);
    assert.equal(fs.readFileSync(path.join(dir, 'o.out'), 'utf8'), 'from openssl');
    await assert.rejects(decryptFile(path.join(dir, 'o.enc'), path.join(dir, 'wrong.out'), 'wrong passphrase!!'));
    assert.ok(!fs.existsSync(path.join(dir, 'wrong.out')), 'no half output on a wrong passphrase');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function rig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-ext-test-'));
  const data = path.join(root, 'data');
  const target = path.join(root, 'external');
  fs.mkdirSync(data);
  fs.mkdirSync(target);
  const dbFile = path.join(data, 'ts6webui.db');
  const db = new DatabaseSync(dbFile);
  db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('x')");
  db.close();
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbFile}`;
  const rows = new Map<string, string>();
  const prisma = {
    appSetting: {
      findUnique: async ({ where }: any) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null),
      upsert: async ({ where, create }: any) => { rows.set(where.key, create.value); },
      deleteMany: async ({ where }: any) => { rows.delete(where.key); },
    },
  } as any;
  return { root, data, target, dbFile, prisma, done: () => { process.env.DATABASE_URL = oldUrl; fs.rmSync(root, { recursive: true, force: true }); } };
}

test('target directory: refused inside the volume, relative, missing; accepted when writable', () => {
  const r = rig();
  try {
    assert.match(checkTargetDir('backups-external')!, /absolute/);
    assert.match(checkTargetDir(path.join(r.data, 'x'))!, /inside the data volume/);
    assert.match(checkTargetDir(r.data)!, /inside the data volume/);
    assert.match(checkTargetDir(path.join(r.root, 'missing'))!, /does not exist/);
    assert.equal(checkTargetDir(r.target), null);
  } finally {
    r.done();
  }
});

test('copies outside the volume: plain and encrypted ZIP, listed as external once the volume copy is gone, taken back in, same retention', async () => {
  const r = rig();
  try {
    const settings = { ...(await getBackupSettings(r.prisma)), targetDir: r.target, keep: 2 };
    await setBackupSettings(r.prisma, settings);

    const plain = await createBackup(r.prisma, 'manual', 'x', new Date('2026-10-29T10:00:00.000Z'));
    const plainZip = path.join(r.target, `${plain.name.slice(0, -3)}.zip`);
    assert.ok(fs.existsSync(plainZip));
    assert.deepEqual(listZip(plainZip).map((e) => e.name).sort(), [plain.name, `${plain.name.slice(0, -3)}.json`].sort());
    assert.equal(listBackups().find((b) => b.name === plain.name)?.external, true);

    await setPassphrase(r.prisma, PASS);
    const enc = await createBackup(r.prisma, 'manual', 'x', new Date('2026-10-29T10:01:00.000Z'));
    const encFile = path.join(r.target, `${enc.name.slice(0, -3)}.zip.enc`);
    assert.ok(isEncrypted(encFile));

    // The volume is lost: the copies show as external, and one is taken back in for test/restore
    fs.rmSync(path.join(r.data, 'backups'), { recursive: true, force: true });
    const external = listBackups().filter((b) => b.kind === 'external').map((b) => b.name).sort();
    assert.deepEqual(external, [path.basename(plainZip), path.basename(encFile)].sort());
    const local = await localOfExternal(path.basename(encFile), PASS);
    assert.equal(local.kind, 'uploaded');
    assert.ok(fs.existsSync(path.join(r.data, 'backups', 'managed', local.name)));
    await assert.rejects(localOfExternal(path.basename(encFile), 'not the passphrase'), /does not open/);

    // Deleting an external-only copy removes just that file
    deleteBackup('external', path.basename(plainZip));
    assert.ok(!fs.existsSync(plainZip));

    // Scheduled retention (keep 2) applies in the target directory too, also to copies with no volume original
    for (let i = 0; i < 3; i++) await createBackup(r.prisma, 'scheduled', null, new Date(Date.UTC(2026, 9, 29, 11, i)));
    const scheduledThere = fs.readdirSync(r.target).filter((n) => n.includes('-scheduled.'));
    assert.equal(scheduledThere.length, 2, scheduledThere.join(', '));
    // A deleted volume backup takes its copy with it
    const last = listBackups().find((b) => b.kind === 'scheduled')!;
    deleteBackup('scheduled', last.name);
    assert.ok(!fs.readdirSync(r.target).some((n) => n.startsWith(last.name.slice(0, -3))));
  } finally {
    r.done();
  }
});
