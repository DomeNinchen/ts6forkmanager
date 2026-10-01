import type { ConnectionPool } from './connection-pool.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { TSApiError } from '../middleware/error-handler.js';
import {
  getUserHistorySettings,
  USER_HISTORY_DEFAULTS,
  type UserHistorySettings,
} from '../utils/user-history-settings.js';
import {
  DAY_MS,
  USER_HISTORY_RANGES,
  buildUserHistory,
  type UserHistoryRange,
  type UserSampleRow,
  type UserSampleState,
} from '../utils/user-history-series.js';

const CLEANUP_INTERVAL_MS = 60 * 60_000;

/**
 * How far back the database is asked which virtual servers a connection has
 * when it cannot be reached and so cannot say itself. Only used after a
 * backend restart during an outage, before any successful `serverlist` has
 * put the real list in memory.
 */
const KNOWN_SERVERS_LOOKBACK_MS = 3 * DAY_MS;

interface SampledServer {
  virtualServerId: number;
  state: UserSampleState;
  users: number | null;
}

/** WebQueryClient turns every failure that never got an answer from TeamSpeak (refused, timed out, DNS, a proxy's 502) into code -1. */
function isConnectionFailure(err: unknown): boolean {
  return err instanceof TSApiError && err.code === -1;
}

/**
 * Records how many real users are on every virtual server, on every
 * connection that has recording switched on, at the interval set in the
 * admin's settings - continuously from the moment the backend starts, whether
 * or not anybody has the Statistics page open. This is what the History chart
 * plots; see ServerUserSample in the Prisma schema for what a row means.
 *
 * It is deliberately separate from BandwidthSampler. That one measures live
 * figures per virtual server for the dashboard's 20-minute charts (two extra
 * requests and a TCP ping each), this one archives a single number for a month
 * or more - one `serverlist` per connection covers every virtual server on it,
 * and the two have different intervals, retention and switches.
 *
 * The one thing it must never do is write a 0 for a server it could not look
 * at. Each tick therefore writes a row with a state instead: "online" with the
 * count, "stopped" when the instance answered but that virtual server is not
 * running, or "unreachable" when the instance itself did not answer.
 */
