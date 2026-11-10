import type { PrismaClient, RaidIncident, RaidProtection } from '../generated/prisma/client.js';
import {
  RAID_DEFAULTS,
  RAID_NOTICE_NOTES,
  RAID_RETENTION_DEFAULT_DAYS,
  RAID_RETENTION_MAX_DAYS,
  RAID_RETENTION_MIN_DAYS,
  raidSettingsProblem,
  renderSupportText,
  type ConnectionJournalTsStatus,
  type RaidClient,
  type RaidHit,
  type RaidIncidentEntry,
  type RaidNotice,
  type RaidProtectionConfig,
  type RaidProtectionStatus,
  type RaidSettings,
} from '@ts6/common';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { JournalJoin } from '../ts-client/ts-login-journal.js';
import { protectedGroupIds } from './protected-groups.js';
import { parseSettings as parseQueueSettings } from './support-queue.js';
import {
  describeHits, detect, isExempt, longestWindowMs, mergeIncident, parseGroupList, pauseEnd, type RaidHitNow, type RaidJoin,
} from './raid-detect.js';

// Raid protection (R15), stage 1: watches the joins the connection journal records and keeps an
// incident when they spike. It only observes and tells an admin group - it never acts on a client.

/** Messages to the admin group per incident (TeamSpeak's flood protection). */
const NOTICES_MAX = 10;
const POKE_MAX = 100;
const MESSAGE_MAX = 1024;
/** A polled server reports joins up to 15 s late: an incident stays open this much longer than its window. */
const CLOSE_SLACK_MS = 30_000;
const DAY_MS = 86_400_000;

export function parseRaidSettings(json: string | null | undefined): RaidSettings {
  let parsed: unknown = null;
  try { parsed = json ? JSON.parse(json) : null; } catch { /* broken JSON = defaults */ }
  const merged = { ...RAID_DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) } as RaidSettings;
  return raidSettingsProblem(merged) ? { ...RAID_DEFAULTS } : merged;
}

export function toRaidConfig(row: RaidProtection | null): RaidProtectionConfig {
  return {
    enabled: row?.enabled ?? false,
    firstEnabledAt: row?.firstEnabledAt?.toISOString() ?? null,
    observeUntil: row?.observeUntil?.toISOString() ?? null,
    settings: parseRaidSettings(row?.settings),
  };
}

function json<T>(text: string | null, fallback: T): T {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

export function toIncidentEntry(row: RaidIncident): RaidIncidentEntry {
  return {
    id: row.id,
    serverConfigId: row.serverConfigId,
    sid: row.sid,
    state: row.state as RaidIncidentEntry['state'],
    mode: 'observe',
    startedAt: row.startedAt.toISOString(),
    lastHitAt: row.lastHitAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    hits: json<RaidHit[]>(row.hits, []),
    clients: json<RaidClient[]>(row.clients, []),
    clientCount: row.clientCount,
    notice: json<RaidNotice | null>(row.notice, null),
  };
}

// --- Retention (his decision 13) -------------------------------------------------------------

const KEY_RETENTION = 'raid_incident_retention_days';

export function isValidRaidRetention(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= RAID_RETENTION_MIN_DAYS && value <= RAID_RETENTION_MAX_DAYS;
}

export async function getRaidRetentionDays(prisma: PrismaClient): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY_RETENTION } });
  const value = row ? Number(row.value) : NaN;
  return isValidRaidRetention(value) ? value : RAID_RETENTION_DEFAULT_DAYS;
}

export async function setRaidRetentionDays(prisma: PrismaClient, days: number): Promise<void> {
  await prisma.appSetting.upsert({ where: { key: KEY_RETENTION }, create: { key: KEY_RETENTION, value: String(days) }, update: { value: String(days) } });
}

export async function pruneRaidIncidents(prisma: PrismaClient, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - (await getRaidRetentionDays(prisma)) * DAY_MS);
  const { count } = await prisma.raidIncident.deleteMany({ where: { state: 'closed', endedAt: { lt: cutoff } } });
  if (count > 0) console.log(`[RaidProtection] Pruned ${count} closed incident${count === 1 ? '' : 's'}`);
  return count;
}

