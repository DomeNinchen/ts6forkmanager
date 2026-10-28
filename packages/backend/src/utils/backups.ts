// Backups of the manager's database from the Backups page (R7): "back up now", a schedule
// with its own retention, a check of any backup with the same tests a restore runs, and
// one-time download links. Written to data/backups/managed/, apart from the copies the
// container takes before an update (data/backups/, db-backup.ts): that rotation reads
// only the top folder, so neither ever deletes the other's files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type {
  BackupCheckResult,
  BackupEntry,
  BackupKind,
  BackupLastRun,
  BackupManifest,
  BackupOverview,
  BackupRestoreResult,
  BackupSettings,
} from '@ts6/common';
import { BACKUP_KINDS } from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../middleware/error-handler.js';
import { migrationNames } from '../db-migrate.js';
import { clearPending, readPending, readResult, sha256File, writePending, type PendingRestore } from '../db-restore.js';
import { extractZipEntry, isZip, listZip } from './zip-read.js';
import { decrypt } from './crypto.js';
import { recordChange } from './change-log.js';
import { getChangeLogSettings } from './change-log-settings.js';
import { TicketStore } from './ticket-store.js';
import type { BackupJob, InspectedDb } from './backup-worker.js';

export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 100;
export const BACKUP_MAX_AGE_MIN = 1;
export const BACKUP_MAX_AGE_MAX = 3650;

export const BACKUP_DEFAULTS: BackupSettings = {
  scheduleEnabled: false,
  time: '03:30',
  days: [0, 1, 2, 3, 4, 5, 6],
  keep: 7,
  maxAgeDays: null,
  maxUploadMb: 2048,
};
export const BACKUP_UPLOAD_MB_MIN = 1;
/** The ZIPs here have no ZIP64, so 4 GiB is the end of the line anyway. */
export const BACKUP_UPLOAD_MB_MAX = 4095;

const KEY_SETTINGS = 'backup_settings';
const KEY_LAST_RUN = 'backup_last_run';

// --- Where things are ----------------------------------------------------------

/** Same default as prisma.config.ts and db-backup.ts, relative to the backend directory. */
export function databaseFile(): string {
  return path.resolve((process.env.DATABASE_URL || 'file:./data/ts6webui.db').replace(/^file:/, ''));
}

function stemOf(dbFile: string): string {
  return path.basename(dbFile, path.extname(dbFile));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TIME = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)';

type ManagedKind = 'manual' | 'scheduled' | 'uploaded' | 'before-restore';

/** `ts6webui-2026-10-28T03-30-00-000Z-scheduled.db` */
export function managedPattern(stem: string): RegExp {
  return new RegExp(`^${escapeRegExp(stem)}-${TIME}-(manual|scheduled|uploaded|before-restore)\\.db$`);
}

/** The copies db-backup.ts takes before an update: `ts6webui-<time>-before-2.71.0.db` */
export function beforeUpdatePattern(stem: string): RegExp {
  return new RegExp(`^${escapeRegExp(stem)}-${TIME}-before-([0-9A-Za-z.+-]+)\\.db$`);
}

/** `2026-10-28T03-30-00-000Z` back to ISO 8601. */
export function timeFromStamp(stamp: string): string {
  return stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
}

export function managedName(stem: string, kind: ManagedKind, now: Date): string {
  return `${stem}-${now.toISOString().replace(/[:.]/g, '-')}-${kind}.db`;
}

function dirs(dbFile = databaseFile()) {
  const backups = path.join(path.dirname(dbFile), 'backups');
  return { dbFile, stem: stemOf(dbFile), backups, managed: path.join(backups, 'managed') };
}

/** The file behind a kind and name, or a 404. The name must match its kind's pattern exactly, so nothing outside the two folders can be named. */
export function resolveBackup(kind: string, name: string): { kind: BackupKind; file: string; manifest: string | null } {
  const d = dirs();
  if (!(BACKUP_KINDS as readonly string[]).includes(kind)) throw new AppError(404, 'No such backup');
  const managed = managedPattern(d.stem).exec(name);
  if (kind !== 'before-update' && managed && managed[2] === kind) {
    return { kind: managed[2] as ManagedKind, file: path.join(d.managed, name), manifest: path.join(d.managed, `${name.slice(0, -3)}.json`) };
  }
  if (kind === 'before-update' && beforeUpdatePattern(d.stem).test(name)) {
    return { kind, file: path.join(d.backups, name), manifest: null };
  }
  throw new AppError(404, 'No such backup');
}

