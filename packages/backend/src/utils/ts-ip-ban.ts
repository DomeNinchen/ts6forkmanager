import {
  banRuleValue,
  buildBanIndex,
  findBanMatches,
  toBan,
  type BanIndex,
  type CreateTsBanRequest,
  type TsBanOutcome,
  type TsBanResult,
} from '@ts6/common';
import { ConnectionUnavailableError, TSApiError } from '../middleware/error-handler.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { parseBanDuration, parseBanReason } from './ip-bans.js';

type Row = Record<string, string>;
const rowsOf = (result: unknown): Row[] => (Array.isArray(result) ? (result as Row[]) : []);

/**
 * Bans an address on a TeamSpeak server from the connection journal: one `banadd` per virtual
 * server, with the address as an exact, escaped rule (`^1\.2\.3\.4$` - TeamSpeak reads the value
 * as a regular expression that has to match the whole address). The ban is TeamSpeak's own;
 * it shows up on the Bans page and is lifted there.
 */
export async function banOnTeamSpeak(pool: ConnectionPool, request: CreateTsBanRequest, ip: string): Promise<TsBanResult> {
  const client = pool.tryGetClient(request.configId);
  if (!client) throw new ConnectionUnavailableError(request.configId);
  const duration = parseBanDuration(request.duration);
  const reason = parseBanReason(request.reason);
  const nickname = typeof request.nickname === 'string' ? request.nickname.slice(0, 100) : '';

  let serverIds: number[];
  if (request.virtualServerId === 'all') {
    const list = rowsOf(await client.execute(0, 'serverlist'));
    serverIds = list.map((r) => Number(r.virtualserver_id)).filter((id) => Number.isInteger(id) && id > 0);
  } else {
    serverIds = [request.virtualServerId];
  }

  const rule = banRuleValue('ip', { uid: '', nickname: '', lastIp: ip });
  const outcomes: TsBanOutcome[] = [];
  for (const sid of serverIds) {
    try {
      const created = rowsOf(await client.executePost(sid, 'banadd', {
        ip: rule,
        time: duration,
        banreason: reason ?? undefined,
        lastnickname: nickname || undefined,
      }));
      const banid = Number(created[0]?.banid);
      outcomes.push({ virtualServerId: sid, status: 'created', ...(Number.isFinite(banid) ? { banid } : {}) });
    } catch (err) {
      if (!(err instanceof TSApiError)) throw err;
      outcomes.push({ virtualServerId: sid, status: 'failed', message: err.message });
    }
  }
  return { outcomes };
}

/** What the journal's badge asks about a row: is this client banned on the virtual server it was on? */
export interface TsBanQuery {
  configId: number;
  virtualServerId: number;
  ip: string;
  uid: string;
  nickname: string;
}

const CACHE_MS = 30_000;
const FAILED_CACHE_MS = 15_000;
/** The journal list must not wait long for a server that does not answer. */
const ASK_TIMEOUT_MS = 3_000;

/**
 * The ban lists of the virtual servers the journal's rows come from, read at most once per
 * server in half a minute, so the page's refresh every 15 seconds does not ask TeamSpeak each time.
 * A rule counts for a row the way TeamSpeak applies it (address and nickname are whole-value
 * regular expressions, the unique ID is compared as it is), so a ban set on the Bans page shows up too.
 */
export class TsBanLookup {
  private cache = new Map<string, { at: number; ttl: number; index: BanIndex | null }>();
  private inflight = new Map<string, Promise<BanIndex | null>>();

  constructor(private pool: ConnectionPool) {}

  private key(configId: number, sid: number): string {
    return `${configId}:${sid}`;
  }

  /** After a ban was set or lifted from here, the next look asks again. */
  invalidate(configId?: number): void {
    for (const key of this.cache.keys()) {
      if (configId === undefined || key.startsWith(`${configId}:`)) this.cache.delete(key);
    }
  }

  private async indexFor(configId: number, sid: number): Promise<BanIndex | null> {
    const key = this.key(configId, sid);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < cached.ttl) return cached.index;
    const running = this.inflight.get(key);
    if (running) return running;

    const client = this.pool.tryGetClient(configId);
    if (!client) return null;
    const task = (async () => {
      try {
        const rows = rowsOf(await Promise.race([
          client.execute(sid, 'banlist'),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ASK_TIMEOUT_MS).unref?.()),
        ]));
        const index = buildBanIndex(rows.map(toBan));
        this.cache.set(key, { at: Date.now(), ttl: CACHE_MS, index });
        return index;
      } catch {
        this.cache.set(key, { at: Date.now(), ttl: FAILED_CACHE_MS, index: null });
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, task);
    return task;
  }

  /** For each query: true / false, or null when that server's ban list could not be read. */
  async check(queries: Array<TsBanQuery | null>): Promise<Array<boolean | null>> {
    const wanted = new Map<string, { configId: number; sid: number }>();
    for (const q of queries) if (q) wanted.set(this.key(q.configId, q.virtualServerId), { configId: q.configId, sid: q.virtualServerId });
    const indexes = new Map<string, BanIndex | null>();
    await Promise.all(Array.from(wanted, async ([key, { configId, sid }]) => { indexes.set(key, await this.indexFor(configId, sid)); }));
    return queries.map((q) => {
      if (!q) return null;
      const index = indexes.get(this.key(q.configId, q.virtualServerId));
      if (!index) return null;
      return findBanMatches(index, { uid: q.uid, nickname: q.nickname, lastIp: q.ip }).length > 0;
    });
  }
}
