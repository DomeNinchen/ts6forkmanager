import { connect } from 'net';
import type { ConnectionPool } from './connection-pool.js';
import type { PrismaClient } from '../generated/prisma/client.js';

const SAMPLE_INTERVAL_MS = 10_000;
const MAX_SAMPLES = 90; // 90 * 10s = 15 minutes
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

export interface BandwidthSample {
  timestamp: number;
  incoming: number;
  outgoing: number;
  ping: number;
}

/**
 * Keeps a rolling in-memory bandwidth history per (configId, sid), independent
 * of any specific dashboard request. Sampling for a pair starts the first time
 * ensureSampling() is called for it (i.e. the first time a dashboard is opened)
 * and then keeps running for as long as the backend process is up, so the next
 * time that dashboard is opened there's already history to show instead of an
 * empty chart that only fills in from that point onward.
 */
export class BandwidthSampler {
  private buffers = new Map<string, BandwidthSample[]>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private connectionPool: ConnectionPool, private prisma: PrismaClient) {}

  ensureSampling(configId: number, sid: number): void {
    const key = `${configId}:${sid}`;
    if (this.timers.has(key)) return;
    if (!this.buffers.has(key)) this.buffers.set(key, []);

    const sample = async () => {
      let client;
      try {
        client = this.connectionPool.getClient(configId);
      } catch {
        // Server config no longer exists - stop sampling instead of erroring forever.
        const timer = this.timers.get(key);
        if (timer) clearInterval(timer);
        this.timers.delete(key);
        this.buffers.delete(key);
        return;
      }

      try {
        const [connResult, serverConfig] = await Promise.all([
          client.execute(sid, 'serverrequestconnectioninfo'),
          this.prisma.tsServerConfig.findUnique({ where: { id: configId } }),
        ]);
        const info = Array.isArray(connResult) ? connResult[0] : connResult;
        const ping = serverConfig ? await tcpPing(serverConfig.pingHost || serverConfig.host, serverConfig.webqueryPort) : -1;
        const buf = this.buffers.get(key);
        if (!buf) return; // destroy()/config removal raced us
        buf.push({
          timestamp: Date.now(),
          incoming: Number(info.connection_bandwidth_received_last_second_total) || 0,
          outgoing: Number(info.connection_bandwidth_sent_last_second_total) || 0,
          ping,
        });
        if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
      } catch (err: any) {
        // Transient WebQuery error - skip this sample, keep the timer running.
        console.warn(`[BandwidthSampler] Sample failed for ${key}: ${err.message}`);
      }
    };

    sample();
    this.timers.set(key, setInterval(sample, SAMPLE_INTERVAL_MS));
  }

  getHistory(configId: number, sid: number): BandwidthSample[] {
    return this.buffers.get(`${configId}:${sid}`) ?? [];
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.buffers.clear();
  }
}