function ownVersion(): string {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8')).version as string;
}

function readManifest(file: string | null): BackupManifest | null {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BackupManifest;
  } catch {
    return null;
  }
}

/** Bytes free on the file system that holds `dir`; null when it cannot be read. */
export function freeBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** The live database plus its write-ahead log: what a copy can grow to. */
export function databaseBytes(dbFile = databaseFile()): number {
  const size = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
  return size(dbFile) + size(`${dbFile}-wal`);
}

// --- Listing -------------------------------------------------------------------

export function listBackups(): BackupEntry[] {
  const d = dirs();
  const entries: BackupEntry[] = [];
  const read = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  const managed = managedPattern(d.stem);
  for (const name of read(d.managed)) {
    const m = managed.exec(name);
    if (!m) continue;
    const manifest = readManifest(path.join(d.managed, `${name.slice(0, -3)}.json`));
    entries.push({
      kind: m[2] as ManagedKind,
      name,
      size: fs.statSync(path.join(d.managed, name)).size,
      createdAt: timeFromStamp(m[1]),
      backendVersion: manifest?.backendVersion ?? null,
      migrationCount: manifest?.migrations.length ?? null,
      createdBy: manifest?.createdBy ?? null,
    });
  }
  const before = beforeUpdatePattern(d.stem);
  for (const name of read(d.backups)) {
    const m = before.exec(name);
    if (!m) continue;
    entries.push({
      kind: 'before-update',
      name,
      size: fs.statSync(path.join(d.backups, name)).size,
      createdAt: timeFromStamp(m[1]),
      backendVersion: m[2],
      migrationCount: null,
      createdBy: null,
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// --- The worker ------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
// Built: backup-worker.js next to this file. Under tsx (dev) only the .ts exists, which Node runs itself (type stripping).
const WORKER_FILE = fs.existsSync(path.join(here, 'backup-worker.js')) ? path.join(here, 'backup-worker.js') : path.join(here, 'backup-worker.ts');

function runWorker(job: BackupJob): Promise<InspectedDb> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, { workerData: job });
    let settled = false;
    worker.once('message', (msg: { ok: true; result: InspectedDb } | { ok: false; error: string }) => {
      settled = true;
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    });
    worker.once('error', (err) => { settled = true; reject(err); });
    worker.once('exit', (code) => { if (!settled) reject(new Error(`Backup worker exited with code ${code}`)); });
  });
}

// --- Writing ---------------------------------------------------------------------

/** Scheduled backups to delete: beyond the newest `keep`, or older than `maxAgeDays`. Manual ones are never touched. */
export function scheduledToDelete(names: string[], stem: string, keep: number, maxAgeDays: number | null, now: Date): string[] {
  const pattern = managedPattern(stem);
  const scheduled = names
    .map((n) => pattern.exec(n))
    .filter((m): m is RegExpExecArray => m !== null && m[2] === 'scheduled')
    .sort((a, b) => b[1].localeCompare(a[1])); // newest first
  const cutoff = maxAgeDays === null ? null : now.getTime() - maxAgeDays * 86_400_000;
  return scheduled
    .filter((m, i) => i >= keep || (cutoff !== null && Date.parse(timeFromStamp(m[1])) < cutoff))
    .map((m) => m[0]);
}

function removeBackupFiles(dir: string, name: string): void {
  fs.rmSync(path.join(dir, name), { force: true });
  fs.rmSync(path.join(dir, `${name.slice(0, -3)}.json`), { force: true });
}

let running = false;

/**
 * Writes a backup and its manifest. Refuses up front when less than twice the database's
 * size is free (the copy, and room left for the app to keep writing), and never leaves a
 * half-written file under a backup's name.
 */