// --- The service -----------------------------------------------------------------------------

export interface RaidProtectionDeps {
  prisma: PrismaClient;
  pool: ConnectionPool;
  ownBotUids: () => Set<string>;
  /** The connection journal's view of each watched virtual server. */
  journalStatus: () => ConnectionJournalTsStatus[];
}

interface VsState {
  settings: RaidSettings;
  /** Recent joins, oldest first, at most the longest window back. */
  joins: RaidJoin[];
  /** null until the journal looks at this server (nothing is judged before). */
  watchingSince: number | null;
  serverStartedAt: number | null;
  serverName: string | null;
  open: { id: number; lastHitAt: number; hits: RaidHit[]; clients: RaidClient[]; clientCount: number } | null;
  chain: Promise<unknown>;
}

const keyOf = (configId: number, sid: number) => `${configId}:${sid}`;

export class RaidProtectionService {
  private vs = new Map<string, VsState>();
  /** Watch starts of servers whose protection is off - kept so switching it on later knows them. */
  private watchStarts = new Map<string, number>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private loggedOnce = new Set<string>();

  constructor(private readonly deps: RaidProtectionDeps) {}

  /** Loads every enabled virtual server: its open incident, and its window rebuilt from the journal (a restart loses nothing). */
  async start(): Promise<void> {
    const rows = await this.deps.prisma.raidProtection.findMany({ where: { enabled: true } });
    for (const row of rows) await this.load(row);
    const tickMs = Number(process.env.RAID_TICK_MS) > 0 ? Number(process.env.RAID_TICK_MS) : 15_000;
    const tick = setInterval(() => void this.closeQuiet().catch((err) => console.warn(`[RaidProtection] Pass failed: ${err.message}`)), tickMs);
    const prune = () => void pruneRaidIncidents(this.deps.prisma).catch((err) => console.warn(`[RaidProtection] Pruning failed: ${err.message}`));
    prune();
    const pruneTimer = setInterval(prune, 60 * 60 * 1000);
    tick.unref?.();
    pruneTimer.unref?.();
    this.timers.push(tick, pruneTimer);
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await Promise.allSettled([...this.vs.values()].map((s) => s.chain));
  }

  /** After the settings of one virtual server were saved. */
  async reload(configId: number, sid: number): Promise<void> {
    const key = keyOf(configId, sid);
    const row = await this.deps.prisma.raidProtection.findUnique({ where: { serverConfigId_sid: { serverConfigId: configId, sid } } });
    const old = this.vs.get(key);
    if (old) await old.chain.catch(() => undefined);
    if (!row?.enabled) {
      this.vs.delete(key);
      // Switched off: an open incident ends now.
      await this.deps.prisma.raidIncident.updateMany({ where: { serverConfigId: configId, sid, state: 'open' }, data: { state: 'closed', endedAt: new Date() } });
      return;
    }
    if (old) {
      old.settings = parseRaidSettings(row.settings);
      return;
    }
    await this.load(row);
  }

