import { Router, Request, Response } from 'express';
import {
  banRuleValue,
  type ClientDbBanOutcome,
  type ClientDbBanRequest,
  type ClientDbBanResult,
  type ClientDbBanTarget,
  type ClientDbChannelGroupEntry,
  type ClientDbCustomEntry,
  type ClientDbDeleteResult,
  type ClientDbDetailSection,
  type ClientDbDetails,
  type ClientDbListPage,
  type ClientDbProfile,
  type ClientDbSearchResult,
} from '@ts6/common';
import { requireRole } from '../middleware/rbac.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { WebQueryClient } from '../ts-client/webquery-client.js';
import { AppError, TSApiError } from '../middleware/error-handler.js';

// Everything about the profiles a virtual server has ever seen (its client database), mounted at
// .../clients/database. Admin-only as a whole: the rows carry each client's last IP address, which
// the live client list deliberately hides from everyone else.
export const clientDatabaseRoutes: Router = Router({ mergeParams: true });
clientDatabaseRoutes.use(requireRole('admin'));

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};
const getSid = (req: Request) => parseInt(String(req.params.sid));

/** Largest block one listing request may ask for. */
const LIST_BLOCK_MAX = 200;
/** clientdbfind never returns more than this many ids, however many match (verified against TS6 6.0.0-beta13.1). */
const TS_FIND_CAP = 50;
/** How many profiles a custom-info or channel-group search lists (each one costs a clientdbinfo call). */
const SEARCH_LIST_CAP = 100;
/** Most profiles one ban or delete request may name. */
const BULK_MAX = 500;
/** Ten years - longer than any ban that makes sense, short of being a typo for "forever" (which is 0). */
const BAN_SECONDS_MAX = 315_360_000;
const ERR_INVALID_CLIENT_ID = 512;
const ERR_CLIENT_ONLINE = 523;

type Row = Record<string, string>;

/** ServerQuery answers a command with no rows as a bare status object, not an empty array. */
const rows = (result: unknown): Row[] => (Array.isArray(result) ? (result as Row[]) : []);

const toNumber = (value: string | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const isTsError = (err: unknown, code: number): boolean => err instanceof TSApiError && err.code === code;

/** TeamSpeak said no (missing permission, unknown id, ...) as opposed to the connection itself failing (code -1). */
const isTsRefusal = (err: unknown): err is TSApiError => err instanceof TSApiError && err.code > 0;

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AppError(400, `${name} is required`);
  if (text.length > maxLength) throw new AppError(400, `${name} is too long`);
  return text;
}

function positiveInt(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, `${name} must be a positive integer`);
  return n;
}

function idList(value: unknown, name: string): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new AppError(400, `${name} must be a non-empty array`);
  if (value.length > BULK_MAX) throw new AppError(400, `${name} may hold at most ${BULK_MAX} entries`);
  const ids = value.map((v) => Number(v));
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new AppError(400, `${name} must hold positive integers only`);
  return [...new Set(ids)];
}

/** Both clientdblist and clientdbinfo rows; they name the database id differently (cldbid vs client_database_id). */
function toProfile(row: Row): ClientDbProfile {
  return {
    cldbid: toNumber(row.cldbid ?? row.client_database_id),
    uid: row.client_unique_identifier ?? '',
    nickname: row.client_nickname ?? '',
    created: toNumber(row.client_created),
    lastConnected: toNumber(row.client_lastconnected),
    totalConnections: toNumber(row.client_totalconnections),
    lastIp: row.client_lastip ?? '',
    description: row.client_description ?? '',
    loginName: row.client_login_name ?? '',
  };
}

/** The clientdbinfo row of a profile, or null when no such profile exists. */
async function readInfoRow(client: WebQueryClient, sid: number, cldbid: number): Promise<Row | null> {
  try {
    return rows(await client.execute(sid, 'clientdbinfo', { cldbid }))[0] ?? null;
  } catch (err) {
    if (isTsError(err, ERR_INVALID_CLIENT_ID)) return null;
    throw err;
  }
}

