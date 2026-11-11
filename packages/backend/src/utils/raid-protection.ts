import type { PrismaClient, RaidIncident, RaidProtection } from '../generated/prisma/client.js';
import {
  RAID_DEFAULTS,
  type RaidAction,
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
import { recordChange } from './change-log.js';
import { getChangeLogSettings } from './change-log-settings.js';
import { carryOut, parseOnline } from './raid-actions.js';
import { parseSettings as parseQueueSettings } from './support-queue.js';
import {
  actionBudget, describeHits, detect, isExempt, longestWindowMs, mergeIncident, parseGroupList, pauseEnd, type RaidHitNow, type RaidJoin,
} from './raid-detect.js';

// Raid protection (R15): watches the joins the connection journal records and keeps an incident when they
// spike; tells an admin group, and while an admin switched it to acting carries out each rule's action (stage 3).

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
    acting: row?.acting ?? false,
    actingSince: row?.actingSince?.toISOString() ?? null,
    stoppedAt: row?.stoppedAt?.toISOString() ?? null,
    stoppedBy: row?.stoppedBy ?? null,
    settings: parseRaidSettings(row?.settings),
  };
}

/** RAID_ACTIONS_DISABLED=true: the global switch - nothing is ever done to a client (like IP_BANS_DISABLED). */
export const actionsDisabled = () => process.env.RAID_ACTIONS_DISABLED === 'true';

