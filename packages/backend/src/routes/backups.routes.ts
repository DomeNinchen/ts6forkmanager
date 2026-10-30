import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BackupOverview } from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import { allowSlowBody } from '../middleware/request-timeout.js';
import {
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  BACKUP_MAX_AGE_MAX,
  BACKUP_MAX_AGE_MIN,
  BACKUP_UPLOAD_MB_MAX,
  BACKUP_UPLOAD_MB_MIN,
  backupDownloadLinks,
  cancelRestore,
  checkBackup,
  importUpload,
  lastRestoreView,
  pendingRestoreView,
  requestRestore,
  uploadTempFile,
  createBackup,
  databaseBytes,
  databaseFile,
  deleteBackup,
  freeBytes,
  getBackupSettings,
  getLastRun,
  isValidBackupSettings,
  listBackups,
  resolveBackup,
  setBackupSettings,
  PASSPHRASE_MIN_LENGTH,
  backupZipFiles,
  checkTargetDir,
  decryptIfNeeded,
  getPassphrase,
  hasPassphrase,
  localOfExternal,
  setPassphrase,
  writeBackupZip,
} from '../utils/backups.js';
import { archiveSize } from '../utils/zip-stream.js';
import { OPENSSL_DECRYPT_COMMAND, encryptedSize, encryptor } from '../utils/backup-crypt.js';

/**
 * The Backups page (R7). Mounted behind the admin check (app.ts): a backup holds password
 * hashes and the encrypted TeamSpeak credentials. Every writing route here is recorded by the
 * change-log middleware (area "backups", fail-closed) - the download too, since it is asked
 * for with a POST that hands out the link.
 */
export const backupRoutes: Router = Router();

async function overview(req: Request): Promise<BackupOverview> {
  const prisma = req.app.locals.prisma;
  const [settings, lastRun] = await Promise.all([getBackupSettings(prisma), getLastRun(prisma)]);
  const dbFile = databaseFile();
  const now = new Date();
  return {
    serverTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    backups: listBackups(),
    settings,
    lastRun,
    freeBytes: freeBytes(path.dirname(dbFile)),
    databaseBytes: databaseBytes(dbFile),
    bounds: {
      keepMin: BACKUP_KEEP_MIN, keepMax: BACKUP_KEEP_MAX, maxAgeMin: BACKUP_MAX_AGE_MIN, maxAgeMax: BACKUP_MAX_AGE_MAX,
      uploadMbMin: BACKUP_UPLOAD_MB_MIN, uploadMbMax: BACKUP_UPLOAD_MB_MAX,
    },
    pendingRestore: pendingRestoreView(),
    lastRestore: lastRestoreView(),
    passphraseSet: await hasPassphrase(prisma),
    target: settings.targetDir
      ? (() => { const error = checkTargetDir(settings.targetDir); return { ok: error === null, error, freeBytes: error ? null : freeBytes(settings.targetDir) }; })()
      : null,
    decryptCommand: OPENSSL_DECRYPT_COMMAND,
  };
}

/** An external backup is tested and restored through the volume's copy, taken in from the target directory when there is none. */
async function localKindAndName(req: Request): Promise<{ kind: string; name: string }> {
  const kind = String(req.params.kind);
  const name = String(req.params.name);
  if (kind !== 'external') return { kind, name };
  await getBackupSettings(req.app.locals.prisma); // the target directory as it is now
  return localOfExternal(name, await getPassphrase(req.app.locals.prisma));
}

