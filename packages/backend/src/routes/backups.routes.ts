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
  snapshotDirOf,
} from '../utils/backups.js';
import { ZipWriter, archiveSize } from '../utils/zip-stream.js';

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
  };
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
    // The upload, and the .db unpacked from it next to it.
    const free = freeBytes(path.dirname(tmp));
    if (free !== null && free < 2 * size) {
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
    const entry = importUpload(tmp);
    tmp = null;
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
    const check = await requestRestore(String(req.params.kind), String(req.params.name), req.user!.username, acceptKeyMismatch);
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
    await setBackupSettings(req.app.locals.prisma, req.body);
    console.log(`[Backups] Settings updated by ${req.user?.username}: schedule ${req.body.scheduleEnabled ? `on at ${req.body.time}` : 'off'}, keep ${req.body.keep}, upload limit ${req.body.maxUploadMb} MB, TeamSpeak snapshots ${req.body.includeTsSnapshots ? 'on' : 'off'}`);
    res.json(await overview(req));
  } catch (err) { next(err); }
});

// POST /api/backups/:kind/:name/check - "test backup", nothing is replaced
backupRoutes.post('/:kind/:name/check', async (req: Request, res: Response, next) => {
  try { res.json(await checkBackup(String(req.params.kind), String(req.params.name))); } catch (err) { next(err); }
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

    const backup = resolveBackup(link.kind, link.name);
    if (!fs.existsSync(backup.file)) throw new AppError(404, 'No such backup');
    // The .db, its manifest, and its TeamSpeak snapshots as <name>.teamspeak/<connection>-<sid>.json.
    const snapshotDir = snapshotDirOf(backup.file);
    const snapshots = fs.existsSync(snapshotDir) ? fs.readdirSync(snapshotDir).filter((n) => n.endsWith('.json')).map((n) => path.join(snapshotDir, n)) : [];
    const files = [backup.file, ...(backup.manifest && fs.existsSync(backup.manifest) ? [backup.manifest] : []), ...snapshots].map((file) => {
      const stat = fs.statSync(file);
      const name = path.dirname(file) === snapshotDir ? `${path.basename(snapshotDir)}/${path.basename(file)}` : path.basename(file);
      return { file, name, size: stat.size, modified: stat.mtimeMs, isDirectory: false };
    });

    res.attachment(`${link.name.slice(0, -3)}.zip`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(archiveSize(files)));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const zip = new ZipWriter(res);
      for (const f of files) {
        await zip.addFile(f.name, f.size, f.modified, (sink) => new Promise<void>((resolve, reject) => {
          fs.createReadStream(f.file).on('error', reject).pipe(sink).on('finish', resolve).on('error', reject);
        }));
      }
      await zip.finish();
    } catch {
      // Bytes are on their way: cutting the connection makes the browser report a failed download instead of saving half a file.
      res.destroy();
    }
  } catch (err) {
    if (res.headersSent) return;
    next(err);
  }
});