/** Full profiles for a list of database ids, newest first; ids that vanished in the meantime are left out. */
async function readProfiles(client: WebQueryClient, sid: number, ids: number[]): Promise<ClientDbProfile[]> {
  const profiles: ClientDbProfile[] = [];
  for (const id of ids) {
    const row = await readInfoRow(client, sid, id);
    if (row) profiles.push(toProfile(row));
  }
  return profiles.sort((a, b) => b.cldbid - a.cldbid);
}

// The pickers on the Server Groups, Channel Groups and Permissions pages read the raw listing.
clientDatabaseRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientdblist', {
      start: req.query.start || 0, duration: req.query.duration || 100,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// One block of the listing, walking backwards from the newest profile: `offset` is how many of the
// newest profiles the caller already has. clientdblist itself counts from the oldest, so the total
// is needed first, and a block is read in as many requests as the server is willing to answer.
clientDatabaseRoutes.get('/list', async (req: Request, res: Response, next) => {
  try {
    const client = getClient(req);
    const sid = getSid(req);
    const limit = boundedInt(req.query.limit, LIST_BLOCK_MAX, 1, LIST_BLOCK_MAX);
    const offset = boundedInt(req.query.offset, 0, 0, 100_000_000);

    const head = rows(await client.execute(sid, 'clientdblist', { start: 0, duration: 1, '-count': '' }));
    if (head.length === 0) {
      res.json({ total: 0, entries: [] } satisfies ClientDbListPage);
      return;
    }
    if (head[0].count === undefined) {
      throw new AppError(502, 'TeamSpeak did not report the number of profiles', 'clientdblist -count returned no count');
    }
    const total = toNumber(head[0].count);
    const wanted = Math.min(limit, total - offset);
    if (wanted <= 0) {
      res.json({ total, entries: [] } satisfies ClientDbListPage);
      return;
    }

    const first = total - offset - wanted;
    const block: Row[] = [];
    while (block.length < wanted) {
      const part = rows(await client.execute(sid, 'clientdblist', { start: first + block.length, duration: wanted - block.length }));
      if (part.length === 0) break;
      block.push(...part);
    }
    const entries = block.map(toProfile).sort((a, b) => b.cldbid - a.cldbid);
    res.json({ total, entries } satisfies ClientDbListPage);
  } catch (err) { next(err); }
});

/** Same "contains" default the search box promises: text without any % wildcard is wrapped in %...%. */
const asContainsPattern = (text: string) => (text.includes('%') ? text : `%${text}%`);