// PUT /api/backups/uploads - a backup file as the raw request body (a ZIP from this page, or a .db)
backupRoutes.put('/uploads', async (req: Request, res: Response, next) => {
  let tmp: string | null = null;
  try {
    const size = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(size) || size <= 0) {
      res.setHeader('Connection', 'close');
      throw new AppError(411, 'The upload needs a Content-Length');
    }
    const { maxUploadMb } = await getBackupSettings(req.app.locals.prisma);
    if (size > maxUploadMb * 1024 * 1024) {
      res.setHeader('Connection', 'close');
      throw new AppError(413, 'The file is larger than the upload limit for backups', `${size} bytes, the limit is ${maxUploadMb} MB (set on the Backups page)`);
    }
    tmp = uploadTempFile();
    // The upload, its decrypted form, and the .db unpacked from it.
    const free = freeBytes(path.dirname(tmp));
    if (free !== null && free < 3 * size) {
      res.setHeader('Connection', 'close');
      throw new AppError(507, 'Not enough free space for this upload', `${(free / 1048576).toFixed(1)} MB free, ${((2 * size) / 1048576).toFixed(1)} MB needed`);
    }
    allowSlowBody(req);
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        cb(received > size ? new Error('The body is longer than announced') : null, chunk);
      },
    });
    await pipeline(req, counter, fs.createWriteStream(tmp, { mode: 0o600 }));
    if (received !== size) throw new AppError(400, `The upload broke off (${received} of ${size} bytes)`);
    // An encrypted file (a download or a copy from the target directory) is opened with the passphrase.
    const uploaded = tmp;
    tmp = null;
    const entry = importUpload(await decryptIfNeeded(uploaded, await getPassphrase(req.app.locals.prisma)));
    console.log(`[Backups] ${entry.name} uploaded by ${req.user?.username} (${size} bytes)`);
    res.status(201).json(entry);
  } catch (err) {
    if (tmp) fs.rmSync(tmp, { force: true });
    if (res.headersSent || res.destroyed) return;
    next(err);
  }
});

// POST /api/backups/:kind/:name/restore - checks it, marks it for the next start, then restarts the backend
backupRoutes.post('/:kind/:name/restore', async (req: Request, res: Response, next) => {
  try {
    const acceptKeyMismatch = req.body?.acceptKeyMismatch === true;
    const { kind, name } = await localKindAndName(req);
    const check = await requestRestore(kind, name, req.user!.username, acceptKeyMismatch);
    res.status(202).json({ check, restarting: true });
    // Same mechanism as the scheduled restart: the container's restart policy brings it back, and the start applies the restore.
    res.on('finish', () => setTimeout(() => {
      console.log('[Backups] Restarting the backend to apply the restore');
      process.kill(process.pid, 'SIGTERM');
    }, 1500));
  } catch (err) { next(err); }
});

