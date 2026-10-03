import type { ConnectionPool } from './connection-pool.js';
import { MetricRollup, type MetricReading, type MetricSink, type RollupRow } from './metric-rollup.js';
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
import { buildMetricHistory, type MetricKind, type RollupSampleRow } from '../utils/metric-history-series.js';

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
  /** The slot limit, when serverlist reports it (only for a running virtual server). */
  maxClients: number | null;
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
 *
 * It also owns the long-term bandwidth and ping history, because that shares
 * this class's interval, retention and per-connection switch. Those figures are
 * not measured here - BandwidthSampler already takes them every 30 seconds for
 * the dashboard and hands each reading to recordMetric, which folds them into
 * one ServerMetricRollup row per interval.
 */
export class UserHistorySampler implements MetricSink {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private settings: UserHistorySettings = { ...USER_HISTORY_DEFAULTS };
  private destroyed = false;

  /** The windows of the bandwidth and ping history that are still being filled. */
  private rollup = new MetricRollup();
  /** Rollup rows that are being written, so shutdown can wait for them. */
  private pendingWrites = new Set<Promise<void>>();

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
   * Picks up changed interval / retention settings: restarts the timer when
   * the interval changed, and prunes right away so lowering the retention
   * takes effect now instead of at the next hourly pass.
   */
  async applySettings(): Promise<void> {
    const previousInterval = this.settings.intervalSeconds;
    await this.loadSettings();
    if (this.destroyed) return;
    // Left alone when only the retention changed: restarting the timer would
    // push the next measurement back by up to a whole interval for no reason.
    if (this.settings.intervalSeconds !== previousInterval) this.schedule();
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
        servers = [...known].map((virtualServerId) => ({ virtualServerId, state: 'unreachable', users: null, maxClients: null }));
      }

