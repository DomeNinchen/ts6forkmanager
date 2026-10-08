/**
 * Settings routes — app-wide configuration (admin only).
 * Currently handles yt-dlp cookie file management.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { AppError } from '../middleware/error-handler.js';
import { config } from '../config.js';
import { buildChain, normalizeAddress, suggestHops, trustProxyEnvValue } from '../utils/trust-proxy.js';
import { setYtCookieFile, getYtCookieFile } from '../voice/audio/youtube.js';
import { getDebugFlags, setDebugFlag, type DebugFlagName } from '../utils/debug-flags.js';
import { getScheduledRestartConfig, setScheduledRestartConfig, type ScheduledRestartConfig } from '../utils/scheduled-restart.js';
import { getOidcConfig, setOidcConfig, type OidcConfig } from '../utils/oidc-config.js';
import { getGithubToken, setGithubToken } from '../utils/github-token.js';
import { getKeepPlayedSongs, setKeepPlayedSongs } from '../utils/storage-settings.js';
import { setPrivacyNoticeEnabled } from '../utils/privacy-notice-settings.js';
import { getStreamDefaults, setStreamDefaults, builtInStreamDefaults, BITRATE_PATTERN } from '../utils/stream-defaults.js';
import {
  getUserHistorySettings,
  setUserHistorySettings,
  isValidUserHistoryInterval,
  isValidUserHistoryRetention,
  USER_HISTORY_DEFAULTS,
  USER_HISTORY_INTERVAL_OPTIONS,
  USER_HISTORY_RETENTION_MIN_DAYS,
  USER_HISTORY_RETENTION_MAX_DAYS,
  type UserHistorySettings,
} from '../utils/user-history-settings.js';
import type { UserHistorySampler } from '../ts-client/user-history-sampler.js';
import { CONSOLE_AUDIT_RETENTION_BOUNDS } from '@ts6/common';
import { getConsoleSettings, setConsoleSettings } from '../utils/console-settings.js';
import { STREAM_PRESETS } from '../voice/streaming/types.js';
import { forceCookieCheck } from '../utils/yt-cookie-check.js';
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
settingsRoutes.post('/yt-cookies', requireAdmin, upload.single('cookies'), async (req: Request, res: Response, next) => {
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
    // Validate right away rather than waiting for the next periodic check, so
    // the admin gets immediate feedback on whether the upload actually works.
    const check = await forceCookieCheck();
    res.json({ success: true, size, ...check });
  } catch (err) { next(err); }
});

// DELETE /api/settings/yt-cookies — Remove cookie file
settingsRoutes.delete('/yt-cookies', requireAdmin, async (_req: Request, res: Response, next) => {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      fs.unlinkSync(COOKIE_PATH);
    }
    setYtCookieFile(null);
    console.log('[yt-dlp] Cookie file removed');
    await forceCookieCheck();
    res.json({ success: true });
  } catch (err) { next(err); }
});

const VALID_DEBUG_FLAGS: DebugFlagName[] = ['voice', 'rankCheck', 'query'];

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

// GET /api/settings/client-ip — How this very request reached the backend and whom the
// backend takes for the client, so an admin can check TRUST_PROXY against their own
// address instead of guessing how many proxies sit in front of the app.
settingsRoutes.get('/client-ip', requireAdmin, (req: Request, res: Response) => {
  const header = (name: string): string | null => {
    const value = req.headers[name];
    const text = Array.isArray(value) ? value.join(', ') : value;
    return text && text.trim() !== '' ? text : null;
  };
  const forwardedFor = header('x-forwarded-for');
  const chain = buildChain(req.socket.remoteAddress, forwardedFor ?? undefined);
  res.json({
    ip: normalizeAddress(req.ip ?? ''),
    socketAddress: req.socket.remoteAddress ? normalizeAddress(req.socket.remoteAddress) : null,
    forwardedFor,
    realIp: header('x-real-ip'),
    trustProxy: {
      description: config.trustProxy.description,
      envValue: trustProxyEnvValue(config.trustProxy.value),
      fromEnv: config.trustProxy.fromEnv,
      warning: config.trustProxy.warning ?? null,
    },
    chain,
    suggestedHops: suggestHops(chain),
  });
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

// GET /api/settings/oidc — current SSO config (never returns the actual client secret, just whether one is set)
settingsRoutes.get('/oidc', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const oidc = await getOidcConfig(prisma);
    res.json({
      enabled: oidc.enabled,
      issuer: oidc.issuer,
      clientId: oidc.clientId,
      buttonLabel: oidc.buttonLabel,
      hasClientSecret: !!oidc.clientSecret,
    });
  } catch (err) { next(err); }
});

// PUT /api/settings/oidc — update SSO config. clientSecret: '' means "keep the existing one" (same convention as server connections' apiKey/sshPassword)
settingsRoutes.put('/oidc', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { enabled, issuer, clientId, clientSecret, buttonLabel } = req.body;
    if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
    if (typeof issuer !== 'string' || typeof clientId !== 'string') throw new AppError(400, 'issuer and clientId must be strings');
    if (enabled) {
      try { new URL(issuer); } catch { throw new AppError(400, 'issuer must be a valid URL'); }
      if (!clientId) throw new AppError(400, 'clientId is required to enable SSO');
    }

    const prisma = req.app.locals.prisma;
    const existing = await getOidcConfig(prisma);
    const next_: OidcConfig = {
      enabled,
      issuer,
      clientId,
      clientSecret: clientSecret === '' ? existing.clientSecret : String(clientSecret ?? ''),
      buttonLabel: buttonLabel || existing.buttonLabel,
    };
    await setOidcConfig(prisma, next_);
    res.json({
      enabled: next_.enabled,
      issuer: next_.issuer,
      clientId: next_.clientId,
      buttonLabel: next_.buttonLabel,
      hasClientSecret: !!next_.clientSecret,
    });
  } catch (err) { next(err); }
});

// GET /api/settings/github-token — whether a token is configured (never returns the actual value)
settingsRoutes.get('/github-token', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const token = await getGithubToken(prisma);
    res.json({ hasToken: !!token });
  } catch (err) { next(err); }
});

// PUT /api/settings/github-token — set/replace the token used for the update-checker's GitHub API calls
settingsRoutes.put('/github-token', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { token } = req.body;
    if (typeof token !== 'string' || !token.trim()) throw new AppError(400, 'token is required');
    const prisma = req.app.locals.prisma;
    await setGithubToken(prisma, token.trim());
    res.json({ hasToken: true });
  } catch (err) { next(err); }
});

// DELETE /api/settings/github-token — remove it, falling back to unauthenticated GitHub API calls (60/hour)
settingsRoutes.delete('/github-token', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    await setGithubToken(prisma, null);
    res.json({ hasToken: false });
  } catch (err) { next(err); }
});

const VALID_ACCENT_PRESETS = ['violet', 'teal', 'red', 'blue', 'yellow', 'green', 'orange', 'pink', 'cyan', 'lime'] as const;
type AccentPreset = (typeof VALID_ACCENT_PRESETS)[number];

// GET /api/settings/webgui-theme — the installation-wide default accent preset (any logged-in
// user needs to read this, not just admins, so it can be applied for everyone on load)
settingsRoutes.get('/webgui-theme', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const row = await prisma.appSetting.findUnique({ where: { key: 'webgui_accent_preset' } });
    const preset = (row?.value && (VALID_ACCENT_PRESETS as readonly string[]).includes(row.value)) ? row.value : 'violet';
    res.json({ preset });
  } catch (err) { next(err); }
});

// PUT /api/settings/webgui-theme — admin sets the installation-wide default (individual users
// can still locally override it for themselves; that override never touches this setting)
settingsRoutes.put('/webgui-theme', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { preset } = req.body;
    if (!VALID_ACCENT_PRESETS.includes(preset)) {
      throw new AppError(400, `Unknown accent preset: ${preset}`);
    }
    const prisma = req.app.locals.prisma;
    await prisma.appSetting.upsert({
      where: { key: 'webgui_accent_preset' },
      create: { key: 'webgui_accent_preset', value: preset },
      update: { value: preset },
    });
    console.log(`[Settings] WebGui accent preset set to '${preset}'`);
    res.json({ preset: preset as AccentPreset });
  } catch (err) { next(err); }
});

// Dark and light themes share one list - a base theme carries its own light/dark nature,
// there is no separate light/dark setting to keep in sync with it.
const VALID_BASE_THEMES = [
  'command-deck', 'oled', 'graphite', 'carbon', 'frost', 'deep-forest',
  'daylight', 'paper', 'frost-light',
] as const;
type BaseTheme = (typeof VALID_BASE_THEMES)[number];

// GET /api/settings/webgui-base-theme — the installation-wide default base theme (background/
// surface palette), independent of the accent preset above - any logged-in user needs to read
// this so it can be applied for everyone on load.
settingsRoutes.get('/webgui-base-theme', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const row = await prisma.appSetting.findUnique({ where: { key: 'webgui_base_theme' } });
    const theme = (row?.value && (VALID_BASE_THEMES as readonly string[]).includes(row.value)) ? row.value : 'command-deck';
    res.json({ theme });
  } catch (err) { next(err); }
});

// PUT /api/settings/webgui-base-theme — admin sets the installation-wide default (individual
// users can still locally override it for themselves; that override never touches this setting)
settingsRoutes.put('/webgui-base-theme', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { theme } = req.body;
    if (!VALID_BASE_THEMES.includes(theme)) {
      throw new AppError(400, `Unknown base theme: ${theme}`);
    }
    const prisma = req.app.locals.prisma;
    await prisma.appSetting.upsert({
      where: { key: 'webgui_base_theme' },
      create: { key: 'webgui_base_theme', value: theme },
      update: { value: theme },
    });
    console.log(`[Settings] WebGui base theme set to '${theme}'`);
    res.json({ theme: theme as BaseTheme });
  } catch (err) { next(err); }
});

// PUT /api/settings/privacy-notice — admin switches the storage notice (the info bar about what the
// browser keeps) on or off for everyone. Reading it needs no login and lives at GET /api/public-config.
settingsRoutes.put('/privacy-notice', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
    const prisma = req.app.locals.prisma;
    await setPrivacyNoticeEnabled(prisma, enabled);
    console.log(`[Settings] Privacy notice ${enabled ? 'enabled' : 'disabled'}`);
    res.json({ enabled });
  } catch (err) { next(err); }
});

// GET /api/settings/music-cache — whether chat-played (!play/!queue/!stream) songs are kept in the library or cleaned up after an hour
settingsRoutes.get('/music-cache', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    res.json({ keepPlayedSongs: await getKeepPlayedSongs(prisma) });
  } catch (err) { next(err); }
});

// PUT /api/settings/music-cache
settingsRoutes.put('/music-cache', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { keepPlayedSongs } = req.body;
    if (typeof keepPlayedSongs !== 'boolean') throw new AppError(400, 'keepPlayedSongs must be a boolean');
    const prisma = req.app.locals.prisma;
    await setKeepPlayedSongs(prisma, keepPlayedSongs);
    res.json({ keepPlayedSongs });
  } catch (err) { next(err); }
});

// GET /api/settings/stream-defaults - what !stream uses when no preset is named
settingsRoutes.get('/stream-defaults', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    res.json({
      ...(await getStreamDefaults(prisma)),
      builtIn: builtInStreamDefaults(),
      presets: Object.entries(STREAM_PRESETS).map(([name, p]) => ({ name, ...p })),
    });
  } catch (err) { next(err); }
});

// PUT /api/settings/stream-defaults
settingsRoutes.put('/stream-defaults', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { preset, framerate, bitrate, volume } = req.body ?? {};

    if (typeof preset !== 'string' || !(preset in STREAM_PRESETS)) {
      throw new AppError(400, `preset must be one of: ${Object.keys(STREAM_PRESETS).join(', ')}`);
    }
    if (!Number.isInteger(framerate) || framerate < 1 || framerate > 120) {
      throw new AppError(400, 'framerate must be a whole number between 1 and 120');
    }
    // Checked for shape, not for sanity: what a machine can actually push is
    // the admin's business, but a typo reaching ffmpeg as a bitrate argument
    // makes the stream fail to start with nothing useful in the UI.
    if (typeof bitrate !== 'string' || !BITRATE_PATTERN.test(bitrate.trim())) {
      throw new AppError(400, 'bitrate must look like 6000k or 2M');
    }

    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      throw new AppError(400, 'volume must be a whole number between 0 and 100');
    }

    const prisma = req.app.locals.prisma;
    const saved = await setStreamDefaults(prisma, { preset, framerate, bitrate: bitrate.trim(), volume });
    console.log(`[Settings] Stream defaults set to ${saved.preset} @ ${saved.framerate}fps, ${saved.bitrate}, volume ${saved.volume}%`);
    res.json({
      ...saved,
      builtIn: builtInStreamDefaults(),
      presets: Object.entries(STREAM_PRESETS).map(([name, p]) => ({ name, ...p })),
    });
  } catch (err) { next(err); }
});

// What the History tab's "Recording" card needs besides the two values: the
// allowed choices and the defaults, so the frontend never hard-codes them.
const userHistorySettingsResponse = (settings: UserHistorySettings) => ({
  ...settings,
  defaults: USER_HISTORY_DEFAULTS,
  intervalOptions: USER_HISTORY_INTERVAL_OPTIONS,
  retentionBounds: { min: USER_HISTORY_RETENTION_MIN_DAYS, max: USER_HISTORY_RETENTION_MAX_DAYS },
});

// GET /api/settings/user-history - sampling interval and retention of the long-term user-count history
settingsRoutes.get('/user-history', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    res.json(userHistorySettingsResponse(await getUserHistorySettings(prisma)));
  } catch (err) { next(err); }
});

// PUT /api/settings/user-history - takes effect immediately: the sampler
// restarts at the new interval, and a shorter retention prunes right away.
settingsRoutes.put('/user-history', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { intervalSeconds, retentionDays } = req.body ?? {};
    if (!isValidUserHistoryInterval(intervalSeconds)) {
      throw new AppError(400, `intervalSeconds must be one of: ${USER_HISTORY_INTERVAL_OPTIONS.join(', ')}`);
    }
    if (!isValidUserHistoryRetention(retentionDays)) {
      throw new AppError(400, `retentionDays must be a whole number between ${USER_HISTORY_RETENTION_MIN_DAYS} and ${USER_HISTORY_RETENTION_MAX_DAYS}`);
    }

    const prisma = req.app.locals.prisma;
    const saved = await setUserHistorySettings(prisma, { intervalSeconds, retentionDays });
    const sampler: UserHistorySampler = req.app.locals.userHistorySampler;
    await sampler.applySettings();
    console.log(`[Settings] User history set to every ${saved.intervalSeconds}s, kept for ${saved.retentionDays} day(s)`);
    res.json(userHistorySettingsResponse(saved));
  } catch (err) { next(err); }
});

// GET /api/settings/console - how the admin query console keeps its audit trail and protects the query flood limit
settingsRoutes.get('/console', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    res.json(await getConsoleSettings(prisma));
  } catch (err) { next(err); }
});

// PUT /api/settings/console
settingsRoutes.put('/console', requireAdmin, async (req: Request, res: Response, next) => {
  try {
    const { auditRetentionDays, floodGuardEnabled } = req.body ?? {};

    if (!Number.isInteger(auditRetentionDays) || auditRetentionDays < CONSOLE_AUDIT_RETENTION_BOUNDS.min || auditRetentionDays > CONSOLE_AUDIT_RETENTION_BOUNDS.max) {
      throw new AppError(400, `auditRetentionDays must be a whole number between ${CONSOLE_AUDIT_RETENTION_BOUNDS.min} and ${CONSOLE_AUDIT_RETENTION_BOUNDS.max}`);
    }
    if (typeof floodGuardEnabled !== 'boolean') {
      throw new AppError(400, 'floodGuardEnabled must be a boolean');
    }

    const prisma = req.app.locals.prisma;
    const saved = await setConsoleSettings(prisma, { auditRetentionDays, floodGuardEnabled });
    console.log(`[Settings] Query console: audit trail kept ${saved.auditRetentionDays} days, flood guard ${saved.floodGuardEnabled ? 'on' : 'off'}`);
    res.json(saved);
  } catch (err) { next(err); }
});

export { settingsRoutes };