// DELETE /api/backups/restore - a marked restore is not applied after all
backupRoutes.delete('/restore', async (req: Request, res: Response, next) => {
  try {
    if (!cancelRestore()) throw new AppError(404, 'No restore is marked');
    console.log(`[Backups] Marked restore cancelled by ${req.user?.username}`);
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/backups - list, schedule, last run, free space
backupRoutes.get('/', async (req: Request, res: Response, next) => {
  try { res.json(await overview(req)); } catch (err) { next(err); }
});

// POST /api/backups - back up now
backupRoutes.post('/', async (req: Request, res: Response, next) => {
  try {
    res.status(201).json(await createBackup(req.app.locals.prisma, 'manual', req.user?.username ?? null, new Date(), req.app.locals.connectionPool));
  } catch (err) { next(err); }
});

// PUT /api/backups/settings - schedule and retention
backupRoutes.put('/settings', async (req: Request, res: Response, next) => {
  try {
    if (!isValidBackupSettings(req.body)) {
      throw new AppError(400, `Invalid settings: time "HH:MM", at least one day 0-6, keep ${BACKUP_KEEP_MIN}-${BACKUP_KEEP_MAX}, maxAgeDays null or ${BACKUP_MAX_AGE_MIN}-${BACKUP_MAX_AGE_MAX}, maxUploadMb ${BACKUP_UPLOAD_MB_MIN}-${BACKUP_UPLOAD_MB_MAX}`);
    }
    if (req.body.targetDir !== null) {
      const problem = checkTargetDir(req.body.targetDir);
      if (problem) throw new AppError(400, 'This directory cannot hold the backups', problem);
    }
    await setBackupSettings(req.app.locals.prisma, req.body);
    console.log(`[Backups] Settings updated by ${req.user?.username}: schedule ${req.body.scheduleEnabled ? `on at ${req.body.time}` : 'off'}, keep ${req.body.keep}, upload limit ${req.body.maxUploadMb} MB, TeamSpeak snapshots ${req.body.includeTsSnapshots ? 'on' : 'off'}, target ${req.body.targetDir ?? 'none'}`);
    res.json(await overview(req));
  } catch (err) { next(err); }
});

// PUT /api/backups/passphrase - { passphrase: string | null }; encrypts copies in the target directory and downloads
backupRoutes.put('/passphrase', async (req: Request, res: Response, next) => {
  try {
    const passphrase = req.body?.passphrase;
    if (passphrase !== null && (typeof passphrase !== 'string' || passphrase.length < PASSPHRASE_MIN_LENGTH || passphrase.length > 1024)) {
      throw new AppError(400, `The passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters long`);
    }
    await setPassphrase(req.app.locals.prisma, passphrase);
    console.log(`[Backups] Passphrase ${passphrase === null ? 'removed' : 'set'} by ${req.user?.username}`);
    res.json(await overview(req));
  } catch (err) { next(err); }
});

// POST /api/backups/:kind/:name/check - "test backup", nothing is replaced
backupRoutes.post('/:kind/:name/check', async (req: Request, res: Response, next) => {
  try {
    const { kind, name } = await localKindAndName(req);
    res.json(await checkBackup(kind, name));
  } catch (err) { next(err); }
});

// POST /api/backups/:kind/:name/download-links - a one-time link for the browser to open
backupRoutes.post('/:kind/:name/download-links', async (req: Request, res: Response, next) => {
  try {
    const backup = resolveBackup(String(req.params.kind), String(req.params.name));
    if (!fs.existsSync(backup.file)) throw new AppError(404, 'No such backup');
    const token = backupDownloadLinks.issue({ userId: req.user!.id, kind: backup.kind, name: path.basename(backup.file) });
    res.json({ url: `/api/backup-downloads/${token}` });
  } catch (err) { next(err); }
});

// DELETE /api/backups/:kind/:name
backupRoutes.delete('/:kind/:name', async (req: Request, res: Response, next) => {
  try {
    deleteBackup(String(req.params.kind), String(req.params.name));
    console.log(`[Backups] ${req.params.name} deleted by ${req.user?.username}`);
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * Redeems a link from `POST .../download-links`. Mounted before the login check on purpose,
 * like file-downloads.routes.ts: a link the browser follows carries no Authorization header,
 * so the link is the credential - 256 random bits, a minute, one use.
 */
export const backupDownloadRoutes: Router = Router();

backupDownloadRoutes.get('/:token', async (req: Request, res: Response, next) => {
  try {
    const link = backupDownloadLinks.take(String(req.params.token));
    if (!link) throw new AppError(404, 'This download link has expired or was already used');
    const user = await req.app.locals.prisma.user.findUnique({ where: { id: link.userId }, select: { enabled: true, role: true } });
    if (!user?.enabled || user.role !== 'admin') throw new AppError(403, 'Insufficient permissions');

    await getBackupSettings(req.app.locals.prisma); // the target directory as it is now
    const backup = resolveBackup(link.kind, link.name);
    if (!fs.existsSync(backup.file)) throw new AppError(404, 'No such backup');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // A copy from the target directory goes out as it lies there (a ZIP, or an encrypted one).
    if (backup.kind === 'external') {
      res.attachment(link.name);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(fs.statSync(backup.file).size));
      try {
        await pipeline(fs.createReadStream(backup.file), res);
      } catch {
        res.destroy();
      }
      return;
    }

    // The .db, its manifest and its TeamSpeak snapshots, as a ZIP - encrypted when a passphrase is set.
    const files = backupZipFiles(backup.file, backup.manifest);
    const zipBytes = archiveSize(files);
    const passphrase = await getPassphrase(req.app.locals.prisma);
    res.attachment(`${link.name.slice(0, -3)}.zip${passphrase ? '.enc' : ''}`);
    res.setHeader('Content-Type', passphrase ? 'application/octet-stream' : 'application/zip');
    res.setHeader('Content-Length', String(passphrase ? encryptedSize(zipBytes) : zipBytes));
    try {
      if (passphrase) {
        const { header, cipher } = await encryptor(passphrase);
        res.write(header);
        cipher.pipe(res);
        await writeBackupZip(files, cipher);
      } else {
        await writeBackupZip(files, res);
      }
    } catch {
      // Bytes are on their way: cutting the connection makes the browser report a failed download instead of saving half a file.
      res.destroy();
    }
  } catch (err) {
    if (res.headersSent) return;
    next(err);
  }
});