  private async load(row: RaidProtection): Promise<void> {
    const key = keyOf(row.serverConfigId, row.sid);
    const settings = parseRaidSettings(row.settings);
    const open = await this.deps.prisma.raidIncident.findFirst({ where: { serverConfigId: row.serverConfigId, sid: row.sid, state: 'open' }, orderBy: { id: 'desc' } });
    const st: VsState = {
      settings,
      joins: [],
      watchingSince: this.watchStarts.get(key) ?? null,
      serverStartedAt: null,
      serverName: null,
      open: open
        ? { id: open.id, lastHitAt: open.lastHitAt.getTime(), hits: json<RaidHit[]>(open.hits, []), clients: json<RaidClient[]>(open.clients, []), clientCount: open.clientCount }
        : null,
      chain: Promise.resolve(),
    };
    this.vs.set(key, st);
    const since = new Date(Date.now() - longestWindowMs(settings.rules) - CLOSE_SLACK_MS);
    const rows = await this.deps.prisma.connectionJournalEntry.findMany({
      where: { source: 'ts', serverConfigId: row.serverConfigId, virtualServerId: row.sid, at: { gte: since } },
      orderBy: [{ at: 'asc' }, { id: 'asc' }],
      take: 5000,
    });
    // shortcut: a rebuilt row has no client type, so a recorded query client (journal switch "query clients" on) counts as a voice client after a restart; stored types would fix it.
    for (const r of rows) {
      if (!r.uid || r.clid === null) continue;
      st.joins.push(await this.toJoin(row.serverConfigId, row.sid, settings, {
        rowId: r.id, at: r.at, clid: r.clid, uid: r.uid, cldbid: r.cldbid, nickname: r.username ?? '', type: 0,
        ip: r.ip === 'unknown' ? null : r.ip, country: r.country, servergroups: r.servergroups, clientCreated: r.clientCreated,
      }));
    }
  }

  // --- Called by the connection journal ---------------------------------------------------------

  onWatchStart(configId: number, sid: number): void {
    const key = keyOf(configId, sid);
    const now = Date.now();
    this.watchStarts.set(key, now);
    const st = this.vs.get(key);
    if (!st) return;
    st.watchingSince = now;
    // Ask how long the server has been up before the burst of joins that may follow is judged.
    this.enqueue(st, () => this.refreshServerStart(configId, sid, st));
  }

  onJoin(configId: number, sid: number, join: JournalJoin): void {
    const st = this.vs.get(keyOf(configId, sid));
    if (!st) return;
    this.enqueue(st, () => this.handleJoin(configId, sid, st, join));
  }

  private enqueue(st: VsState, job: () => Promise<unknown>): void {
    st.chain = st.chain.then(job).catch((err) => console.warn(`[RaidProtection] ${err?.message ?? err}`));
  }

  // --- Judging a join ---------------------------------------------------------------------------

  private async exemptGroups(configId: number, sid: number, settings: RaidSettings): Promise<Set<number>> {
    const groups = new Set(settings.exemptGroupIds);
    for (const g of await protectedGroupIds(this.deps.prisma, configId, sid)) groups.add(g);
    const queues = await this.deps.prisma.supportQueue.findMany({ where: { serverConfigId: configId, sid, enabled: true }, select: { settings: true } });
    for (const q of queues) for (const g of parseQueueSettings(q.settings).supporterGroupIds) groups.add(g);
    return groups;
  }

  private async toJoin(configId: number, sid: number, settings: RaidSettings, j: JournalJoin): Promise<RaidJoin> {
    // Earlier sessions of this identity here; more than knownSessions are never needed.
    const earlier = await this.deps.prisma.connectionJournalEntry.findMany({
      where: { source: 'ts', serverConfigId: configId, virtualServerId: sid, uid: j.uid, id: { lt: j.rowId } },
      select: { id: true },
      take: Math.max(1, settings.knownSessions),
    });
    const exempt = isExempt(
      { type: j.type, uid: j.uid, groups: parseGroupList(j.servergroups), earlierSessions: earlier.length },
      { ownBotUids: this.deps.ownBotUids(), exemptGroups: await this.exemptGroups(configId, sid, settings), knownSessions: settings.knownSessions },
    );
    return {
      rowId: j.rowId, at: j.at.getTime(), clid: j.clid, uid: j.uid, cldbid: j.cldbid, nickname: j.nickname, ip: j.ip, country: j.country || null,
      isNew: earlier.length === 0, exempt, createdAt: j.clientCreated?.getTime() ?? null,
    };
  }

  private countFrom(st: VsState): number {
    // Not watching yet: nothing counts.
    if (st.watchingSince === null) return Number.POSITIVE_INFINITY;
    return pauseEnd(st.settings.graceMin, st.serverStartedAt, st.watchingSince)!.until;
  }

