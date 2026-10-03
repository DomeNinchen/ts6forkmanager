import { connect } from 'net';
import type { ConnectionPool } from './connection-pool.js';
import type { MetricSink } from './metric-rollup.js';
import type { PrismaClient } from '../generated/prisma/client.js';

const SAMPLE_INTERVAL_MS = 30_000;
/** How much history the dashboard charts show, and how long rows are kept. */
export const RETENTION_MS = 20 * 60_000;
/**
 * How often the set of virtual servers worth sampling is re-checked. Covers a
 * virtual server that was started (or stopped) after the backend came up, and
 * a server config that was added since - without which either would need a
 * backend restart to be picked up.
 */
const RECONCILE_INTERVAL_MS = 2 * 60_000;
const PING_TIMEOUT_MS = 3_000;

/**
 * Real network reachability of the server's own configured host:port, timed
 * via a plain TCP connect - not TeamSpeak's own virtualserver_total_ping,
 * which is an average over currently connected clients and reads as a
 * meaningless 0 whenever nobody happens to be online. No raw ICMP socket
 * needed (which would require elevated privileges in a container); the
 * WebQuery port is already known-reachable for this exact host, so timing a
 * connect to it doubles as a real go/no-go check too. Resolves to -1 (not
 * reachable / timed out) instead of throwing, so one bad sample never takes
 * the whole sampling loop down.
 */
function tcpPing(host: string, port: number): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = connect({ host, port, timeout: PING_TIMEOUT_MS });
    const finish = (value: number) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(Date.now() - start));
    socket.once('timeout', () => finish(-1));
    socket.once('error', () => finish(-1));
  });
}