clientDatabaseRoutes.get('/search', async (req: Request, res: Response, next) => {
  try {
    const client = getClient(req);
    const sid = getSid(req);
    const mode = String(req.query.mode ?? '');
    let result: ClientDbSearchResult;

    if (mode === 'name' || mode === 'uid') {
      const pattern = asContainsPattern(requiredText(req.query.query, 'query', 100));
      const hits = rows(await client.execute(sid, 'clientdbfind', { pattern, ...(mode === 'uid' ? { '-uid': '' } : {}) }));
      const ids = [...new Set(hits.map((h) => toNumber(h.cldbid)))];
      result = {
        entries: await readProfiles(client, sid, ids),
        truncated: ids.length >= TS_FIND_CAP,
        matchCount: ids.length,
      };
    } else if (mode === 'dbid') {
      const row = await readInfoRow(client, sid, positiveInt(req.query.query, 'query'));
      result = { entries: row ? [toProfile(row)] : [], truncated: false, matchCount: row ? 1 : 0 };
    } else if (mode === 'custom') {
      // TeamSpeak needs the identifier exactly (a wildcard there finds nothing); only the value takes a pattern.
      const ident = requiredText(req.query.ident, 'ident', 100);
      const value = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 100) : '';
      const hits = rows(await client.execute(sid, 'customsearch', { ident, pattern: value ? asContainsPattern(value) : '%' }));
      const custom: Record<number, ClientDbCustomEntry[]> = {};
      for (const hit of hits) {
        const id = toNumber(hit.cldbid);
        (custom[id] ??= []).push({ ident: hit.ident ?? ident, value: hit.value ?? '' });
      }
      const ids = Object.keys(custom).map(Number).sort((a, b) => b - a);
      const shown = ids.slice(0, SEARCH_LIST_CAP);
      result = {
        entries: await readProfiles(client, sid, shown),
        truncated: ids.length > shown.length,
        matchCount: ids.length,
        custom,
      };
    } else if (mode === 'channelgroup') {
      const params: Record<string, number> = {};
      if (req.query.cid !== undefined && req.query.cid !== '') params.cid = positiveInt(req.query.cid, 'cid');
      if (req.query.cgid !== undefined && req.query.cgid !== '') params.cgid = positiveInt(req.query.cgid, 'cgid');
      // Everybody holds the default channel group wherever nothing else was assigned, so it only
      // means something when asked for by name.
      let defaultCgid = 0;
      if (params.cgid === undefined) {
        defaultCgid = toNumber(rows(await client.execute(sid, 'serverinfo'))[0]?.virtualserver_default_channel_group);
      }
      const hits = rows(await client.execute(sid, 'channelgroupclientlist', params));
      const channelGroups: Record<number, ClientDbChannelGroupEntry[]> = {};
      for (const hit of hits) {
        const cgid = toNumber(hit.cgid);
        if (defaultCgid !== 0 && cgid === defaultCgid) continue;
        (channelGroups[toNumber(hit.cldbid)] ??= []).push({ cid: toNumber(hit.cid), cgid });
      }
      const ids = Object.keys(channelGroups).map(Number).sort((a, b) => b - a);
      const shown = ids.slice(0, SEARCH_LIST_CAP);
      result = {
        entries: await readProfiles(client, sid, shown),
        truncated: ids.length > shown.length,
        matchCount: ids.length,
        channelGroups,
      };
    } else {
      throw new AppError(400, 'mode must be one of name, uid, dbid, custom, channelgroup');
    }

    res.json(result);
  } catch (err) { next(err); }
});

/** Runs one part of the detail view; a refusal by TeamSpeak (usually a missing permission) only blanks that part. */
async function optionalSection<T>(
  unavailable: ClientDbDetailSection[], section: ClientDbDetailSection, fallback: T, load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (!isTsRefusal(err)) throw err;
    unavailable.push(section);
    return fallback;
  }
}

clientDatabaseRoutes.get('/:cldbid/details', async (req: Request, res: Response, next) => {
  try {
    const client = getClient(req);
    const sid = getSid(req);
    const cldbid = positiveInt(req.params.cldbid, 'cldbid');

    const info = await readInfoRow(client, sid, cldbid);
    if (!info) throw new AppError(404, 'Profile not found');

    const unavailable: ClientDbDetailSection[] = [];
    const custom = await optionalSection<ClientDbCustomEntry[]>(unavailable, 'custom', [], async () =>
      rows(await client.execute(sid, 'custominfo', { cldbid })).map((r) => ({ ident: r.ident ?? '', value: r.value ?? '' })));
    const serverGroups = await optionalSection(unavailable, 'serverGroups', [] as ClientDbDetails['serverGroups'], async () =>
      rows(await client.execute(sid, 'servergroupsbyclientid', { cldbid })).map((r) => ({ sgid: toNumber(r.sgid), name: r.name ?? '' })));
    const channelGroups = await optionalSection<ClientDbChannelGroupEntry[]>(unavailable, 'channelGroups', [], async () =>
      rows(await client.execute(sid, 'channelgroupclientlist', { cldbid })).map((r) => ({ cid: toNumber(r.cid), cgid: toNumber(r.cgid) })));
    const online = await optionalSection<ClientDbDetails['online']>(unavailable, 'online', null, async () => {
      const live = rows(await client.execute(sid, 'clientlist')).find((c) => toNumber(c.client_database_id) === cldbid);
      return live ? { clid: toNumber(live.clid), cid: toNumber(live.cid) } : null;
    });

    const details: ClientDbDetails = {
      profile: toProfile(info),
      avatarHash: info.client_flag_avatar ?? '',
      traffic: {
        monthUp: toNumber(info.client_month_bytes_uploaded),
        monthDown: toNumber(info.client_month_bytes_downloaded),
        totalUp: toNumber(info.client_total_bytes_uploaded),
        totalDown: toNumber(info.client_total_bytes_downloaded),
      },
      custom,
      serverGroups,
      channelGroups,
      online,
      unavailable,
    };
    res.json(details);
  } catch (err) { next(err); }
});