  private async handleJoin(configId: number, sid: number, st: VsState, j: JournalJoin): Promise<void> {
    const join = await this.toJoin(configId, sid, st.settings, j);
    if (st.joins.some((x) => x.rowId === join.rowId)) return;
    st.joins.push(join);
    const keepFrom = Math.max(...st.joins.map((x) => x.at)) - longestWindowMs(st.settings.rules) - CLOSE_SLACK_MS;
    st.joins = st.joins.filter((x) => x.at >= keepFrom);

    let hits = detect(st.joins, join, st.settings.rules, this.countFrom(st));
    if (!hits.length) return;

    const openStillRunning = st.open && join.at - st.open.lastHitAt <= longestWindowMs(st.settings.rules) + CLOSE_SLACK_MS;
    if (st.open && openStillRunning) {
      await this.extend(st, hits, join.at);
      return;
    }
    // A new incident: first make sure this is not everybody coming back after a server restart that the
    // journal did not notice (a quick restart between two polls). No answer = no incident (no data, no verdict).
    if (!(await this.refreshServerStart(configId, sid, st))) return;
    hits = detect(st.joins, join, st.settings.rules, this.countFrom(st));
    if (!hits.length) return;
    await this.create(configId, sid, st, hits, join.at);
  }

  /** serverinfo: when the server started and its name. False when it cannot be asked. */
  private async refreshServerStart(configId: number, sid: number, st: VsState): Promise<boolean> {
    try {
      const client = this.deps.pool.getClient(configId);
      const [info] = await client.execute(sid, 'serverinfo');
      const uptime = Number(info?.virtualserver_uptime);
      if (!Number.isFinite(uptime)) throw new Error('serverinfo has no uptime');
      st.serverStartedAt = Date.now() - uptime * 1000;
      st.serverName = info?.virtualserver_name ? String(info.virtualserver_name) : st.serverName;
      this.loggedOnce.delete(`uptime:${configId}:${sid}`);
      return true;
    } catch (err: any) {
      const k = `uptime:${configId}:${sid}`;
      if (!this.loggedOnce.has(k)) {
        this.loggedOnce.add(k);
        console.warn(`[RaidProtection] ${configId}/${sid}: cannot read the server's uptime (${err?.message ?? err}) - no incident without it`);
      }
      return false;
    }
  }

  private async extend(st: VsState, hits: RaidHitNow[], at: number): Promise<void> {
    const open = st.open!;
    const merged = mergeIncident(open, hits, at);
    const lastHitAt = Math.max(open.lastHitAt, at);
    const { count } = await this.deps.prisma.raidIncident.updateMany({
      where: { id: open.id, state: 'open' },
      data: { lastHitAt: new Date(lastHitAt), hits: JSON.stringify(merged.hits), clients: JSON.stringify(merged.clients), clientCount: merged.clientCount },
    });
    st.open = count ? { id: open.id, lastHitAt, ...merged } : null;
  }

  private async create(configId: number, sid: number, st: VsState, hits: RaidHitNow[], at: number): Promise<void> {
    const merged = mergeIncident({ hits: [], clients: [], clientCount: 0 }, hits, at);
    const row = await this.deps.prisma.raidIncident.create({
      data: {
        serverConfigId: configId, sid, state: 'open', mode: 'observe', startedAt: new Date(at), lastHitAt: new Date(at),
        hits: JSON.stringify(merged.hits), clients: JSON.stringify(merged.clients), clientCount: merged.clientCount,
      },
    });
    st.open = { id: row.id, lastHitAt: at, ...merged };
    console.log(`[RaidProtection] Incident #${row.id} on ${configId}/${sid}: ${describeHits(merged.hits)}`);
    if (st.settings.notify !== 'off') {
      const notice = await this.notify(configId, sid, st, merged.hits, merged.clientCount);
      await this.deps.prisma.raidIncident.update({ where: { id: row.id }, data: { notice: JSON.stringify(notice) } });
    }
  }