function json<T>(text: string | null, fallback: T): T {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

export function toIncidentEntry(row: RaidIncident): RaidIncidentEntry {
  return {
    id: row.id,
    serverConfigId: row.serverConfigId,
    sid: row.sid,
    state: row.state as RaidIncidentEntry['state'],
    mode: row.mode === 'act' ? 'act' : 'observe',
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
  /** Switched to acting by an admin (the row); see isActing for the global switch. */
  acting: boolean;
  /** When the last actions started, for the per-minute limit. */
  actionTimes: number[];
  actionError: RaidProtectionStatus['actionError'];
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
      if (old.acting && !row.acting) await this.stopPending(old);
      old.acting = row.acting;
      return;
    }
    await this.load(row);
  }

  /** Emergency stop or back to observing: whatever still waits is not done. Runs in the server's queue, after a running action. */
  async stopActions(configId: number, sid: number): Promise<void> {
    const st = this.vs.get(keyOf(configId, sid));
    if (!st) return;
    st.acting = false;
    await new Promise<void>((resolve) => this.enqueue(st, () => this.stopPending(st).finally(resolve)));
  }

  private async stopPending(st: VsState): Promise<void> {
    const open = st.open;
    if (!open?.clients.some((c) => c.outcome?.state === 'pending')) return;
    const at = new Date().toISOString();
    for (const c of open.clients) if (c.outcome?.state === 'pending') c.outcome = { state: 'stopped', at, note: null };
    await this.saveClients(st);
  }

  private isActing(st: VsState): boolean {
    return st.acting && !actionsDisabled();
  }

  private async saveClients(st: VsState): Promise<void> {
    if (st.open) await this.deps.prisma.raidIncident.update({ where: { id: st.open.id }, data: { clients: JSON.stringify(st.open.clients) } });
  }

  private async load(row: RaidProtection): Promise<void> {
    const key = keyOf(row.serverConfigId, row.sid);
    const settings = parseRaidSettings(row.settings);
    const open = await this.deps.prisma.raidIncident.findFirst({ where: { serverConfigId: row.serverConfigId, sid: row.sid, state: 'open' }, orderBy: { id: 'desc' } });
    const openClients = json<RaidClient[]>(open?.clients ?? null, []);
    // An action that was running when the backend stopped may or may not have happened: never repeated.
    const interrupted = openClients.filter((c) => c.outcome?.state === 'running');
    for (const c of interrupted) c.outcome = { state: 'failed', at: new Date().toISOString(), note: 'interrupted by a restart, not repeated' };
    if (open && interrupted.length) await this.deps.prisma.raidIncident.update({ where: { id: open.id }, data: { clients: JSON.stringify(openClients) } });
    const st: VsState = {
      acting: row.acting,
      actionTimes: [],
      actionError: null,
      settings,
      joins: [],
      watchingSince: this.watchStarts.get(key) ?? null,
      serverStartedAt: null,
      serverName: null,
      open: open
        ? { id: open.id, lastHitAt: open.lastHitAt.getTime(), hits: json<RaidHit[]>(open.hits, []), clients: openClients, clientCount: open.clientCount }
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
    const merged = mergeIncident(open, hits, at, this.ladder(st));
    const lastHitAt = Math.max(open.lastHitAt, at);
    const { count } = await this.deps.prisma.raidIncident.updateMany({
      where: { id: open.id, state: 'open' },
      data: { lastHitAt: new Date(lastHitAt), hits: JSON.stringify(merged.hits), clients: JSON.stringify(merged.clients), clientCount: merged.clientCount },
    });
    st.open = count ? { id: open.id, lastHitAt, ...merged } : null;
    await this.processActions(open.id, st);
  }

  /** The levels for new clients; they are only queued while acting (an observing incident shows what would happen). */
  private ladder(st: VsState) {
    return { actions: st.settings.actions, acting: this.isActing(st) };
  }

  private async create(configId: number, sid: number, st: VsState, hits: RaidHitNow[], at: number): Promise<void> {
    const merged = mergeIncident({ hits: [], clients: [], clientCount: 0 }, hits, at, this.ladder(st));
    const row = await this.deps.prisma.raidIncident.create({
      data: {
        serverConfigId: configId, sid, state: 'open', mode: this.isActing(st) ? 'act' : 'observe', startedAt: new Date(at), lastHitAt: new Date(at),
        hits: JSON.stringify(merged.hits), clients: JSON.stringify(merged.clients), clientCount: merged.clientCount,
      },
    });
    st.open = { id: row.id, lastHitAt: at, ...merged };
    console.log(`[RaidProtection] Incident #${row.id} on ${configId}/${sid}: ${describeHits(merged.hits)}`);
    if (st.settings.notify !== 'off') {
      const notice = await this.notify(configId, sid, st, merged.hits, merged.clientCount);
      await this.deps.prisma.raidIncident.update({ where: { id: row.id }, data: { notice: JSON.stringify(notice) } });
    }
    await this.processActions(row.id, st);
  }

  // --- Acting (stage 3) ---------------------------------------------------------------------------

  /**
   * Carries out the pending actions of the open incident, at most maxActionsPerMin a minute; the rest waits
   * for the next pass (the tick). Each client is marked running BEFORE the command and its result after it,
   * so a crash in between never leads to a second action. A client list that cannot be read = nothing done.
   */
  private async processActions(incidentId: number, st: VsState): Promise<void> {
    const open = st.open;
    if (!open || open.id !== incidentId || !this.isActing(st)) return;
    const pending = open.clients.filter((c) => c.outcome?.state === 'pending');
    if (!pending.length) return;
    const now = Date.now();
    st.actionTimes = st.actionTimes.filter((t) => now - t < 60_000);
    let budget = actionBudget(st.actionTimes, now, st.settings.maxActionsPerMin);
    if (!budget) return;
    const row = await this.deps.prisma.raidIncident.findUnique({ where: { id: incidentId }, select: { serverConfigId: true, sid: true } });
    if (!row) return;
    const { serverConfigId: configId, sid } = row;
    let client;
    let online;
    try {
      client = this.deps.pool.getBotClient(configId);
      online = parseOnline(await client.execute(sid, 'clientlist', { '-uid': '', '-groups': '' }) as Array<Record<string, unknown>>);
    } catch (err: any) {
      this.logOnce(`act:${configId}:${sid}`, `[RaidProtection] ${configId}/${sid}: cannot read the client list (${err?.message ?? err}) - actions wait`);
      return;
    }
    const ctx = {
      prisma: this.deps.prisma, client, via: (client === this.deps.pool.tryGetClient(configId) ? 'main' : 'bot') as 'main' | 'bot', configId, sid,
      settings: st.settings, serverName: st.serverName ?? `virtual server ${sid}`, exemptGroups: await this.exemptGroups(configId, sid, st.settings), online,
    };
    for (const c of pending) {
      if (budget-- <= 0 || !this.isActing(st)) break;
      const action = c.action as RaidAction;
      const startedAt = Date.now();
      c.outcome = { state: 'running', at: new Date(startedAt).toISOString(), note: null };
      await this.saveClients(st);
      st.actionTimes.push(startedAt);
      const result = await carryOut(ctx, c, action);
      c.outcome = { state: result.state, at: new Date().toISOString(), note: result.note };
      await this.saveClients(st);
      if (result.noPower) st.actionError = { at: c.outcome.at, action, note: result.note ?? '' };
      else if (result.state === 'done') st.actionError = null;
      if (result.state === 'done' || result.state === 'failed') await this.logAction(configId, sid, incidentId, c, action, result, startedAt);
    }
  }

  /** The change-log row of an action nobody clicked: the job's own, like R13's automatic removal. */
  private async logAction(configId: number, sid: number, incidentId: number, c: RaidClient, action: RaidAction, result: { state: string; note: string | null }, startedAt: number): Promise<void> {
    try {
      if (!(await getChangeLogSettings(this.deps.prisma)).enabled) return;
    } catch {
      return;
    }
    recordChange(this.deps.prisma, {
      createdAt: new Date(startedAt), userId: null, username: 'system', role: 'system', ip: null,
      method: 'POST', area: 'raid-protection', routePattern: `/servers/:configId/vs/:sid/raid-protection/incidents/:id (${action})`,
      serverConfigId: configId, virtualServerId: sid, targetId: String(incidentId),
      body: JSON.stringify({ action, client: c.nickname, uid: c.uid }),
      status: result.state === 'done' ? 'ok' : 'error', httpStatus: result.state === 'done' ? 200 : 502, errorMessage: result.state === 'done' ? null : result.note,
      durationMs: Date.now() - startedAt, loggedToTeamSpeak: false, changes: null,
    });
  }

  private logOnce(key: string, message: string): void {
    if (this.loggedOnce.has(key)) return;
    this.loggedOnce.add(key);
    console.warn(message);
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
      if (!open) continue;
      // Actions held back by the per-minute limit go out on the following passes; the incident stays open meanwhile.
      if (this.isActing(st) && open.clients.some((c) => c.outcome?.state === 'pending')) {
        this.enqueue(st, () => this.processActions(open.id, st));
        continue;
      }
      if (now - open.lastHitAt <= longestWindowMs(st.settings.rules) + CLOSE_SLACK_MS) continue;
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
      actionsDisabled: actionsDisabled(),
      actionError: st?.actionError ?? null,
    };
  }
}