export async function createBackup(prisma: PrismaClient, kind: 'manual' | 'scheduled', createdBy: string | null, now = new Date()): Promise<BackupEntry> {
  if (running) throw new AppError(409, 'A backup is already being written');
  running = true;
  const d = dirs();
  const name = managedName(d.stem, kind, now);
  try {
    if (!fs.existsSync(d.dbFile)) throw new AppError(500, `No database at ${d.dbFile}`);
    // Password hashes, encrypted credentials: readable by the backend user only.
    fs.mkdirSync(d.managed, { recursive: true, mode: 0o700 });
    fs.chmodSync(d.managed, 0o700);
    // Leftovers of a run that was killed half way: only one backup runs at a time, so none is in use.
    // (An upload on its way has its own temp name, .upload-*.tmp, and is left alone.)
    for (const n of fs.readdirSync(d.managed)) if (/^\..+\.db\.tmp$/.test(n)) fs.rmSync(path.join(d.managed, n), { force: true });

    const needed = 2 * databaseBytes(d.dbFile);
    const free = freeBytes(d.managed);
    if (free !== null && free < needed) {
      throw new AppError(507, 'Not enough free space for a backup', `${mb(free)} free, ${mb(needed)} needed (twice the database)`);
    }

    const tmp = path.join(d.managed, `.${name}.tmp`);
    let inspected: InspectedDb;
    try {
      inspected = await runWorker({ job: 'create', dbFile: d.dbFile, target: tmp });
      if (!inspected.integrity.ok) throw new Error(`The copy failed its integrity check: ${inspected.integrity.message}`);
    } catch (err) {
      // SQLite leaves a partial copy behind on a full disk; it would only take the space a retry needs.
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    fs.chmodSync(tmp, 0o600);
    const manifest: BackupManifest = {
      format: 1,
      createdAt: now.toISOString(),
      kind,
      backendVersion: ownVersion(),
      migrations: inspected.migrations ?? [],
      sha256: inspected.sha256,
      size: inspected.size,
      integrity: 'ok',
      createdBy,
    };
    const manifestFile = path.join(d.managed, `${name.slice(0, -3)}.json`);
    fs.writeFileSync(`${manifestFile}.tmp`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.renameSync(`${manifestFile}.tmp`, manifestFile);
    fs.renameSync(tmp, path.join(d.managed, name));

    if (kind === 'scheduled') {
      const settings = await getBackupSettings(prisma);
      for (const old of scheduledToDelete(fs.readdirSync(d.managed), d.stem, settings.keep, settings.maxAgeDays, now)) removeBackupFiles(d.managed, old);
    }
    await setLastRun(prisma, { at: now.toISOString(), kind, ok: true, name, error: null });
    console.log(`[Backups] ${kind === 'manual' ? `Backup by ${createdBy}` : 'Scheduled backup'} written: ${name} (${mb(inspected.size)})`);
    return listBackups().find((b) => b.name === name)!;
  } catch (err) {
    const message = err instanceof AppError && err.details ? `${err.message}: ${err.details}` : (err as Error).message;
    console.error(`[Backups] ${kind} backup failed: ${message}`);
    await setLastRun(prisma, { at: now.toISOString(), kind, ok: false, name: null, error: message }).catch(() => {});
    throw err instanceof AppError ? err : new AppError(500, 'The backup failed', message);
  } finally {
    running = false;
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function deleteBackup(kind: string, name: string): void {
  const backup = resolveBackup(kind, name);
  // Those belong to the update process (db-backup.ts keeps its own number of them).
  if (backup.kind === 'before-update') throw new AppError(400, 'Copies taken before an update are rotated by the update itself and cannot be deleted here');
  if (!fs.existsSync(backup.file)) throw new AppError(404, 'No such backup');
  if (pendingFileOf(readPending(databaseFile())) === backup.file) throw new AppError(409, 'This backup is marked for a restore; cancel the restore first');
  removeBackupFiles(path.dirname(backup.file), name);
}

// --- Checking ----------------------------------------------------------------------

/** Compares a backup's migrations with the ones this backend ships. */
export function compareMigrations(backup: string[] | null, local: string[]): BackupCheckResult['migrations'] {
  if (backup === null) return { state: 'no-history', pending: [], unknown: [] };
  const unknown = backup.filter((m) => !local.includes(m));
  const pending = local.filter((m) => !backup.includes(m));
  return { state: unknown.length > 0 ? 'newer' : pending.length > 0 ? 'older' : 'ok', pending, unknown };
}

/** Tries the running key on the sampled values. GCM fails loudly on a wrong key, so a failure is never a false "ok". */
export function checkKey(samples: InspectedDb['encrypted'], decryptFn: (v: string) => string = decrypt): BackupCheckResult['key'] {
  const failedFields = new Set<string>();
  let failed = 0;
  for (const s of samples) {
    try {
      decryptFn(s.value);
    } catch {
      failed++;
      failedFields.add(s.field);
    }
  }
  return { checked: samples.length, failed, failedFields: [...failedFields] };
}

/** "Test backup": a copy in a throwaway folder gets the checks a restore will run. Nothing is replaced. */
export async function checkBackup(kind: string, name: string): Promise<BackupCheckResult> {
  const backup = resolveBackup(kind, name);
  if (!fs.existsSync(backup.file)) throw new AppError(404, 'No such backup');
  const size = fs.statSync(backup.file).size;
  const free = freeBytes(os.tmpdir());
  if (free !== null && free < size) throw new AppError(507, 'Not enough free space to test this backup', `${mb(free)} free in ${os.tmpdir()}, ${mb(size)} needed`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-backup-check-'));
  try {
    const inspected = await runWorker({ job: 'inspect', file: backup.file, copy: path.join(work, 'check.db') });
    // No manifest (a before-update copy, an uploaded bare .db): nothing to compare. One that exists but cannot be read is a mismatch.
    const hasManifest = backup.manifest !== null && fs.existsSync(backup.manifest);
    const manifest = hasManifest ? readManifest(backup.manifest) : null;
    const checksum = hasManifest ? { ok: manifest !== null && manifest.sha256 === inspected.sha256 && manifest.size === inspected.size } : null;
    const migrations = compareMigrations(inspected.integrity.ok ? inspected.migrations : null, migrationNames());
    const key = checkKey(inspected.encrypted);
    return {
      ok: inspected.integrity.ok && (checksum?.ok ?? true) && migrations.state !== 'newer' && key.failed === 0,
      integrity: inspected.integrity,
      checksum,
      migrations,
      key,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// --- Downloads ---------------------------------------------------------------------

/** A download link: the browser opens it itself, so the file streams to disk (see backup-downloads.routes.ts). */
export const backupDownloadLinks = new TicketStore<{ userId: number; kind: BackupKind; name: string }>(60_000);

// --- Uploads ------------------------------------------------------------------------

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

function startsWith(file: string, prefix: Buffer): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(prefix.length);
    return fs.readSync(fd, head, 0, head.length, 0) === head.length && head.equals(prefix);
  } finally {
    fs.closeSync(fd);
  }
}

const UPLOAD_TEMP = /^\.upload-\d+-(\d+)\.tmp$/;
const UPLOAD_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Where an upload is written while it arrives: hidden, so it never counts as a backup. Leftovers of uploads cut off more than a day ago are cleared here. */
export function uploadTempFile(now = Date.now()): string {
  const d = dirs();
  fs.mkdirSync(d.managed, { recursive: true, mode: 0o700 });
  for (const n of fs.readdirSync(d.managed)) {
    const m = UPLOAD_TEMP.exec(n);
    if (m && now - Number(m[1]) > UPLOAD_TEMP_MAX_AGE_MS) fs.rmSync(path.join(d.managed, n), { force: true });
  }
  return path.join(d.managed, `.upload-${process.pid}-${now}.tmp`);
}

/**
 * Turns an uploaded file into a backup of kind `uploaded`: a ZIP as the Backups page downloads it
 * (the .db and its manifest), or a bare .db. Anything else is refused. The temp file is gone afterwards.
 */
export function importUpload(tmp: string, now = new Date()): BackupEntry {
  const d = dirs();
  const name = managedName(d.stem, 'uploaded', now);
  const target = path.join(d.managed, name);
  const manifestTarget = path.join(d.managed, `${name.slice(0, -3)}.json`);
  const partial = path.join(d.managed, `.${name}.tmp`);
  try {
    if (isZip(tmp)) {
      let entries;
      try {
        entries = listZip(tmp);
      } catch (err) {
        throw new AppError(400, 'The ZIP file cannot be read', (err as Error).message);
      }
      const dbs = entries.filter((e) => e.name.endsWith('.db') && !e.name.includes('/'));
      if (dbs.length !== 1) throw new AppError(400, 'The ZIP must hold exactly one .db file, as a ZIP downloaded from this page does');
      try {
        extractZipEntry(tmp, dbs[0], partial);
        const json = entries.find((e) => e.name === `${dbs[0].name.slice(0, -3)}.json`);
        if (json && json.size < 1_000_000) {
          extractZipEntry(tmp, json, `${manifestTarget}.tmp`);
          // A manifest that is not one is left out: the checksum is then simply not compared.
          if (readManifest(`${manifestTarget}.tmp`)?.sha256) fs.renameSync(`${manifestTarget}.tmp`, manifestTarget);
          else fs.rmSync(`${manifestTarget}.tmp`, { force: true });
        }
      } catch (err) {
        throw err instanceof AppError ? err : new AppError(400, 'The ZIP file is damaged', (err as Error).message);
      }
    } else if (startsWith(tmp, SQLITE_HEADER)) {
      fs.renameSync(tmp, partial);
    } else {
      throw new AppError(400, 'This is neither a backup ZIP from this page nor a database file');
    }
    if (!startsWith(partial, SQLITE_HEADER)) throw new AppError(400, 'The .db in the ZIP is not a database file');
    fs.chmodSync(partial, 0o600);
    fs.renameSync(partial, target);
    return listBackups().find((b) => b.name === name)!;
  } catch (err) {
    fs.rmSync(partial, { force: true });
    fs.rmSync(`${manifestTarget}.tmp`, { force: true });
    fs.rmSync(manifestTarget, { force: true });
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// --- Restore --------------------------------------------------------------------------

function pendingFileOf(pending: PendingRestore | null): string | null {
  return pending ? path.resolve(dirs().backups, pending.file) : null;
}

/** The kind and name of a backup file path, if it is one the page lists. */
function entryOfFile(file: string): { kind: BackupKind; name: string } | null {
  const d = dirs();
  const name = path.basename(file);
  const managed = managedPattern(d.stem).exec(name);
  if (path.dirname(file) === d.managed && managed) return { kind: managed[2] as ManagedKind, name };
  if (path.dirname(file) === d.backups && beforeUpdatePattern(d.stem).test(name)) return { kind: 'before-update', name };
  return null;
}

export function pendingRestoreView(): BackupOverview['pendingRestore'] {
  const pending = readPending(databaseFile());
  const entry = pending ? entryOfFile(pendingFileOf(pending)!) : null;
  return pending && entry ? { ...entry, requestedBy: pending.requestedBy, requestedAt: pending.requestedAt } : null;
}

export function lastRestoreView(): BackupRestoreResult | null {
  const result = readResult(databaseFile());
  if (!result) return null;
  const file = path.resolve(dirs().backups, result.file);
  const entry = fs.existsSync(file) ? entryOfFile(file) : null;
  return {
    at: result.at, ok: result.ok, kind: entry?.kind ?? null, name: entry?.name ?? path.basename(result.file),
    requestedBy: result.requestedBy, beforeRestore: result.beforeRestore, rolledBack: result.rolledBack, error: result.error,
  };
}

/**
 * Marks a backup for restore at the next start (db-restore.ts applies it), after the same checks
 * as "test backup". Refused: a damaged or changed file, one from a newer backend, one from before
 * versioned migrations (the start could not adopt it safely), and - unless the admin accepted it -
 * one whose encrypted values the running key cannot read.
 */
export async function requestRestore(kind: string, name: string, requestedBy: string, acceptKeyMismatch: boolean): Promise<BackupCheckResult> {
  const backup = resolveBackup(kind, name);
  const check = await checkBackup(kind, name);
  if (!check.integrity.ok) throw new AppError(409, 'This backup is damaged', check.integrity.message, 'DAMAGED');
  if (check.checksum && !check.checksum.ok) throw new AppError(409, 'This backup changed after it was written (checksum mismatch)', undefined, 'CHECKSUM');
  if (check.migrations.state === 'newer') throw new AppError(409, 'This backup was written by a newer backend version; this one cannot take it', check.migrations.unknown.join(', '), 'NEWER');
  if (check.migrations.state === 'no-history') throw new AppError(409, 'This backup is from before versioned migrations; restore it by hand as described in the wiki (Troubleshooting)', undefined, 'NO_HISTORY');
  if (check.key.failed > 0 && !acceptKeyMismatch) throw new AppError(409, 'The running key cannot decrypt values in this backup', check.key.failedFields.join(', '), 'KEY_MISMATCH');
  const dbFile = databaseFile();
  writePending(dbFile, {
    file: path.relative(dirs(dbFile).backups, backup.file),
    // The start restores exactly the file that was checked, or nothing.
    sha256: sha256File(backup.file),
    requestedBy,
    requestedAt: new Date().toISOString(),
  });
  console.log(`[Backups] Restore of ${name} marked by ${requestedBy}; applied at the next start`);
  return check;
}

export function cancelRestore(): boolean {
  const dbFile = databaseFile();
  if (!readPending(dbFile)) return false;
  clearPending(dbFile);
  return true;
}

// --- Settings and last run --------------------------------------------------------

export function isValidBackupSettings(v: unknown): v is BackupSettings {
  const s = v as BackupSettings;
  return (
    !!s && typeof s === 'object' &&
    typeof s.scheduleEnabled === 'boolean' &&
    typeof s.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) &&
    Array.isArray(s.days) && s.days.length > 0 && s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    Number.isInteger(s.keep) && s.keep >= BACKUP_KEEP_MIN && s.keep <= BACKUP_KEEP_MAX &&
    (s.maxAgeDays === null || (Number.isInteger(s.maxAgeDays) && s.maxAgeDays >= BACKUP_MAX_AGE_MIN && s.maxAgeDays <= BACKUP_MAX_AGE_MAX)) &&
    Number.isInteger(s.maxUploadMb) && s.maxUploadMb >= BACKUP_UPLOAD_MB_MIN && s.maxUploadMb <= BACKUP_UPLOAD_MB_MAX
  );
}

export async function getBackupSettings(prisma: PrismaClient): Promise<BackupSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY_SETTINGS } });
  if (!row) return { ...BACKUP_DEFAULTS };
  try {
    const merged = { ...BACKUP_DEFAULTS, ...JSON.parse(row.value) };
    // A hand-edited or outdated value falls back rather than feeding the schedule something invalid.
    return isValidBackupSettings(merged) ? merged : { ...BACKUP_DEFAULTS };
  } catch {
    return { ...BACKUP_DEFAULTS };
  }
}

export async function setBackupSettings(prisma: PrismaClient, s: BackupSettings): Promise<void> {
  const value = JSON.stringify({ scheduleEnabled: s.scheduleEnabled, time: s.time, days: [...new Set(s.days)].sort(), keep: s.keep, maxAgeDays: s.maxAgeDays, maxUploadMb: s.maxUploadMb });
  await prisma.appSetting.upsert({ where: { key: KEY_SETTINGS }, create: { key: KEY_SETTINGS, value }, update: { value } });
}

export async function getLastRun(prisma: PrismaClient): Promise<BackupLastRun | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY_LAST_RUN } });
  try {
    return row ? (JSON.parse(row.value) as BackupLastRun) : null;
  } catch {
    return null;
  }
}

