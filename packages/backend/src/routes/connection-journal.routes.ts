import { Router, type Request, type Response } from 'express';
import {
  JOURNAL_EVENTS,
  JOURNAL_IP_SORT_COLUMNS,
  JOURNAL_RANGES,
  JOURNAL_RESULTS,
  JOURNAL_SORT_COLUMNS,
  JOURNAL_SOURCES,
  type ConnectionJournalSettingsDto,
  type JournalEvent,
  type JournalIpSortColumn,
  type JournalRange,
  type JournalResult,
  type JournalSortColumn,
  type JournalSource,
} from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import type { TsLoginJournal } from '../ts-client/ts-login-journal.js';
import {
  CONNECTION_JOURNAL_MAX_ROWS_MAX,
  CONNECTION_JOURNAL_MAX_ROWS_MIN,
  CONNECTION_JOURNAL_RETENTION_MAX_DAYS,
  CONNECTION_JOURNAL_RETENTION_MIN_DAYS,
  getConnectionJournalSettings,
  isValidJournalMaxRows,
  isValidJournalRetention,
  setConnectionJournalSettings,
} from '../utils/connection-journal-settings.js';
import {
  clearJournal,
  journalStats,
  listCountries,
  listJournal,
  listJournalByIp,
  pruneJournal,
  type JournalFilters,
} from '../utils/connection-journal.js';
import { geoIpRoutes } from './geoip.routes.js';

/**
 * The connection journal. Mounted behind the admin check (app.ts): the rows
 * carry the addresses people signed in from.
 */
export const connectionJournalRoutes: Router = Router();

// The GeoIP database behind the country column: install, update, switches
connectionJournalRoutes.use('/geoip', geoIpRoutes);

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

function parseFilters(req: Request): JournalFilters {
  return {
    range: oneOf<JournalRange>(req.query.range, JOURNAL_RANGES, 'range') ?? 'all',
    source: oneOf<JournalSource>(req.query.source, JOURNAL_SOURCES, 'source'),
    event: oneOf<JournalEvent>(req.query.event, JOURNAL_EVENTS, 'event'),
    result: oneOf<JournalResult>(req.query.result, JOURNAL_RESULTS, 'result'),
    q: text(req.query.q, 'q'),
    ip: text(req.query.ip, 'ip'),
    online: oneOf(req.query.online, ['1'] as const, 'online') === '1' ? true : undefined,
    serverConfigId: req.query.server === undefined || req.query.server === '' ? undefined : positiveInt(req.query.server, 'server', 1, 1_000_000_000),
    country: countryCode(req.query.country),
  };
}

/** An ISO 3166-1 alpha-2 code, in the capitals the database stores it in. */
function countryCode(raw: unknown): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !/^[A-Za-z]{2}$/.test(raw)) throw new AppError(400, 'country must be a two-letter country code');
  return raw.toUpperCase();
}

async function settingsDto(req: Request): Promise<ConnectionJournalSettingsDto> {
  const prisma = req.app.locals.prisma;
  const [settings, stats] = await Promise.all([getConnectionJournalSettings(prisma), journalStats(prisma)]);
  return {
    ...settings,
    bounds: {
      retentionMin: CONNECTION_JOURNAL_RETENTION_MIN_DAYS,
      retentionMax: CONNECTION_JOURNAL_RETENTION_MAX_DAYS,
      maxRowsMin: CONNECTION_JOURNAL_MAX_ROWS_MIN,
      maxRowsMax: CONNECTION_JOURNAL_MAX_ROWS_MAX,
    },
    ...stats,
  };
}

// GET /api/connection-journal - one page of the journal, filtered and sorted on the server
connectionJournalRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const sort = oneOf<JournalSortColumn>(req.query.sort, JOURNAL_SORT_COLUMNS, 'sort') ?? 'at';
    const order = oneOf(req.query.order, ['asc', 'desc'] as const, 'order') ?? 'desc';
    const page = positiveInt(req.query.page, 'page', 1, 1_000_000);
    const pageSize = positiveInt(req.query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    res.json(await listJournal(req.app.locals.prisma, parseFilters(req), sort, order, page, pageSize));
  } catch (err) { next(err); }
});

