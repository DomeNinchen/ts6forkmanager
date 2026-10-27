import { Router, type Request, type Response } from 'express';
import {
  UI_CHANGE_METHODS,
  UI_CHANGE_RANGES,
  UI_CHANGE_STATUSES,
  type UiChangeLogSettingsDto,
  type UiChangeMethod,
  type UiChangeRange,
  type UiChangeStatus,
} from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import {
  CHANGE_LOG_MAX_ROWS_MAX,
  CHANGE_LOG_MAX_ROWS_MIN,
  CHANGE_LOG_RETENTION_MAX_DAYS,
  CHANGE_LOG_RETENTION_MIN_DAYS,
  getChangeLogSettings,
  isValidChangeLogMaxRows,
  isValidChangeLogRetention,
  setChangeLogSettings,
} from '../utils/change-log-settings.js';
import {
  changeLogStats,
  clearChangeLog,
  listChangeAreas,
  listChangeLog,
  pruneChangeLog,
  type ChangeLogFilters,
} from '../utils/change-log.js';

/** The change log. Mounted behind the admin check (app.ts): the rows show who changed what, and from which address. */
export const changeLogRoutes: Router = Router();

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_QUERY_LENGTH = 100;

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], name: string): T | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    throw new AppError(400, `${name} must be one of: ${allowed.join(', ')}`);
  }
  return raw as T;
}

function positiveInt(raw: unknown, name: string, fallback: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new AppError(400, `${name} must be a whole number from 1 to ${max}`);
  return value;
}

function text(raw: unknown, name: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > MAX_QUERY_LENGTH) throw new AppError(400, `${name} must be text of at most ${MAX_QUERY_LENGTH} characters`);
  return raw;
}

function parseFilters(req: Request): ChangeLogFilters {
  return {
    range: oneOf<UiChangeRange>(req.query.range, UI_CHANGE_RANGES, 'range') ?? 'all',
    area: text(req.query.area, 'area'),
    method: oneOf<UiChangeMethod>(req.query.method, UI_CHANGE_METHODS, 'method'),
    status: oneOf<UiChangeStatus>(req.query.status, UI_CHANGE_STATUSES, 'status'),
    serverConfigId: req.query.server === undefined || req.query.server === '' ? undefined : positiveInt(req.query.server, 'server', 1, 1_000_000_000),
    q: text(req.query.q, 'q'),
  };
}

async function settingsDto(req: Request): Promise<UiChangeLogSettingsDto> {
  const prisma = req.app.locals.prisma;
  const [settings, stats] = await Promise.all([getChangeLogSettings(prisma), changeLogStats(prisma)]);
  return {
    ...settings,
    bounds: {
      retentionMin: CHANGE_LOG_RETENTION_MIN_DAYS,
      retentionMax: CHANGE_LOG_RETENTION_MAX_DAYS,
      maxRowsMin: CHANGE_LOG_MAX_ROWS_MIN,
      maxRowsMax: CHANGE_LOG_MAX_ROWS_MAX,
    },
    ...stats,
  };
}

// GET /api/change-log - one page of the log, filtered on the server, newest first
changeLogRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const page = positiveInt(req.query.page, 'page', 1, 1_000_000);
    const pageSize = positiveInt(req.query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    res.json(await listChangeLog(req.app.locals.prisma, parseFilters(req), page, pageSize));
  } catch (err) { next(err); }
});

// GET /api/change-log/areas - the areas that occur, for the area filter
changeLogRoutes.get('/areas', async (req: Request, res: Response, next) => {
  try { res.json(await listChangeAreas(req.app.locals.prisma)); } catch (err) { next(err); }
});

// GET /api/change-log/settings
changeLogRoutes.get('/settings', async (req: Request, res: Response, next) => {
  try { res.json(await settingsDto(req)); } catch (err) { next(err); }
});

// PUT /api/change-log/settings - applies at once: a shorter retention prunes now
changeLogRoutes.put('/settings', async (req: Request, res: Response, next) => {
  try {
    const { enabled, retentionDays, maxRows, recordIp, writeToTsLog } = req.body ?? {};
    if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
    if (typeof recordIp !== 'boolean') throw new AppError(400, 'recordIp must be a boolean');
    if (typeof writeToTsLog !== 'boolean') throw new AppError(400, 'writeToTsLog must be a boolean');
    if (!isValidChangeLogRetention(retentionDays)) {
      throw new AppError(400, `retentionDays must be a whole number from ${CHANGE_LOG_RETENTION_MIN_DAYS} to ${CHANGE_LOG_RETENTION_MAX_DAYS}`);
    }
    if (!isValidChangeLogMaxRows(maxRows)) {
      throw new AppError(400, `maxRows must be a whole number from ${CHANGE_LOG_MAX_ROWS_MIN} to ${CHANGE_LOG_MAX_ROWS_MAX}`);
    }
    const prisma = req.app.locals.prisma;
    await setChangeLogSettings(prisma, { enabled, retentionDays, maxRows, recordIp, writeToTsLog });
    console.log(`[ChangeLog] Settings updated by ${req.user?.username}: enabled=${enabled}, ${retentionDays} days, ${maxRows} rows, ip ${recordIp ? 'on' : 'off'}, TS log ${writeToTsLog ? 'on' : 'off'}`);
    await pruneChangeLog(prisma);
    res.json(await settingsDto(req));
  } catch (err) { next(err); }
});

// DELETE /api/change-log - empty the log
changeLogRoutes.delete('/', async (req: Request, res: Response, next) => {
  try {
    const deleted = await clearChangeLog(req.app.locals.prisma);
    console.log(`[ChangeLog] Log cleared by ${req.user?.username} (${deleted} entries)`);
    res.json({ deletedCount: deleted });
  } catch (err) { next(err); }
});
