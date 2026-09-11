import type { ConnectionPool } from './connection-pool.js';

const SAMPLE_INTERVAL_MS = 10_000;
const MAX_SAMPLES = 90; // 90 * 10s = 15 minutes

export interface BandwidthSample {
  timestamp: number;
  incoming: number;
  outgoing: number;
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

  constructor(private connectionPool: ConnectionPool) {}

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
        const result = await client.execute(sid, 'serverrequestconnectioninfo');
        const info = Array.isArray(result) ? result[0] : result;
        const buf = this.buffers.get(key);
        if (!buf) return; // destroy()/config removal raced us
        buf.push({
          timestamp: Date.now(),
          incoming: Number(info.connection_bandwidth_received_last_second_total) || 0,
          outgoing: Number(info.connection_bandwidth_sent_last_second_total) || 0,
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