  /** Pokes or messages the online members of the admin groups (his decision 6), at most NOTICES_MAX. */
  private async notify(configId: number, sid: number, st: VsState, hits: RaidHit[], clientCount: number): Promise<RaidNotice> {
    const mode = st.settings.notify as RaidNotice['mode'];
    const notice: RaidNotice = { at: new Date().toISOString(), mode, sent: 0, failed: 0, note: null };
    let client;
    let targets: number[];
    try {
      client = this.deps.pool.getBotClient(configId);
      const rows = (await client.execute(sid, 'clientlist', { '-groups': '' })) as Array<Record<string, unknown>>;
      const wanted = new Set(st.settings.notifyGroupIds);
      targets = rows
        .filter((r) => String(r.client_type) === '0' && parseGroupList(String(r.client_servergroups ?? '')).some((g) => wanted.has(g)))
        .map((r) => Number(r.clid))
        .slice(0, NOTICES_MAX);
    } catch (err: any) {
      notice.note = `${RAID_NOTICE_NOTES.noClientList}: ${err?.message ?? err}`;
      return notice;
    }
    if (!targets.length) {
      notice.note = RAID_NOTICE_NOTES.nobodyOnline;
      return notice;
    }
    const text = renderSupportText(
      st.settings.notifyText,
      { server: st.serverName ?? `virtual server ${sid}`, rules: describeHits(hits), clients: clientCount },
      mode === 'poke' ? POKE_MAX : MESSAGE_MAX,
    );
    for (const clid of targets) {
      try {
        if (mode === 'poke') await client.execute(sid, 'clientpoke', { clid, msg: text });
        else await client.execute(sid, 'sendtextmessage', { targetmode: 1, target: clid, msg: text });
        notice.sent++;
      } catch (err: any) {
        notice.failed++;
        notice.note = `${err?.code ? `${err.code} ` : ''}${err?.message ?? err}`;
      }
    }
    return notice;
  }

  /** Ends incidents whose rules stopped firing: no hit for the longest window (plus the polling slack). */
  private async closeQuiet(now = Date.now()): Promise<void> {
    for (const st of this.vs.values()) {
      const open = st.open;
      if (!open || now - open.lastHitAt <= longestWindowMs(st.settings.rules) + CLOSE_SLACK_MS) continue;
      this.enqueue(st, async () => {
        if (st.open?.id !== open.id) return;
        await this.deps.prisma.raidIncident.updateMany({ where: { id: open.id, state: 'open' }, data: { state: 'closed', endedAt: new Date(now) } });
        st.open = null;
      });
    }
    // Incidents of servers that are no longer watched (switched off while the backend was down).
    const watched = [...this.vs.keys()];
    const stray = await this.deps.prisma.raidIncident.findMany({ where: { state: 'open' }, select: { id: true, serverConfigId: true, sid: true } });
    const ids = stray.filter((r) => !watched.includes(keyOf(r.serverConfigId, r.sid))).map((r) => r.id);
    if (ids.length) await this.deps.prisma.raidIncident.updateMany({ where: { id: { in: ids } }, data: { state: 'closed', endedAt: new Date(now) } });
  }

  // --- Status -----------------------------------------------------------------------------------

  status(configId: number, sid: number): RaidProtectionStatus {
    const st = this.vs.get(keyOf(configId, sid));
    const journal = this.deps.journalStatus().find((s) => s.configId === configId && s.virtualServerId === sid);
    const detection: RaidProtectionStatus['detection'] = !journal
      ? 'journal-off'
      : journal.problem || !this.deps.pool.hasClient(configId) ? 'unreachable' : journal.mode === 'events' ? 'live' : 'delayed';
    const pause = st && st.watchingSince !== null ? pauseEnd(st.settings.graceMin, st.serverStartedAt, st.watchingSince) : null;
    const paused = pause && pause.until > Date.now() ? pause : null;
    return {
      detection,
      pausedUntil: paused ? new Date(paused.until).toISOString() : null,
      pauseReason: paused?.reason ?? null,
      openIncidentId: st?.open?.id ?? null,
    };
  }
}