// GET /api/connection-journal/by-ip - the same rows, one line per address
connectionJournalRoutes.get('/by-ip', async (req: Request, res: Response, next) => {
  try {
    const sort = oneOf<JournalIpSortColumn>(req.query.sort, JOURNAL_IP_SORT_COLUMNS, 'sort') ?? 'lastAt';
    const order = oneOf(req.query.order, ['asc', 'desc'] as const, 'order') ?? 'desc';
    const page = positiveInt(req.query.page, 'page', 1, 1_000_000);
    const pageSize = positiveInt(req.query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    res.json(await listJournalByIp(req.app.locals.prisma, parseFilters(req), sort, order, page, pageSize));
  } catch (err) { next(err); }
});

// GET /api/connection-journal/countries - the countries in the journal, for the filter
connectionJournalRoutes.get('/countries', async (req: Request, res: Response, next) => {
  try { res.json(await listCountries(req.app.locals.prisma)); } catch (err) { next(err); }
});

// GET /api/connection-journal/ts-status - which TeamSpeak virtual servers are watched, and how
connectionJournalRoutes.get('/ts-status', (req: Request, res: Response) => {
  const journal = req.app.locals.tsLoginJournal as TsLoginJournal | undefined;
  res.json(journal ? journal.status() : []);
});

// GET /api/connection-journal/settings
connectionJournalRoutes.get('/settings', async (req: Request, res: Response, next) => {
  try { res.json(await settingsDto(req)); } catch (err) { next(err); }
});

// PUT /api/connection-journal/settings - applies at once: a shorter retention prunes now
connectionJournalRoutes.put('/settings', async (req: Request, res: Response, next) => {
  try {
    const { enabled, retentionDays, maxRows, recordQueryClients, recordOwnBots } = req.body ?? {};
    if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
    if (typeof recordQueryClients !== 'boolean') throw new AppError(400, 'recordQueryClients must be a boolean');
    if (typeof recordOwnBots !== 'boolean') throw new AppError(400, 'recordOwnBots must be a boolean');
    if (!isValidJournalRetention(retentionDays)) {
      throw new AppError(400, `retentionDays must be a whole number from ${CONNECTION_JOURNAL_RETENTION_MIN_DAYS} to ${CONNECTION_JOURNAL_RETENTION_MAX_DAYS}`);
    }
    if (!isValidJournalMaxRows(maxRows)) {
      throw new AppError(400, `maxRows must be a whole number from ${CONNECTION_JOURNAL_MAX_ROWS_MIN} to ${CONNECTION_JOURNAL_MAX_ROWS_MAX}`);
    }
    const prisma = req.app.locals.prisma;
    await setConnectionJournalSettings(prisma, { enabled, retentionDays, maxRows, recordQueryClients, recordOwnBots });
    console.log(
      `[ConnectionJournal] Settings updated by ${req.user?.username}: enabled=${enabled}, ${retentionDays} days, ${maxRows} rows, ` +
      `query clients ${recordQueryClients ? 'on' : 'off'}, own bots ${recordOwnBots ? 'on' : 'off'}`,
    );
    await pruneJournal(prisma);
    // The TeamSpeak side picks the switches up now, not at its next pass.
    await (req.app.locals.tsLoginJournal as TsLoginJournal | undefined)?.refresh();
    res.json(await settingsDto(req));
  } catch (err) { next(err); }
});

// DELETE /api/connection-journal - empty the journal
connectionJournalRoutes.delete('/', async (req: Request, res: Response, next) => {
  try {
    const deleted = await clearJournal(req.app.locals.prisma);
    console.log(`[ConnectionJournal] Journal cleared by ${req.user?.username} (${deleted} entries)`);
    res.json({ deletedCount: deleted });
  } catch (err) { next(err); }
});