const BAN_TARGETS: ClientDbBanTarget[] = ['uid', 'name', 'ip'];

// One ban rule per profile and target. The values come from the server's own record of the profile,
// never from the browser, and names/IPs are turned into exact escaped patterns (see banRuleValue).
clientDatabaseRoutes.post('/ban', async (req: Request, res: Response, next) => {
  try {
    const client = getClient(req);
    const sid = getSid(req);
    const body = (req.body ?? {}) as Partial<ClientDbBanRequest>;
    const cldbids = idList(body.cldbids, 'cldbids');
    if (!Array.isArray(body.targets) || body.targets.length === 0 || body.targets.some((t) => !BAN_TARGETS.includes(t))) {
      throw new AppError(400, 'targets must be a non-empty list of uid, name, ip');
    }
    const targets = BAN_TARGETS.filter((t) => body.targets!.includes(t));
    const time = Number(body.time ?? 0);
    if (!Number.isInteger(time) || time < 0 || time > BAN_SECONDS_MAX) throw new AppError(400, 'time must be 0 (permanent) or a number of seconds');
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';

    const outcomes: ClientDbBanOutcome[] = [];
    for (const cldbid of cldbids) {
      const row = await readInfoRow(client, sid, cldbid);
      if (!row) {
        for (const target of targets) outcomes.push({ cldbid, nickname: '', target, status: 'failed', message: 'Profile not found' });
        continue;
      }
      const profile = toProfile(row);
      for (const target of targets) {
        const value = banRuleValue(target, profile);
        if (!value) {
          outcomes.push({ cldbid, nickname: profile.nickname, target, status: 'skipped', message: 'no-value' });
          continue;
        }
        try {
          const created = rows(await client.executePost(sid, 'banadd', {
            [target]: value, time, banreason: reason || undefined, lastnickname: profile.nickname || undefined,
          }));
          outcomes.push({ cldbid, nickname: profile.nickname, target, status: 'created', banid: toNumber(created[0]?.banid) });
        } catch (err) {
          if (!isTsRefusal(err)) throw err;
          outcomes.push({ cldbid, nickname: profile.nickname, target, status: 'failed', message: err.message });
        }
      }
    }
    res.json({ outcomes } satisfies ClientDbBanResult);
  } catch (err) { next(err); }
});

// TeamSpeak removes the profile together with its custom info, avatar, group memberships, channel
// group assignments and client permissions, and refuses (523) while the client is connected.
clientDatabaseRoutes.post('/delete', async (req: Request, res: Response, next) => {
  try {
    const client = getClient(req);
    const sid = getSid(req);
    const cldbids = idList((req.body ?? {}).cldbids, 'cldbids');

    const result: ClientDbDeleteResult = { deleted: [], online: [], failed: [] };
    for (const cldbid of cldbids) {
      try {
        await client.executePost(sid, 'clientdbdelete', { cldbid });
        result.deleted.push(cldbid);
      } catch (err) {
        if (isTsError(err, ERR_CLIENT_ONLINE)) result.online.push(cldbid);
        else if (isTsRefusal(err)) result.failed.push({ cldbid, message: err.message, code: err.code });
        else throw err;
      }
    }
    res.json(result);
  } catch (err) { next(err); }
});

// Registered last on purpose: it would otherwise swallow /list and /search as a database id.
clientDatabaseRoutes.get('/:cldbid', async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientdbinfo', { cldbid: String(req.params.cldbid) });
    res.json(result);
  } catch (err) { next(err); }
});
