import type { Request } from 'express';
import type {
  ConnectionJournalEntryDto,
  ConnectionJournalIpPage,
  ConnectionJournalPage,
  JournalEvent,
  JournalIpSortColumn,
  JournalRange,
  JournalReason,
  JournalResult,
  JournalSortColumn,
  JournalSource,
} from '@ts6/common';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { getConnectionJournalSettings } from './connection-journal-settings.js';
import { toGeo, type GeoIpService } from './geoip.js';
import type { IpBanService } from './ip-bans.js';
import { addressScope, normalizeAddress } from './trust-proxy.js';
import type { TsBanLookup } from './ts-ip-ban.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_USERNAME_LENGTH = 100;
const MAX_USER_AGENT_LENGTH = 300;
/** A client hammering the sign-in gets one "rate-limit" row per address and this long, not one per refused request. */
const RATE_LIMIT_ROW_EVERY_MS = 60_000;

/** The address the backend takes for the visitor of this request (see TRUST_PROXY), in its plain form. */
export function clientIpOf(req: Pick<Request, 'ip' | 'socket'>): string {
  return normalizeAddress(req.ip || req.socket?.remoteAddress || '') || 'unknown';
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Control characters have no business in a name or a user agent; they only
  // make a table cell (or a log line) confusing.
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
  return text === '' ? null : text;
}

export interface WebJournalEvent {
  event: Extract<JournalEvent, 'login' | 'totp' | 'sso' | 'rate-limit'>;
  result: JournalResult;
  reason?: JournalReason;
  /** The account's name; for an attempt with a name no account has, what was typed. */
  username?: unknown;
  userId?: number;
}

/**
 * Writes one row about a sign-in event at the web interface. It never throws
 * and is not waited for: a journal that cannot be written (full disk, locked
 * database) must not turn a sign-in into an error.
 */
export function recordWebEvent(req: Request, entry: WebJournalEvent): void {
  const prisma = req.app.locals.prisma as PrismaClient | undefined;
  if (!prisma) return;
  const ip = clientIpOf(req);
  const userAgent = cleanText(req.headers['user-agent'], MAX_USER_AGENT_LENGTH);
  // Null while no GeoIP database is installed: the row then waits for the backfill.
  const geo = (req.app.locals.geoIp as GeoIpService | undefined)?.lookup(ip) ?? null;
  void (async () => {
    try {
      const settings = await getConnectionJournalSettings(prisma);
      if (!settings.enabled) return;
      await prisma.connectionJournalEntry.create({
        data: {
          source: 'web' satisfies JournalSource,
          event: entry.event,
          result: entry.result,
          reason: entry.reason ?? null,
          username: cleanText(entry.username, MAX_USERNAME_LENGTH),
          userId: entry.userId ?? null,
          ip,
          userAgent,
          ...(geo ? { country: geo.country, region: geo.region, city: geo.city } : {}),
        },
      });
    } catch (err: any) {
      console.warn(`[ConnectionJournal] Could not record a ${entry.event} event: ${err.message}`);
    }
  })();
}

const lastRateLimitRow = new Map<string, number>();

/** The sign-in limit turned a request away. One row per address per minute, whatever the attempts after it. */
export function recordRateLimitHit(req: Request, reason: Extract<JournalReason, 'login-limit' | 'refresh-limit'>): void {
  const ip = clientIpOf(req);
  const now = Date.now();
  const last = lastRateLimitRow.get(ip);
  if (last !== undefined && now - last < RATE_LIMIT_ROW_EVERY_MS) return;
  lastRateLimitRow.set(ip, now);
  if (lastRateLimitRow.size > 10_000) {
    for (const [key, at] of lastRateLimitRow) {
      if (now - at >= RATE_LIMIT_ROW_EVERY_MS) lastRateLimitRow.delete(key);
    }
  }
  recordWebEvent(req, { event: 'rate-limit', result: 'failure', reason });
}

// --- Reading ------------------------------------------------------------------

export interface JournalFilters {
  range: JournalRange;
  source?: JournalSource;
  event?: JournalEvent;
  result?: JournalResult;
  /** Part of an account name, a nickname, a unique id, a connection name or an address. */
  q?: string;
  /** Exactly this address. */
  ip?: string;
  /** Only TeamSpeak sessions that have not ended. */
  online?: boolean;
  /** Only TeamSpeak sessions on this server connection. */
  serverConfigId?: number;
  /** Only addresses in this country (ISO 3166-1 alpha-2). */
  country?: string;
}

const RANGE_MS: Record<Exclude<JournalRange, 'all'>, number> = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };

