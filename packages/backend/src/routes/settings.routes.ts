/**
 * Settings routes — app-wide configuration (admin only).
 * Currently handles yt-dlp cookie file management.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { AppError } from '../middleware/error-handler.js';
import { setYtCookieFile, getYtCookieFile } from '../voice/audio/youtube.js';
import { getDebugFlags, setDebugFlag, type DebugFlagName } from '../utils/debug-flags.js';
import { getScheduledRestartConfig, setScheduledRestartConfig, type ScheduledRestartConfig } from '../utils/scheduled-restart.js';
import type { VoiceBotManager } from '../voice/voice-bot-manager.js';

const settingsRoutes: Router = Router();

// Cookie file stored in the backend data directory (persisted in Docker volume)
const COOKIE_DIR = path.resolve('data');
const COOKIE_PATH = path.join(COOKIE_DIR, 'yt-cookies.txt');

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  storage: multer.memoryStorage(),
});

// Admin-only guard
function requireAdmin(req: Request, _res: Response, next: Function) {
  if ((req as any).user?.role !== 'admin') {
    return next(new AppError(403, 'Admin access required'));
  }
  next();
}

// GET /api/settings/yt-cookies — Check cookie file status
settingsRoutes.get('/yt-cookies', requireAdmin, (_req: Request, res: Response) => {
  const exists = fs.existsSync(COOKIE_PATH);
  const activePath = getYtCookieFile();
  res.json({
    active: !!activePath,
    exists,
    size: exists ? fs.statSync(COOKIE_PATH).size : 0,
    path: activePath,
  });
});

// POST /api/settings/yt-cookies — Upload cookie file
settingsRoutes.post('/yt-cookies', requireAdmin, upload.single('cookies'), (req: Request, res: Response, next) => {
  try {
    if (!req.file) {
      // Check if raw text was sent in body
      const text = req.body?.text;
      if (!text || typeof text !== 'string') {
        throw new AppError(400, 'No cookie file or text provided');
      }
      fs.mkdirSync(COOKIE_DIR, { recursive: true });
      fs.writeFileSync(COOKIE_PATH, text, 'utf-8');
    } else {
      fs.mkdirSync(COOKIE_DIR, { recursive: true });
      fs.writeFileSync(COOKIE_PATH, req.file.buffer);
    }

    setYtCookieFile(COOKIE_PATH);
    const size = fs.statSync(COOKIE_PATH).size;
    console.log(`[yt-dlp] Cookie file uploaded (${size} bytes)`);
    res.json({ success: true, size });
  } catch (err) { next(err); }
});

// DELETE /api/settings/yt-cookies — Remove cookie file
settingsRoutes.delete('/yt-cookies', requireAdmin, (_req: Request, res: Response, next) => {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      fs.unlinkSync(COOKIE_PATH);
    }
    setYtCookieFile(null);
    console.log('[yt-dlp] Cookie file removed');
    res.json({ success: true });
  } catch (err) { next(err); }
});

const VALID_DEBUG_FLAGS: DebugFlagName[] = ['voice', 'rankCheck'];

// GET /api/settings/debug-flags — Current debug-logging toggle states
settingsRoutes.get('/debug-flags', requireAdmin, (_req: Request, res: Response) => {
  res.json(getDebugFlags());
});

// PUT /api/settings/debug-flags/:name — Toggle one debug-logging flag
settingsRoutes.put('/debug-flags/:name', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const name = req.params.name as DebugFlagName;
    if (!VALID_DEBUG_FLAGS.includes(name)) {
      throw new AppError(400, `Unknown debug flag: ${name}`);
    }
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      throw new AppError(400, 'enabled must be a boolean');
    }
    const prisma = req.app.locals.prisma;
    await setDebugFlag(prisma, name, enabled);
    console.log(`[Settings] Debug flag '${name}' set to ${enabled}`);
    res.json(getDebugFlags());
  } catch (err) { next(err); }
});

// Both reset endpoints below wipe the table across every server (not just
// the one currently selected in the UI) and reset its id counter back to 1
// - see clusterzx/ts6-manager#58. SQLite's autoincrement counter is per
// table, not per-server, so there's no way to "reset" it without actually
// emptying the whole table first; that's why the frontend disclaims this as
// an all-servers action.

// POST /api/settings/reset-radio-station-ids — Delete ALL radio stations (every server) and reset the id counter
settingsRoutes.post('/reset-radio-station-ids', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const { count } = await prisma.radioStation.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM sqlite_sequence WHERE name = 'RadioStation'`);
    console.log(`[Settings] Reset radio station IDs (${count} station(s) deleted)`);
    res.json({ deletedCount: count });
  } catch (err) { next(err); }
});

// POST /api/settings/reset-music-bot-ids — Stop + delete ALL music bots (every server) and reset the id counter
settingsRoutes.post('/reset-music-bot-ids', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const manager: VoiceBotManager = req.app.locals.voiceBotManager;
    const count = await manager.removeAllBots();
    await prisma.$executeRawUnsafe(`DELETE FROM sqlite_sequence WHERE name = 'MusicBot'`);
    console.log(`[Settings] Reset music bot IDs (${count} bot(s) deleted)`);
    res.json({ deletedCount: count });
  } catch (err) { next(err); }
});

// GET /api/settings/scheduled-restart — Current scheduled-restart config
settingsRoutes.get('/scheduled-restart', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    res.json(await getScheduledRestartConfig(prisma));
  } catch (err) { next(err); }
});

// PUT /api/settings/scheduled-restart — Update scheduled-restart config
settingsRoutes.put('/scheduled-restart', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { backendEnabled, sidecarEnabled, time, days } = req.body;
    if (typeof backendEnabled !== 'boolean' || typeof sidecarEnabled !== 'boolean') {
      throw new AppError(400, 'backendEnabled and sidecarEnabled must be booleans');
    }
    if (typeof time !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
      throw new AppError(400, 'time must be HH:MM (24h)');
    }
    if (!Array.isArray(days) || days.some((d: any) => typeof d !== 'number' || d < 0 || d > 6)) {
      throw new AppError(400, 'days must be an array of numbers 0-6');
    }

    const config: ScheduledRestartConfig = { backendEnabled, sidecarEnabled, time, days };
    const prisma = req.app.locals.prisma;
    await setScheduledRestartConfig(prisma, config);
    console.log(`[Settings] Scheduled restart config updated: ${JSON.stringify(config)}`);
    res.json(config);
  } catch (err) { next(err); }
});

export { settingsRoutes };
