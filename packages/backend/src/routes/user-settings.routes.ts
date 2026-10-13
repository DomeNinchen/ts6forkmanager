/**
 * User settings routes - settings that follow the signed-in account (dashboard layout, ...).
 * Open to every role: each request only ever reads or writes the caller's own rows, the
 * user id comes from the token, never from the request.
 */

import { Router, type Request, type Response } from 'express';
import { AppError } from '../middleware/error-handler.js';
import { isUserSettingKey, parseUserSetting, type UserSettingKey, type UserSettings } from '@ts6/common';

const userSettingsRoutes: Router = Router();

/** The stored text as a valid value, or undefined when it is not one (corrupt, or written by another version). */
function readStored(key: UserSettingKey, text: string) {
  try {
    return parseUserSetting(key, JSON.parse(text)) ?? undefined;
  } catch {
    return undefined;
  }
}

function settingKey(req: Request): UserSettingKey {
  const key = String(req.params.key);
  if (!isUserSettingKey(key)) throw new AppError(404, `Unknown setting "${key}"`);
  return key;
}

// GET /api/user-settings — all of the caller's settings that hold a valid value
userSettingsRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const rows = await prisma.userSetting.findMany({ where: { userId: req.user!.id } });
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      if (!isUserSettingKey(row.key)) continue;
      const value = readStored(row.key, row.value);
      if (value !== undefined) settings[row.key] = value;
    }
    res.json(settings as UserSettings);
  } catch (err) { next(err); }
});

// PUT /api/user-settings/:key — store one setting, body { value }
userSettingsRoutes.put('/:key', async (req: Request, res: Response, next) => {
  try {
    const key = settingKey(req);
    const value = parseUserSetting(key, req.body?.value);
    if (value === null) throw new AppError(400, `Invalid value for "${key}"`);

    const prisma = req.app.locals.prisma;
    const userId = req.user!.id;
    const text = JSON.stringify(value);
    await prisma.userSetting.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value: text },
      update: { value: text },
    });
    res.json({ key, value });
  } catch (err) { next(err); }
});

// DELETE /api/user-settings/:key — back to the default (deleting what is not there is fine)
userSettingsRoutes.delete('/:key', async (req: Request, res: Response, next) => {
  try {
    const key = settingKey(req);
    const prisma = req.app.locals.prisma;
    await prisma.userSetting.deleteMany({ where: { userId: req.user!.id, key } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export { userSettingsRoutes };