export class UserHistorySampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private settings: UserHistorySettings = { ...USER_HISTORY_DEFAULTS };
  private destroyed = false;

  /** Connections whose previous tick has not finished, so a slow one is not asked again on top of itself. */
  private inFlight = new Set<number>();
  /** The virtual servers each connection reported last time it answered - who to write "unreachable" rows for when it doesn't. */
  private knownServers = new Map<number, Set<number>>();
  /** What was last said in the log about each connection, so an outage is logged once instead of every tick. */
  private lastStatus = new Map<number, 'ok' | 'unreachable' | 'rejected'>();

  constructor(private connectionPool: ConnectionPool, private prisma: PrismaClient) {}

  /** Begins continuous sampling. Called once, at backend startup. */
  async start(): Promise<void> {
    await this.loadSettings();
    if (this.destroyed) return;
    this.schedule();
    this.cleanupTimer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
    void this.cleanup();
    void this.tick();
  }

  /**
   * Picks up changed interval / retention settings: restarts the timer at the
   * new interval and prunes right away, so lowering the retention takes effect
   * now instead of at the next hourly pass.
   */
  async applySettings(): Promise<void> {
    await this.loadSettings();
    if (this.destroyed) return;
    this.schedule();
    void this.cleanup();
  }

  currentSettings(): UserHistorySettings {
    return { ...this.settings };
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = await getUserHistorySettings(this.prisma);
    } catch (err: any) {
      console.warn(`[UserHistorySampler] Could not read settings, using defaults: ${err.message}`);
      this.settings = { ...USER_HISTORY_DEFAULTS };
    }
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick(), this.settings.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.destroyed) return;

    let configs: Array<{ id: number }>;
    try {
      // Read fresh each tick rather than caching: a connection that was
      // added, disabled, or had its recording switched on or off is picked up
      // by the very next tick, with no reconcile step to keep in sync.
      configs = await this.prisma.tsServerConfig.findMany({
        where: { enabled: true, recordUserHistory: true },
        select: { id: true },
      });
    } catch (err: any) {
      console.warn(`[UserHistorySampler] Could not list server configs: ${err.message}`);
      return;
    }

    // One timestamp for the whole tick, so the rows of one moment line up.
    const at = new Date();
    await Promise.all(configs.map((c) => this.sampleConnection(c.id, at)));
  }

  private async sampleConnection(configId: number, at: Date): Promise<void> {
    if (this.inFlight.has(configId)) return;
    this.inFlight.add(configId);
    try {
      let client;
      try {
        client = this.connectionPool.getClient(configId);
      } catch {
        // No live client for an enabled config (its connection failed to be
        // set up). There is nothing to measure with, which is not the same as
        // the server being down - so no row rather than a wrong one.
        return;
      }

      let servers: SampledServer[];
      try {
        servers = this.parseServerList(await client.execute(0, 'serverlist'));
        this.knownServers.set(configId, new Set(servers.map((s) => s.virtualServerId)));
        this.report(configId, 'ok');
      } catch (err: any) {
        if (!isConnectionFailure(err)) {
          // The instance answered, just not usefully (revoked API key, no
          // permission for serverlist, ...). That is a configuration problem,
          // not an outage, and drawing it as one would be a false alarm.
          this.report(configId, 'rejected', err.message);
          return;
        }
        this.report(configId, 'unreachable', err.message);
        const known = await this.getKnownServers(configId);
        servers = [...known].map((virtualServerId) => ({ virtualServerId, state: 'unreachable', users: null }));
      }

      if (servers.length === 0) return;
      await this.prisma.serverUserSample.createMany({
        data: servers.map((s) => ({
          serverConfigId: configId,
          virtualServerId: s.virtualServerId,
          measuredAt: at,
          state: s.state,
          users: s.users,
          intervalSec: this.settings.intervalSeconds,
        })),
      });
    } catch (err: any) {
      console.warn(`[UserHistorySampler] Sample failed for config ${configId}: ${err.message}`);
    } finally {
      this.inFlight.delete(configId);
    }
  }

  private parseServerList(result: unknown): SampledServer[] {
    const list = Array.isArray(result) ? result : [result];
    const servers: SampledServer[] = [];
    for (const vs of list as any[]) {
      const virtualServerId = Number(vs?.virtualserver_id);
      if (!Number.isInteger(virtualServerId)) continue;

      // Anything but "online" - offline, booting up, shutting down, virtual
      // online (a stopped server a ServerQuery client has selected) - is a
      // virtual server nobody can join right now.
      if (String(vs.virtualserver_status) !== 'online') {
        servers.push({ virtualServerId, state: 'stopped', users: null });
        continue;
      }

      const clients = Number(vs.virtualserver_clientsonline);
      if (!Number.isFinite(clients)) continue;
      // serverlist counts every connection, including ServerQuery ones (this
      // app's own among them), in virtualserver_clientsonline; subtracting
      // virtualserver_queryclientsonline leaves the real users, the same figure
      // the Virtual Servers page shows.
      const queryClients = Number(vs.virtualserver_queryclientsonline);
      servers.push({
        virtualServerId,
        state: 'online',
        users: Math.max(0, clients - (Number.isFinite(queryClients) ? queryClients : 0)),
      });
    }
    return servers;
  }

  private async getKnownServers(configId: number): Promise<Set<number>> {
    const cached = this.knownServers.get(configId);
    if (cached) return cached;
    const groups = await this.prisma.serverUserSample.groupBy({
      by: ['virtualServerId'],
      where: { serverConfigId: configId, measuredAt: { gte: new Date(Date.now() - KNOWN_SERVERS_LOOKBACK_MS) } },
    });
    const known = new Set(groups.map((g) => g.virtualServerId));
    this.knownServers.set(configId, known);
    return known;
  }

  private report(configId: number, status: 'ok' | 'unreachable' | 'rejected', detail = ''): void {
    const previous = this.lastStatus.get(configId);
    this.lastStatus.set(configId, status);
    if (previous === status || (previous === undefined && status === 'ok')) return;
    if (status === 'ok') {
      console.log(`[UserHistorySampler] Server config ${configId} answers again`);
    } else if (status === 'unreachable') {
      console.warn(`[UserHistorySampler] Server config ${configId} is not reachable - recording its virtual servers as down: ${detail}`);
    } else {
      console.warn(`[UserHistorySampler] Server config ${configId} did not accept serverlist - not recorded as an outage: ${detail}`);
    }
  }

  /** Deletes everything older than the retention setting. */
  private async cleanup(): Promise<void> {
    if (this.destroyed) return;
    try {
      const cutoff = new Date(Date.now() - this.settings.retentionDays * DAY_MS);
      const { count } = await this.prisma.serverUserSample.deleteMany({ where: { measuredAt: { lt: cutoff } } });
      if (count > 0) {
        console.log(`[UserHistorySampler] Pruned ${count} sample(s) older than ${this.settings.retentionDays} day(s)`);
      }
    } catch (err: any) {
      console.warn(`[UserHistorySampler] Cleanup failed: ${err.message}`);
    }
  }

  /**
   * Everything the History chart needs for one virtual server, or null when
   * the connection does not exist.
   */
  async getHistory(configId: number, sid: number, range: UserHistoryRange) {
    const config = await this.prisma.tsServerConfig.findUnique({
      where: { id: configId },
      select: { recordUserHistory: true },
    });
    if (!config) return null;

    const now = Date.now();
    // A day more than the window: the lead-in the 24-hour average needs at the left edge.
    const since = new Date(now - USER_HISTORY_RANGES[range].seconds * 1000 - DAY_MS);
    const where = { serverConfigId: configId, virtualServerId: sid };

    const [samples, first] = await Promise.all([
      this.prisma.serverUserSample.findMany({
        where: { ...where, measuredAt: { gte: since } },
        orderBy: { measuredAt: 'asc' },
        select: { measuredAt: true, state: true, users: true, intervalSec: true },
      }),
      this.prisma.serverUserSample.findFirst({
        where,
        orderBy: { measuredAt: 'asc' },
        select: { measuredAt: true },
      }),
    ]);

    const rows: UserSampleRow[] = [];
    for (const s of samples) {
      if (s.state !== 'online' && s.state !== 'stopped' && s.state !== 'unreachable') continue;
      rows.push({ t: s.measuredAt.getTime(), state: s.state, users: s.users, intervalSec: s.intervalSec });
    }

    return {
      range,
      ...buildUserHistory(rows, range, now),
      // What the tab's settings card shows, so it doesn't need a second request.
      intervalSeconds: this.settings.intervalSeconds,
      retentionDays: this.settings.retentionDays,
      recording: config.recordUserHistory,
      firstSampleAt: first ? first.measuredAt.getTime() : null,
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.timer = null;
    this.cleanupTimer = null;
  }
}