function buildWhere(filters: JournalFilters): Prisma.ConnectionJournalEntryWhereInput {
  const where: Prisma.ConnectionJournalEntryWhereInput = {};
  // "Online now" is about who is there, however long ago they came: it ignores the period.
  if (filters.range !== 'all' && !filters.online) where.at = { gte: new Date(Date.now() - RANGE_MS[filters.range]) };
  if (filters.source) where.source = filters.source;
  if (filters.event) where.event = filters.event;
  if (filters.result) where.result = filters.result;
  if (filters.ip) where.ip = filters.ip;
  if (filters.online) {
    // Open: not left, and not closed with "end not seen" either (that one has no time but is over).
    where.source = 'ts';
    where.leftAt = null;
    where.leaveReason = null;
  }
  if (filters.serverConfigId !== undefined) where.serverConfigId = filters.serverConfigId;
  if (filters.country) where.country = filters.country;
  if (filters.q) {
    where.OR = [
      { username: { contains: filters.q } },
      { ip: { contains: filters.q } },
      { uid: { contains: filters.q } },
      { serverName: { contains: filters.q } },
      // The name of the place too: "Berlin" finds what came from there (stored in English, as the database has it).
      { city: { contains: filters.q } },
    ];
  }
  return where;
}

/** What the lists ask to mark a row as banned; both are optional, a list without them simply shows no badges. */
export interface BanSources {
  web?: IpBanService;
  ts?: TsBanLookup;
}

function toDto(row: {
  id: number;
  at: Date;
  source: string;
  event: string;
  result: string;
  reason: string | null;
  username: string | null;
  userId: number | null;
  ip: string;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  serverConfigId: number | null;
  virtualServerId: number | null;
  serverName: string | null;
  uid: string | null;
  cldbid: number | null;
  clientVersion: string | null;
  clientPlatform: string | null;
  leftAt: Date | null;
  leaveReason: string | null;
}): ConnectionJournalEntryDto {
  return {
    id: row.id,
    at: row.at.toISOString(),
    source: row.source as JournalSource,
    event: row.event as JournalEvent,
    result: row.result as JournalResult,
    reason: row.reason as JournalReason | null,
    username: row.username,
    userId: row.userId,
    ip: row.ip,
    userAgent: row.userAgent,
    scope: addressScope(row.ip),
    geo: toGeo(row),
    ts:
      row.source === 'ts'
        ? {
            serverConfigId: row.serverConfigId,
            virtualServerId: row.virtualServerId,
            serverName: row.serverName,
            uid: row.uid,
            cldbid: row.cldbid,
            clientVersion: row.clientVersion,
            clientPlatform: row.clientPlatform,
            leftAt: row.leftAt ? row.leftAt.toISOString() : null,
            leaveReason: row.leaveReason,
          }
        : null,
    ban: { web: null, ts: null },
  };
}

/** Marks the rows of one page that are banned: on the web by address, on a TeamSpeak server by what that server's ban list says. */
async function markBans(entries: ConnectionJournalEntryDto[], sources: BanSources): Promise<void> {
  if (sources.web) {
    for (const entry of entries) entry.ban.web = sources.web.webBanOf(entry.ip);
  }
  if (sources.ts) {
    const queries = entries.map((e) =>
      e.ts && e.ts.serverConfigId !== null && e.ts.virtualServerId !== null && e.ip !== 'unknown'
        ? { configId: e.ts.serverConfigId, virtualServerId: e.ts.virtualServerId, ip: e.ip, uid: e.ts.uid ?? '', nickname: e.username ?? '' }
        : null,
    );
    if (queries.some((q) => q !== null)) {
      const states = await sources.ts.check(queries);
      entries.forEach((entry, i) => { entry.ban.ts = states[i]; });
    }
  }
}