/** A running byte total as a number, or null when the server did not report one (older builds) or it is not a plausible total. */
function byteTotal(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const total = Number(value);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

export interface BandwidthSample {
  timestamp: number;
  incoming: number;
  outgoing: number;
  ping: number;
}

/**
 * Samples bandwidth and ping for every running virtual server, continuously,
 * from the moment the backend starts - nobody has to open a dashboard first.
 * That is the whole point of this class: the charts should show a full
 * RETENTION_MS window the instant they are opened, rather than starting empty
 * and only filling in while someone is watching.
 *
 * Samples go straight to the ServerMetricSample table and are read back from
 * it. An in-memory buffer was deliberately dropped in favour of that: it does
 * not survive a restart, and the backend restarts on every deployment, so the
 * charts were short of history exactly after an update. Keeping both a buffer
 * and a table would just be two sources of truth that can disagree, and at
 * roughly 40 rows per virtual server the query costs nothing.
 *
 * Every measurement is also handed to the metric sink, which rolls them up
 * into the long-term bandwidth and ping history. That is a tap on the
 * measurement already being taken, not a second one: the server and the ping
 * target are not contacted any more often because of it.
 */
export class BandwidthSampler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private metricSink: MetricSink | null = null;
  private destroyed = false;

  constructor(private connectionPool: ConnectionPool, private prisma: PrismaClient) {}

  /** Where every measurement is also sent, for the long-term charts. Set once, at backend startup. */
  setMetricSink(sink: MetricSink): void {
    this.metricSink = sink;
  }

  /** Begins continuous sampling. Called once, at backend startup. */
  async start(): Promise<void> {
    await this.reconcile();
    this.reconcileTimer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  /**
   * Brings the set of sampled virtual servers in line with what is actually
   * running: starts sampling anything online that isn't sampled yet, and stops
   * sampling anything that has gone away. Without the stopping half, a virtual
   * server that was shut down would keep failing a WebQuery call every 30s
   * and filling the log with warnings.
   */
  private async reconcile(): Promise<void> {
    if (this.destroyed) return;

    const wanted = new Set<string>();
    let configs;
    try {
      configs = await this.prisma.tsServerConfig.findMany({ select: { id: true } });
    } catch (err: any) {
      console.warn(`[BandwidthSampler] Could not list server configs: ${err.message}`);
      return;
    }

    for (const { id: configId } of configs) {
      try {
        const client = this.connectionPool.getClient(configId);
        const result = await client.execute(0, 'serverlist');
        const list = Array.isArray(result) ? result : [result];
        for (const vs of list) {
          // Only running virtual servers: an offline one answers nothing
          // useful, and sampling it would just log a failure every interval.
          if (String(vs.virtualserver_status) !== 'online') continue;
          const sid = Number(vs.virtualserver_id);
          if (!Number.isFinite(sid)) continue;
          wanted.add(`${configId}:${sid}`);
          this.ensureSampling(configId, sid);
        }
      } catch (err: any) {
        // An unreachable server is normal and temporary - keep whatever
        // sampling it already has rather than tearing it down over one
        // failed serverlist, and let the next reconcile try again.
        for (const key of this.timers.keys()) {
          if (key.startsWith(`${configId}:`)) wanted.add(key);
        }
        console.warn(`[BandwidthSampler] Could not list virtual servers for config ${configId}: ${err.message}`);
      }
    }

    for (const key of [...this.timers.keys()]) {
      if (!wanted.has(key)) this.stopSampling(key);
    }
  }

  /**
   * Starts sampling one virtual server if it isn't already being sampled.
   * Also called from the dashboard route, so a server that reconcile hasn't
   * picked up yet (e.g. it was offline at the last check) starts building
   * history the moment somebody actually looks at it, instead of waiting for
   * the next reconcile.
   */
  ensureSampling(configId: number, sid: number): void {
    if (this.destroyed) return;
    const key = `${configId}:${sid}`;
    if (this.timers.has(key)) return;

    const sample = async () => {
      let client;
      try {
        client = this.connectionPool.getClient(configId);
      } catch {
        // Server config no longer exists - stop instead of erroring forever.
        this.stopSampling(key);
        return;
      }

      try {
        const [connResult, serverConfig] = await Promise.all([
          client.execute(sid, 'serverrequestconnectioninfo'),
          this.prisma.tsServerConfig.findUnique({ where: { id: configId } }),
        ]);
        // The byte totals describe this very moment, so the time is taken
        // before the ping, which can wait for its own timeout.
        const readAt = Date.now();
        const info = Array.isArray(connResult) ? connResult[0] : connResult;
        const ping = serverConfig
          ? await tcpPing(serverConfig.pingHost || serverConfig.host, serverConfig.webqueryPort)
          : -1;
        const incoming = Number(info.connection_bandwidth_received_last_second_total) || 0;
        const outgoing = Number(info.connection_bandwidth_sent_last_second_total) || 0;

        // The long-term history only gets what the connection's switch allows;
        // the dashboard's own 20 minutes below are unaffected by it.
        if (serverConfig?.recordUserHistory) {
          this.metricSink?.recordMetric(configId, sid, {
            at: readAt,
            counterIn: byteTotal(info.connection_bytes_received_total),
            counterOut: byteTotal(info.connection_bytes_sent_total),
            rateIn: incoming,
            rateOut: outgoing,
            ping,
          });
        }

        await this.prisma.serverMetricSample.create({
          data: { serverConfigId: configId, virtualServerId: sid, incoming, outgoing, ping },
        });

        await this.prisma.serverMetricSample.deleteMany({
          where: {
            serverConfigId: configId,
            virtualServerId: sid,
            measuredAt: { lt: new Date(Date.now() - RETENTION_MS) },
          },
        });
      } catch (err: any) {
        // Transient WebQuery or database error - skip this sample, keep going.
        console.warn(`[BandwidthSampler] Sample failed for ${key}: ${err.message}`);
      }
    };

    void sample();
    const timer = setInterval(() => void sample(), SAMPLE_INTERVAL_MS);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  private stopSampling(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearInterval(timer);
    this.timers.delete(key);
  }

  /** The retention window's samples, oldest first - what the charts plot. */
  async getHistory(configId: number, sid: number): Promise<BandwidthSample[]> {
    const rows = await this.prisma.serverMetricSample.findMany({
      where: {
        serverConfigId: configId,
        virtualServerId: sid,
        measuredAt: { gte: new Date(Date.now() - RETENTION_MS) },
      },
      orderBy: { measuredAt: 'asc' },
    });
    return rows.map((r) => ({
      timestamp: r.measuredAt.getTime(),
      incoming: r.incoming,
      outgoing: r.outgoing,
      ping: r.ping,
    }));
  }

  /** The most recent sample, or null when nothing has been measured yet. */
  async getLatest(configId: number, sid: number): Promise<BandwidthSample | null> {
    const row = await this.prisma.serverMetricSample.findFirst({
      where: { serverConfigId: configId, virtualServerId: sid },
      orderBy: { measuredAt: 'desc' },
    });
    if (!row) return null;
    return {
      timestamp: row.measuredAt.getTime(),
      incoming: row.incoming,
      outgoing: row.outgoing,
      ping: row.ping,
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }
}
