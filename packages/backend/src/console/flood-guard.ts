import type { ConnectionPool } from '../ts-client/connection-pool.js';

// TeamSpeak refuses a query client that sends more than N commands within T
// seconds (serverinstance_serverquery_flood_commands / _flood_time) and bans its
// IP address for serverinstance_serverquery_ban_time seconds - and since every
// request this app makes comes from the same address, that bans the whole app,
// not just the console. Hosts on the server's query_ip_allowlist are exempt,
// but the app has no way to tell whether it is on it, so it stays clear of the
// limit instead.

/** What TeamSpeak 6 ships with: not more than 10 commands within 3 seconds. */
const FALLBACK_LIMIT = { commands: 10, seconds: 3 };
const LIMIT_CACHE_MS = 5 * 60_000;
const FALLBACK_CACHE_MS = 30_000;
/**
 * The console only ever spends this share of the limit. The rest stays free for
 * everything else the app sends in the same seconds (dashboard polling, bot
 * flows, another admin's page) - all of it counts against the same limit.
 */
const BUDGET_SHARE = 0.5;
/** Even against a generous limit, a session does not send faster than this. */
export const MIN_SPACING_MS = 150;

interface FloodLimit {
  commands: number;
  seconds: number;
  /** When it was read, and how long that stays good for. */
  fetchedAt: number;
  ttl: number;
}

export type FloodGuardVerdict = { ok: true } | { ok: false; retryAfterMs: number };

export class ConsoleFloodGuard {
  private limits = new Map<number, FloodLimit>();
  /** Per server connection: when each unit the console spent was sent, oldest first. */
  private spent = new Map<number, number[]>();

  /**
   * Asks for `cost` units of budget (one per command actually sent - a command
   * that is also logged to the TeamSpeak server log costs two). Either the units
   * are taken now, or the caller learns how long to wait.
   */
  async acquire(pool: ConnectionPool, configId: number, cost: number): Promise<FloodGuardVerdict> {
    const limit = await this.getLimit(pool, configId);
    const budget = Math.max(1, Math.floor(limit.commands * BUDGET_SHARE));
    // A command that costs more than the whole budget must still be able to run on its own.
    const units = Math.min(cost, budget);
    const windowMs = limit.seconds * 1000;
    const now = Date.now();

    const recent = (this.spent.get(configId) ?? []).filter((sentAt) => now - sentAt < windowMs);
    if (recent.length + units > budget) {
      // Enough of the oldest units have to leave the window before this one fits.
      const mustExpire = recent.length + units - budget;
      const frees = recent[mustExpire - 1] + windowMs;
      this.spent.set(configId, recent);
      return { ok: false, retryAfterMs: Math.max(50, frees - now) };
    }

    for (let i = 0; i < units; i++) recent.push(now);
    this.spent.set(configId, recent);
    return { ok: true };
  }

  /**
   * How far apart the commands of one long-lived query session of the console
   * (the event listener) have to be, to stay within the console's share of the
   * limit. TeamSpeak counts per query client, but the ban for exceeding it is on
   * the address - which is the whole app's - so the listener paces itself like
   * everything else the console sends.
   */
  async minSpacingMs(pool: ConnectionPool, configId: number): Promise<number> {
    const limit = await this.getLimit(pool, configId);
    const budget = Math.max(1, Math.floor(limit.commands * BUDGET_SHARE));
    return Math.max(MIN_SPACING_MS, Math.ceil((limit.seconds * 1000) / budget));
  }

  /** Forget what was read about a server, e.g. after its connection was edited. */
  forget(configId: number): void {
    this.limits.delete(configId);
    this.spent.delete(configId);
  }

  private async getLimit(pool: ConnectionPool, configId: number): Promise<FloodLimit> {
    const cached = this.limits.get(configId);
    if (cached && Date.now() - cached.fetchedAt < cached.ttl) return cached;

    let limit: FloodLimit = { ...FALLBACK_LIMIT, fetchedAt: Date.now(), ttl: FALLBACK_CACHE_MS };
    try {
      const info = await pool.getClient(configId).execute(0, 'instanceinfo');
      const row = Array.isArray(info) ? info[0] : info;
      const commands = Number(row?.serverinstance_serverquery_flood_commands);
      const seconds = Number(row?.serverinstance_serverquery_flood_time);
      if (Number.isFinite(commands) && commands > 0 && Number.isFinite(seconds) && seconds > 0) {
        limit = { commands, seconds, fetchedAt: Date.now(), ttl: LIMIT_CACHE_MS };
      }
    } catch (err: any) {
      // The console can still work off TeamSpeak's default limit; a server that
      // can not even answer instanceinfo will say so on the command itself.
      console.warn(`[Console] Could not read the query flood limit of server ${configId}: ${err.message}`);
    }
    this.limits.set(configId, limit);
    return limit;
  }
}

export const consoleFloodGuard = new ConsoleFloodGuard();