export async function listJournal(
  prisma: PrismaClient,
  filters: JournalFilters,
  sort: JournalSortColumn,
  order: 'asc' | 'desc',
  page: number,
  pageSize: number,
  bans: BanSources = {},
): Promise<ConnectionJournalPage> {
  const where = buildWhere(filters);
  const [total, rows] = await Promise.all([
    prisma.connectionJournalEntry.count({ where }),
    prisma.connectionJournalEntry.findMany({
      where,
      // The id breaks ties, so rows with the same value never swap places between pages.
      orderBy: [{ [sort]: order }, { id: order }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const entries = rows.map(toDto);
  await markBans(entries, bans);
  return { entries, total, page, pageSize };
}

export async function listJournalByIp(
  prisma: PrismaClient,
  filters: JournalFilters,
  sort: JournalIpSortColumn,
  order: 'asc' | 'desc',
  page: number,
  pageSize: number,
  bans: BanSources = {},
): Promise<ConnectionJournalIpPage> {
  const where = buildWhere(filters);
  const primary: Prisma.ConnectionJournalEntryOrderByWithAggregationInput =
    sort === 'ip' ? { ip: order }
    : sort === 'total' ? { _count: { id: order } }
    : sort === 'country' ? { _max: { country: order } }
    : { _max: { at: order } };
  const orderBy: Prisma.ConnectionJournalEntryOrderByWithAggregationInput[] = [primary, { ip: 'asc' }];

  type IpGroup = { ip: string; _count: { id: number }; _max: { at: Date | null; country: string | null; city: string | null } };
  const [distinct, groups] = await Promise.all([
    prisma.connectionJournalEntry.groupBy({ by: ['ip'], where }),
    // Prisma's groupBy typing insists that every field in orderBy is also in `by`,
    // which it cannot see through the aggregate orderings (_count, _max) chosen at
    // run time; the arguments are right, so they are handed over untyped.
    prisma.connectionJournalEntry.groupBy({
      by: ['ip'],
      where,
      _count: { id: true },
      _max: { at: true, country: true, city: true },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    } as any) as unknown as Promise<IpGroup[]>,
  ]);

  const ips = groups.map((g) => g.ip);
  const pageWhere = { ...where, ip: { in: ips } };
  const [byResult, byName] = ips.length === 0
    ? [[], []]
    : await Promise.all([
        prisma.connectionJournalEntry.groupBy({ by: ['ip', 'result'], where: pageWhere, _count: { id: true } }),
        prisma.connectionJournalEntry.groupBy({ by: ['ip', 'username'], where: { ...pageWhere, username: { not: null } } }),
      ]);

  const failures = new Map<string, number>();
  const successes = new Map<string, number>();
  for (const g of byResult as Array<{ ip: string; result: string; _count: { id: number } }>) {
    (g.result === 'failure' ? failures : successes).set(g.ip, g._count.id);
  }
  const names = new Map<string, number>();
  for (const g of byName as Array<{ ip: string }>) names.set(g.ip, (names.get(g.ip) ?? 0) + 1);

  return {
    rows: groups.map((g) => ({
      ip: g.ip,
      total: g._count.id,
      failures: failures.get(g.ip) ?? 0,
      successes: successes.get(g.ip) ?? 0,
      lastAt: (g._max.at ?? new Date(0)).toISOString(),
      usernames: names.get(g.ip) ?? 0,
      // One address is one place, so the largest value of its rows is its value ("" = not found counts as none).
      country: g._max.country || null,
      city: g._max.city || null,
      scope: addressScope(g.ip),
      webBan: bans.web ? bans.web.webBanOf(g.ip) : null,
    })),
    total: distinct.length,
    page,
    pageSize,
  };
}

/** The countries that occur in the journal, most entries first - what the country filter offers. */
export async function listCountries(prisma: PrismaClient): Promise<Array<{ country: string; count: number }>> {
  const groups = await prisma.connectionJournalEntry.groupBy({
    by: ['country'],
    where: { country: { not: null } },
    _count: { id: true },
  });
  return groups
    .filter((g: { country: string | null }) => g.country)
    .map((g: { country: string | null; _count: { id: number } }) => ({ country: g.country as string, count: g._count.id }))
    .sort((a: { count: number; country: string }, b: { count: number; country: string }) => b.count - a.count || a.country.localeCompare(b.country));
}

export async function journalStats(prisma: PrismaClient): Promise<{ entryCount: number; oldestAt: string | null }> {
  const [entryCount, oldest] = await Promise.all([
    prisma.connectionJournalEntry.count(),
    prisma.connectionJournalEntry.findFirst({ orderBy: { at: 'asc' }, select: { at: true } }),
  ]);
  return { entryCount, oldestAt: oldest ? oldest.at.toISOString() : null };
}

export async function clearJournal(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.connectionJournalEntry.deleteMany({});
  return count;
}

// --- Retention ----------------------------------------------------------------

/** Deletes what is older than the retention setting, then the oldest rows beyond the row cap. */
export async function pruneJournal(prisma: PrismaClient): Promise<number> {
  const settings = await getConnectionJournalSettings(prisma);
  let removed = 0;

  const cutoff = new Date(Date.now() - settings.retentionDays * DAY_MS);
  removed += (await prisma.connectionJournalEntry.deleteMany({ where: { at: { lt: cutoff } } })).count;

  // Ids only ever grow, so "the newest maxRows rows" is "everything from the maxRows-th highest id up".
  const boundary = await prisma.connectionJournalEntry.findFirst({
    orderBy: { id: 'desc' },
    skip: settings.maxRows - 1,
    select: { id: true },
  });
  if (boundary) {
    removed += (await prisma.connectionJournalEntry.deleteMany({ where: { id: { lt: boundary.id } } })).count;
  }

  if (removed > 0) console.log(`[ConnectionJournal] Pruned ${removed} entr${removed === 1 ? 'y' : 'ies'}`);
  return removed;
}

/** Prunes once now and then every hour, for as long as the process runs. */
export function startJournalPruner(prisma: PrismaClient): void {
  const run = () => pruneJournal(prisma).catch((err) => console.warn(`[ConnectionJournal] Pruning failed: ${err.message}`));
  void run();
  setInterval(run, PRUNE_INTERVAL_MS).unref?.();
}