      if (servers.length === 0) return;
      await this.prisma.serverUserSample.createMany({
        data: servers.map((s) => ({
          serverConfigId: configId,
          virtualServerId: s.virtualServerId,
          measuredAt: at,
          state: s.state,
          users: s.users,
          maxClients: s.maxClients,
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
        servers.push({ virtualServerId, state: 'stopped', users: null, maxClients: null });
        continue;
      }

      const clients = Number(vs.virtualserver_clientsonline);
      if (!Number.isFinite(clients)) continue;
      // serverlist counts every connection, including ServerQuery ones (this
      // app's own among them), in virtualserver_clientsonline; subtracting
      // virtualserver_queryclientsonline leaves the real users, the same figure
      // the Virtual Servers page shows.
      const queryClients = Number(vs.virtualserver_queryclientsonline);
      // The slot limit comes in the same answer. Stored per row rather than
      // read at chart time, because an admin can change it and the chart
      // should show the limit that applied when each sample was taken.
      const slots = Number(vs.virtualserver_maxclients);
      servers.push({
        virtualServerId,
        state: 'online',
        users: Math.max(0, clients - (Number.isFinite(queryClients) ? queryClients : 0)),
        maxClients: Number.isFinite(slots) && slots > 0 ? slots : null,
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

  /**
   * One bandwidth and ping measurement from BandwidthSampler. Folded into the
   * window it belongs to; the row of the window before is written once this
   * reading shows that window is over.
   */
  recordMetric(configId: number, sid: number, reading: MetricReading): void {
    if (this.destroyed) return;
    const finished = this.rollup.add(`${configId}:${sid}`, reading, this.settings.intervalSeconds);
    if (finished) this.writeRollups([{ configId, sid, row: finished }]);
  }

  /** Writes the windows that are still open - at shutdown, so the last partial one is not lost - and waits for every write in flight. */
  async flush(): Promise<void> {
    this.writeRollups(
      this.rollup.flushAll().map(({ key, row }) => {
        const [configId, sid] = key.split(':').map(Number);
        return { configId, sid, row };
      }),
    );
    await Promise.allSettled([...this.pendingWrites]);
  }

  private writeRollups(entries: Array<{ configId: number; sid: number; row: RollupRow }>): void {
    if (entries.length === 0) return;
    const write: Promise<void> = this.prisma.serverMetricRollup
      .createMany({
        data: entries.map(({ configId, sid, row }) => ({ serverConfigId: configId, virtualServerId: sid, ...row })),
      })
      .then(() => undefined)
      .catch((err: any) => {
        console.warn(`[UserHistorySampler] Could not store ${entries.length} bandwidth/ping sample(s): ${err.message}`);
      })
      .finally(() => {
        this.pendingWrites.delete(write);
      });
    this.pendingWrites.add(write);
  }

  /** Deletes everything older than the retention setting, from both history tables. */
  private async cleanup(): Promise<void> {
    if (this.destroyed) return;
    try {
      const cutoff = new Date(Date.now() - this.settings.retentionDays * DAY_MS);
      const users = await this.prisma.serverUserSample.deleteMany({ where: { measuredAt: { lt: cutoff } } });
      const metrics = await this.prisma.serverMetricRollup.deleteMany({ where: { measuredAt: { lt: cutoff } } });
      if (users.count > 0 || metrics.count > 0) {
        console.log(
          `[UserHistorySampler] Pruned ${users.count} user and ${metrics.count} bandwidth/ping sample(s) older than ${this.settings.retentionDays} day(s)`,
        );
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
        select: { measuredAt: true, state: true, users: true, maxClients: true, intervalSec: true },
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
      rows.push({ t: s.measuredAt.getTime(), state: s.state, users: s.users, maxClients: s.maxClients, intervalSec: s.intervalSec });
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

  /**
   * Everything the History chart needs to draw one virtual server's bandwidth
   * or ping over the requested window, or null when the connection does not
   * exist. The unreachable and stopped marks are read from the user-count rows,
   * which note the state of every virtual server at every tick.
   */
  async getMetricHistory(configId: number, sid: number, metric: MetricKind, range: UserHistoryRange) {
    const config = await this.prisma.tsServerConfig.findUnique({
      where: { id: configId },
      select: { recordUserHistory: true, host: true, pingHost: true, webqueryPort: true },
    });
    if (!config) return null;

    const now = Date.now();
    // A day more than the window: the lead-in the 24-hour average needs at the left edge.
    const since = new Date(now - USER_HISTORY_RANGES[range].seconds * 1000 - DAY_MS);
    const where = { serverConfigId: configId, virtualServerId: sid };

    const [rollups, states, first] = await Promise.all([
      this.prisma.serverMetricRollup.findMany({
        where: { ...where, measuredAt: { gte: since } },
        // The id breaks ties between the two halves of a window that a restart split in two.
        orderBy: [{ measuredAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.serverUserSample.findMany({
        where: { ...where, measuredAt: { gte: since } },
        orderBy: { measuredAt: 'asc' },
        select: { measuredAt: true, state: true, intervalSec: true },
      }),
      this.prisma.serverMetricRollup.findFirst({
        where,
        orderBy: { measuredAt: 'asc' },
        select: { measuredAt: true },
      }),
    ]);

    const rollupRows: RollupSampleRow[] = rollups.map((r) => ({
      t: r.measuredAt.getTime(),
      intervalSec: r.intervalSec,
      bytesIn: r.bytesIn === null ? null : Number(r.bytesIn),
      bytesOut: r.bytesOut === null ? null : Number(r.bytesOut),
      spanSec: r.spanSec,
      peakIn: r.peakIn,
      peakOut: r.peakOut,
      pingOk: r.pingOk,
      pingFailed: r.pingFailed,
      pingAvg: r.pingAvg,
      pingMin: r.pingMin,
      pingMax: r.pingMax,
    }));

    const stateRows: UserSampleRow[] = [];
    for (const s of states) {
      if (s.state !== 'online' && s.state !== 'stopped' && s.state !== 'unreachable') continue;
      stateRows.push({ t: s.measuredAt.getTime(), state: s.state, users: null, maxClients: null, intervalSec: s.intervalSec });
    }

    return {
      range,
      ...buildMetricHistory(metric, rollupRows, stateRows, range, now),
      // What the tab's settings card shows, so it doesn't need a second request.
      intervalSeconds: this.settings.intervalSeconds,
      retentionDays: this.settings.retentionDays,
      recording: config.recordUserHistory,
      firstSampleAt: first ? first.measuredAt.getTime() : null,
      // What the ping actually measures: a TCP connect to this host and port.
      pingTarget: { host: config.pingHost || config.host, port: config.webqueryPort },
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