async function setLastRun(prisma: PrismaClient, run: BackupLastRun): Promise<void> {
  const value = JSON.stringify(run);
  await prisma.appSetting.upsert({ where: { key: KEY_LAST_RUN }, create: { key: KEY_LAST_RUN, value }, update: { value } });
}

// --- Schedule ------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 30_000;

/** Same pattern as the scheduled restart: the config is re-read every tick, so a change applies without a restart. */
export function startBackupScheduler(prisma: PrismaClient): void {
  let lastFired: string | null = null;
  const timer = setInterval(async () => {
    let settings: BackupSettings;
    try {
      settings = await getBackupSettings(prisma);
    } catch {
      return;
    }
    if (!settings.scheduleEnabled) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const slot = `${now.toDateString()} ${settings.time}`;
    if (hhmm !== settings.time || !settings.days.includes(now.getDay()) || slot === lastFired) return;
    lastFired = slot; // claim the slot before anything async
    const startedAt = Date.now();
    try {
      await createBackup(prisma, 'scheduled', null, now);
    } catch (err) {
      // Shown on the Backups page (last run) and kept in the change log.
      const message = err instanceof AppError && err.details ? `${err.message}: ${err.details}` : (err as Error).message;
      try {
        if (!(await getChangeLogSettings(prisma)).enabled) return;
      } catch {
        return;
      }
      recordChange(prisma, {
        createdAt: new Date(startedAt), userId: null, username: 'system', role: 'system', ip: null,
        method: 'POST', area: 'backups', routePattern: '/backups (schedule)', serverConfigId: null, virtualServerId: null, targetId: null, body: null,
        status: 'error', httpStatus: err instanceof AppError ? err.statusCode : 500, errorMessage: message,
        durationMs: Date.now() - startedAt, loggedToTeamSpeak: false, changes: null,
      });
    }
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
}
