import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { BackupOverview } from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import {
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  BACKUP_MAX_AGE_MAX,
  BACKUP_MAX_AGE_MIN,
  backupDownloadLinks,
  checkBackup,
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
  return {
    backups: listBackups(),
    settings,
    lastRun,
    freeBytes: freeBytes(path.dirname(dbFile)),
    databaseBytes: databaseBytes(dbFile),
    bounds: { keepMin: BACKUP_KEEP_MIN, keepMax: BACKUP_KEEP_MAX, maxAgeMin: BACKUP_MAX_AGE_MIN, maxAgeMax: BACKUP_MAX_AGE_MAX },
  };
}

// GET /api/backups - list, schedule, last run, free space
backupRoutes.get('/', async (req: Request, res: Response, next) => {
  try { res.json(await overview(req)); } catch (err) { next(err); }
});

// POST /api/backups - back up now
backupRoutes.post('/', async (req: Request, res: Response, next) => {
  try {
    res.status(201).json(await createBackup(req.app.locals.prisma, 'manual', req.user?.username ?? null));
  } catch (err) { next(err); }
});

// PUT /api/backups/settings - schedule and retention
backupRoutes.put('/settings', async (req: Request, res: Response, next) => {
  try {
    if (!isValidBackupSettings(req.body)) {
      throw new AppError(400, `Invalid settings: time "HH:MM", at least one day 0-6, keep ${BACKUP_KEEP_MIN}-${BACKUP_KEEP_MAX}, maxAgeDays null or ${BACKUP_MAX_AGE_MIN}-${BACKUP_MAX_AGE_MAX}`);
    }
    await setBackupSettings(req.app.locals.prisma, req.body);
    console.log(`[Backups] Schedule updated by ${req.user?.username}: ${req.body.scheduleEnabled ? `on at ${req.body.time}` : 'off'}, keep ${req.body.keep}`);
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
    const files = [backup.file, ...(backup.manifest && fs.existsSync(backup.manifest) ? [backup.manifest] : [])].map((file) => {
      const stat = fs.statSync(file);
      return { file, name: path.basename(file), size: stat.size, modified: stat.mtimeMs, isDirectory: false };
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
