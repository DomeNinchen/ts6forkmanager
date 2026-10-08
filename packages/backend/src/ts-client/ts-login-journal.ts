import crypto from 'crypto';
import { JOURNAL_LEAVE_RECORDING_STOPPED, JOURNAL_LEAVE_UNKNOWN, parseQueryResponse } from '@ts6/common';
import type { ConnectionJournalTsStatus } from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { SshQueryClient } from '../bot-engine/ssh-query-client.js';
import { decrypt } from '../utils/crypto.js';
import {
  getConnectionJournalSettings,
  type ConnectionJournalSettings,
} from '../utils/connection-journal-settings.js';
import type { ConnectionPool } from './connection-pool.js';

/** How often a server that is not covered by live events is asked who is on it. */
const POLL_INTERVAL_MS = 15_000;
/** How often the set of connections and virtual servers to watch is read again. */
const RECONCILE_INTERVAL_MS = 30_000;
/** A server with live events is still compared with the real client list now and then, in case an event was lost. */
const SAFETY_SYNC_MS = 5 * 60_000;
/** The list of virtual servers of a connection that has only SSH is read this rarely (each read is a login). */
const SSH_SERVER_LIST_TTL_MS = 5 * 60_000;
/** Pause between two commands to one server, so a burst of joins (a server restart) cannot trip TeamSpeak's flood protection. */
const COMMAND_SPACING_MS = 120;
/** A connection whose SSH login TeamSpeak refused is not tried again for this long, unless its credentials change. */
const SSH_AUTH_RETRY_MS = 15 * 60_000;
/** TeamSpeak lets only a handful of query connections in from one address and the bots use them too; the rest of a big connection is polled. */
const MAX_SSH_SESSIONS_PER_CONFIG = 3;
const MAX_NICKNAME_LENGTH = 100;
/** The nickname of this journal's own SSH sessions; they are never recorded, whatever the switches say. */
const OWN_NICKNAME_PREFIX = 'TS6-Journal-';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One client as TeamSpeak reports it, by whichever command; what a command does not say is null. */
interface ClientRow {
  clid: number;
  uid: string;
  cldbid: number | null;
  nickname: string;
  type: number;
  ip: string | null;
  version: string | null;
  platform: string | null;
  /** Unix seconds, when TeamSpeak said. */
  lastConnected: number | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
function int(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** A row of clientlist, clientinfo or notifycliententerview. `clid` is what the caller knows when the row does not carry it. */
function toClientRow(record: Record<string, unknown>, clid?: number): ClientRow | null {
  const id = int(record.clid) ?? clid ?? null;
  const uid = str(record.client_unique_identifier);
  if (id === null || uid === null) return null;
  return {
    clid: id,
    uid,
    cldbid: int(record.client_database_id),
    nickname: str(record.client_nickname) ?? '',
    type: int(record.client_type) ?? 0,
    ip: str(record.connection_client_ip),
    version: str(record.client_version),
    platform: str(record.client_platform),
    lastConnected: int(record.client_lastconnected),
  };
}

/** The data line of an SSH ServerQuery answer, parsed; the result of a command that answers nothing is []. */
function parseSshRows(answer: string): Record<string, string>[] {
  const line = answer.split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('error id='));
  return line ? parseQueryResponse(line) : [];
}

interface OpenSession {
  rowId: number;
  uid: string;
}

/** What a tracker is built from; when it changes, the tracker is rebuilt. */
interface ConnectionSetup {
  configId: number;
  name: string;
  host: string;
  webqueryPort: number;
  useHttps: boolean;
  hasWebQuery: boolean;
  ssh: { port: number; username: string; password: string } | null;
  /** Changes whenever one of the above does. */
  fingerprint: string;
}

export interface TsLoginJournalDeps {
  prisma: PrismaClient;
  pool: ConnectionPool;
  /** The unique ids of this app's own music bots, current and stored. */
  ownBotUids: () => Set<string>;
}

/**
 * Watches the clients on every virtual server of every connection that has recording
 * switched on, and writes one Connection Journal row per client connection: opened
 * when the client joins, closed when it leaves.
 *
 * Where the joins come from, per virtual server:
 *  - with an SSH login, live events (`notifycliententerview` / `notifyclientleftview`,
 *    which only SSH can deliver - WebQuery answers `servernotifyregister` with 5120): nothing is
 *    missed, however short the visit, and the end of a session carries TeamSpeak's own reason.
 *    The event does not carry the address, so each join is followed by one `clientinfo`.
 *  - without it, or while it is down, a pass over `clientlist -ip` every 15 seconds. A client that
 *    comes and goes between two passes is not seen, and an end has no reason.
 * A refused connection (a banned client, flood protection) leaves no trace on the server, neither
 * event nor log, so it cannot appear here.
 *
 * It never writes a session's end because of a failure to look: a pass that failed changes nothing.
 */
export class TsLoginJournal {
  private trackers = new Map<string, VirtualServerTracker>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconciling: Promise<void> | null = null;
  private again = false;
  private destroyed = false;
  private settings: ConnectionJournalSettings | null = null;
  /** The list of virtual servers of connections that have no WebQuery, so that it is not a login every pass. */
  private sshServerLists = new Map<number, { at: number; sids: number[] }>();
  /** Connections whose SSH login was refused: when to try again, and with which credentials it happened. */
  private sshBlocked = new Map<number, { until: number; fingerprint: string }>();
  private lastStatus = new Map<string, string>();
  /** How many SSH sessions each connection has open for the journal. */
  private sshSessions = new Map<number, number>();
  /** Connections that were asked for and cannot be watched at all (listed in the status as idle). */
  private unwatchable: ConnectionJournalTsStatus[] = [];

  constructor(private readonly deps: TsLoginJournalDeps) {}

  async start(): Promise<void> {
    await this.reconcile();
    if (this.destroyed) return;
    this.reconcileTimer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
    this.pollTimer = setInterval(() => this.pollTick(), POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  /** Looks at the connections and the settings again now - after one was added, edited, deleted, or a switch was turned. */
  async refresh(): Promise<void> {
    await this.reconcile();
  }

  /** What each watched virtual server is covered by, for the Settings tab of the page. */
  status(): ConnectionJournalTsStatus[] {
    return [...this.trackers.values()]
      .map((t) => t.statusRow())
      .concat(this.unwatchable)
      .sort((a, b) => a.configId - b.configId || a.virtualServerId - b.virtualServerId);
  }

  /** Stops watching. Sessions stay open in the database: the next start finds them again and closes the ones that are gone. */
  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.reconcileTimer = null;
    this.pollTimer = null;
    await Promise.allSettled([...this.trackers.values()].map((t) => t.stop(null)));
    this.trackers.clear();
  }

  private pollTick(): void {
    for (const tracker of this.trackers.values()) tracker.tick();
  }

  private reconcile(): Promise<void> {
    // One pass at a time; a request that comes in during one asks for another straight after it.
    if (this.reconciling) {
      this.again = true;
      return this.reconciling;
    }
    this.reconciling = this.doReconcile().finally(() => {
      this.reconciling = null;
      if (this.again && !this.destroyed) {
        this.again = false;
        void this.reconcile();
      }
    });
    return this.reconciling;
  }

  private async doReconcile(): Promise<void> {
    if (this.destroyed) return;
    const { prisma } = this.deps;

    let settings: ConnectionJournalSettings;
    let configs: Array<{
      id: number; name: string; host: string; webqueryPort: number; useHttps: boolean; apiKey: string | null;
      sshPort: number; sshUsername: string | null; sshPassword: string | null;
    }>;
    try {
      settings = await getConnectionJournalSettings(prisma);
      configs = settings.enabled
        ? await prisma.tsServerConfig.findMany({
            where: { enabled: true, recordConnectionJournal: true },
            select: { id: true, name: true, host: true, webqueryPort: true, useHttps: true, apiKey: true, sshPort: true, sshUsername: true, sshPassword: true },
          })
        : [];
    } catch (err) {
      console.warn(`[TsLoginJournal] Could not read the settings or connections: ${describeError(err)}`);
      return;
    }
    this.settings = settings;

    const wanted = new Map<string, { setup: ConnectionSetup; sid: number }>();
    const unwatchable: ConnectionJournalTsStatus[] = [];
    for (const config of configs) {
      const setup = this.setupOf(config);
      if (!setup.hasWebQuery && !setup.ssh) {
        // No API key and no SSH login (a connection that only runs music bots): nothing to ask.
        unwatchable.push({ configId: config.id, connectionName: config.name, virtualServerId: 0, mode: 'idle', problem: 'no-access', openSessions: 0, lastSyncAt: null });
        continue;
      }
      for (const sid of await this.listVirtualServers(setup)) wanted.set(`${config.id}:${sid}`, { setup, sid });
    }
    this.unwatchable = unwatchable;

    // Trackers whose server is not wanted any more, or whose credentials changed.
    for (const [key, tracker] of [...this.trackers]) {
      const want = wanted.get(key);
      if (!want) {
        // Recording was switched off, the connection was disabled or deleted, or the virtual server is gone.
        this.trackers.delete(key);
        await tracker.stop(settings.enabled && tracker.configStillExists(configs) ? JOURNAL_LEAVE_UNKNOWN : JOURNAL_LEAVE_RECORDING_STOPPED);
      } else if (want.setup.fingerprint !== tracker.fingerprint) {
        // Same server, new way in: the clients on it are still there, so nothing is closed.
        this.trackers.delete(key);
        await tracker.stop(null);
      }
    }

    for (const [key, { setup, sid }] of wanted) {
      const existing = this.trackers.get(key);
      if (existing) {
        existing.update(setup);
        continue;
      }
      const tracker = new VirtualServerTracker(this.deps, this, setup, sid, settings);
      this.trackers.set(key, tracker);
      void tracker.start();
    }
    // The switches may have changed what counts: look at everything once more.
    for (const tracker of this.trackers.values()) tracker.applySettings(settings);
  }

  private setupOf(config: {
    id: number; name: string; host: string; webqueryPort: number; useHttps: boolean; apiKey: string | null;
    sshPort: number; sshUsername: string | null; sshPassword: string | null;
  }): ConnectionSetup {
    let ssh: ConnectionSetup['ssh'] = null;
    if (config.sshUsername && config.sshPassword && config.sshPort) {
      try {
        ssh = { port: config.sshPort, username: config.sshUsername, password: decrypt(config.sshPassword) };
      } catch (err) {
        console.warn(`[TsLoginJournal] Connection ${config.id}: the SSH password cannot be decrypted: ${describeError(err)}`);
      }
    }
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify([config.host, config.webqueryPort, config.useHttps, !!config.apiKey, ssh]))
      .digest('hex')
      .slice(0, 16);
    return {
      configId: config.id,
      name: config.name,
      host: config.host,
      webqueryPort: config.webqueryPort,
      useHttps: config.useHttps,
      hasWebQuery: !!config.apiKey && this.deps.pool.tryGetClient(config.id) !== null,
      ssh,
      fingerprint,
    };
  }

  private async listVirtualServers(setup: ConnectionSetup): Promise<number[]> {
    const client = setup.hasWebQuery ? this.deps.pool.tryGetClient(setup.configId) : null;
    if (client) {
      try {
        const rows = await client.execute(0, 'serverlist');
        const list = Array.isArray(rows) ? rows : [rows];
        const sids = list
          .filter((vs: any) => String(vs?.virtualserver_status) === 'online')
          .map((vs: any) => Number(vs.virtualserver_id))
          .filter((n: number) => Number.isInteger(n) && n > 0);
        this.sshServerLists.set(setup.configId, { at: Date.now(), sids });
        return sids;
      } catch (err) {
        // The server is down or refuses: keep watching what was watched, change nothing.
        return this.knownServers(setup.configId);
      }
    }
    if (!setup.ssh) return [];
    const cached = this.sshServerLists.get(setup.configId);
    if (cached && Date.now() - cached.at < SSH_SERVER_LIST_TTL_MS) return cached.sids;
    if (this.isSshBlocked(setup)) return cached?.sids ?? [];
    const sids = await this.listVirtualServersOverSsh(setup).catch((err) => {
      this.noteSshFailure(setup, err);
      return null;
    });
    if (sids === null) return cached?.sids ?? [];
    this.sshServerLists.set(setup.configId, { at: Date.now(), sids });
    return sids;
  }

  private knownServers(configId: number): number[] {
    return [...this.trackers.values()].filter((t) => t.configId === configId).map((t) => t.sid);
  }

  private async listVirtualServersOverSsh(setup: ConnectionSetup): Promise<number[]> {
    const ssh = setup.ssh!;
    const client = new SshQueryClient({ host: setup.host, port: ssh.port, username: ssh.username, password: ssh.password });
    client.on('error', () => undefined);
    try {
      await client.connect();
      const rows = parseSshRows(await client.executeCommand('serverlist'));
      return rows
        .filter((vs) => vs.virtualserver_status === 'online')
        .map((vs) => Number(vs.virtualserver_id))
        .filter((n) => Number.isInteger(n) && n > 0);
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  // --- The SSH logins TeamSpeak refused -------------------------------------------------------

  isSshBlocked(setup: ConnectionSetup): boolean {
    const blocked = this.sshBlocked.get(setup.configId);
    if (!blocked) return false;
    // New credentials are a new chance; the same ones are not tried again for a while, since a
    // refused login counts against the query flood protection of the server.
    if (blocked.fingerprint !== setup.fingerprint || Date.now() >= blocked.until) {
      this.sshBlocked.delete(setup.configId);
      return false;
    }
    return true;
  }

  noteSshFailure(setup: ConnectionSetup, err: unknown): void {
    const message = describeError(err);
    if (/authentication|Auth/i.test(message)) {
      this.sshBlocked.set(setup.configId, { until: Date.now() + SSH_AUTH_RETRY_MS, fingerprint: setup.fingerprint });
    }
    this.logOnce(`ssh:${setup.configId}`, `[TsLoginJournal] Connection "${setup.name}": SSH is not available (${message}) - polling instead`);
  }

  /** Writes a line to the log only when it differs from the last one for that key. */
  logOnce(key: string, line: string): void {
    if (this.lastStatus.get(key) === line) return;
    this.lastStatus.set(key, line);
    console.warn(line);
  }

  /** The thing the key complained about is fine again; the next complaint is written. */
  clearLog(key: string): void {
    this.lastStatus.delete(key);
  }

  /** At most a few SSH sessions per connection: TeamSpeak lets few query connections in from one address. */
  claimSshSlot(configId: number): boolean {
    const used = this.sshSessions.get(configId) ?? 0;
    if (used >= MAX_SSH_SESSIONS_PER_CONFIG) return false;
    this.sshSessions.set(configId, used + 1);
    return true;
  }

  releaseSshSlot(configId: number): void {
    const used = this.sshSessions.get(configId) ?? 0;
    if (used <= 1) this.sshSessions.delete(configId);
    else this.sshSessions.set(configId, used - 1);
  }
}

/** One virtual server of one connection. */
class VirtualServerTracker {
  readonly configId: number;
  readonly sid: number;
  fingerprint: string;
  private setup: ConnectionSetup;
  private settings: ConnectionJournalSettings;
  /** Sessions that are open in the database, by client id. */
  private sessions = new Map<number, OpenSession>();
  private ssh: SshQueryClient | null = null;
  private holdsSshSlot = false;
  private live = false;
  private stopped = false;
  private started = false;
  private chain: Promise<unknown> = Promise.resolve();
  private lastSyncAt = 0;
  private failure: ConnectionJournalTsStatus['problem'] = null;
  private readonly nickname = `${OWN_NICKNAME_PREFIX}${crypto.randomBytes(2).toString('hex')}`;

  constructor(
    private readonly deps: TsLoginJournalDeps,
    private readonly owner: TsLoginJournal,
    setup: ConnectionSetup,
    sid: number,
    settings: ConnectionJournalSettings,
  ) {
    this.configId = setup.configId;
    this.sid = sid;
    this.setup = setup;
    this.fingerprint = setup.fingerprint;
    this.settings = settings;
  }

  configStillExists(configs: Array<{ id: number }>): boolean {
    return configs.some((c) => c.id === this.configId);
  }

  /** The connection's own details (its name, for new rows) - not the switches, which applySettings compares with the old ones. */
  update(setup: ConnectionSetup): void {
    this.setup = setup;
  }

  /** The switches changed: compare with the real client list now, so what just started to count is picked up. */
  applySettings(settings: ConnectionJournalSettings): void {
    const changed =
      settings.recordQueryClients !== this.settings.recordQueryClients || settings.recordOwnBots !== this.settings.recordOwnBots;
    this.settings = settings;
    if (changed && this.started && !this.stopped) this.enqueue(() => this.fullSync());
  }

  statusRow(): ConnectionJournalTsStatus {
    return {
      configId: this.configId,
      connectionName: this.setup.name,
      virtualServerId: this.sid,
      mode: this.live ? 'events' : 'polling',
      problem: this.failure,
      openSessions: this.sessions.size,
      lastSyncAt: this.lastSyncAt ? new Date(this.lastSyncAt).toISOString() : null,
    };
  }

  // --- Life ----------------------------------------------------------------------------------

  async start(): Promise<void> {
    this.started = true;
    this.enqueue(async () => {
      await this.loadOpenSessions();
      // Always one full comparison first: it closes what ended while nobody was looking and opens what is already here.
      await this.fullSync();
    });
    void this.connectSsh();
  }

  /** `leave` closes the sessions that are still open with that reason; null leaves them for the next start to find. */
  async stop(leave: string | null): Promise<void> {
    this.stopped = true;
    this.live = false;
    const ssh = this.ssh;
    this.ssh = null;
    if (ssh) await ssh.destroy().catch(() => undefined);
    this.releaseSshSlot();
    await this.chain.catch(() => undefined);
    if (leave === JOURNAL_LEAVE_RECORDING_STOPPED) {
      await this.closeAll(JOURNAL_LEAVE_RECORDING_STOPPED, new Date());
    } else if (leave === JOURNAL_LEAVE_UNKNOWN) {
      await this.closeAll(JOURNAL_LEAVE_UNKNOWN, null);
    }
  }

  /** Every 15 seconds: ask when events are not doing the job, and compare now and then when they are. */
  tick(): void {
    if (this.stopped || !this.started) return;
    const due = this.live ? Date.now() - this.lastSyncAt >= SAFETY_SYNC_MS : true;
    if (due) this.enqueue(() => this.fullSync());
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T | undefined> {
    const next = this.chain.then(() => (this.stopped ? undefined : job())).catch((err) => {
      console.warn(`[TsLoginJournal] ${this.setup.name} (virtual server ${this.sid}): ${describeError(err)}`);
      return undefined;
    });
    this.chain = next;
    return next as Promise<T | undefined>;
  }

  // --- SSH: live events ---------------------------------------------------------------------------

  private async connectSsh(): Promise<void> {
    const { ssh: creds } = this.setup;
    if (!creds || this.stopped) return;
    if (this.owner.isSshBlocked(this.setup)) return;
    // The virtual servers of a connection beyond the first few are polled.
    if (!this.owner.claimSshSlot(this.configId)) return;
    this.holdsSshSlot = true;

    const client = new SshQueryClient({ host: this.setup.host, port: creds.port, username: creds.username, password: creds.password });
    this.ssh = client;

    client.on('ready', () => {
      // Runs again after every automatic reconnect: the registration is per session.
      this.enqueue(async () => {
        try {
          await client.executeCommand(`use sid=${this.sid}`);
          await client.executeCommand(`clientupdate client_nickname=${this.nickname}`).catch(() => undefined);
          await client.executeCommand('servernotifyregister event=server');
        } catch (err) {
          this.live = false;
          this.owner.logOnce(`reg:${this.configId}:${this.sid}`, `[TsLoginJournal] ${this.setup.name} (virtual server ${this.sid}): cannot register for events (${describeError(err)}) - polling instead`);
          return;
        }
        this.live = true;
        this.owner.clearLog(`reg:${this.configId}:${this.sid}`);
        // Whatever happened while no session was listening is found by comparing with the real list.
        await this.fullSync();
      });
    });
    client.on('event', (name, data) => this.enqueue(() => this.onEvent(name, data)));
    client.on('close', () => {
      this.live = false;
    });
    client.on('error', (err) => {
      this.live = false;
      if (client.hasFatalError) this.owner.noteSshFailure(this.setup, err);
    });

    try {
      await client.connect();
    } catch (err) {
      this.live = false;
      this.owner.noteSshFailure(this.setup, err);
      if (client.hasFatalError || this.stopped) {
        this.ssh = null;
        this.releaseSshSlot();
        await client.destroy().catch(() => undefined);
      }
      // Otherwise the client retries by itself.
    }
  }

  private releaseSshSlot(): void {
    if (!this.holdsSshSlot) return;
    this.holdsSshSlot = false;
    this.owner.releaseSshSlot(this.configId);
  }

  private async onEvent(name: string, data: Record<string, string>): Promise<void> {
    if (name === 'notifycliententerview') {
      const row = toClientRow(data);
      if (!row) return;
      const known = this.sessions.get(row.clid);
      if (known && known.uid === row.uid) return; // an event twice
      if (known) await this.closeSession(row.clid, JOURNAL_LEAVE_UNKNOWN, null);
      if (!this.counts(row)) return;
      // The event has no address; one command per join gives it, with the client's version and platform.
      const info = await this.clientInfo(row.clid).catch(() => null);
      await this.openSession({ ...row, ...this.merge(row, info) }, new Date());
    } else if (name === 'notifyclientleftview') {
      const clid = int(data.clid);
      if (clid === null || !this.sessions.has(clid)) return;
      await this.closeSession(clid, str(data.reasonmsg) ?? JOURNAL_LEAVE_UNKNOWN, new Date());
    }
  }

  /** The details of a client from clientinfo laid over what the event said (the event wins for what it knows). */
  private merge(event: ClientRow, info: ClientRow | null): Partial<ClientRow> {
    if (!info) return {};
    return {
      ip: info.ip ?? event.ip,
      version: info.version ?? event.version,
      platform: info.platform ?? event.platform,
      lastConnected: info.lastConnected ?? event.lastConnected,
    };
  }

  // --- Asking -----------------------------------------------------------------------------------

  /** Runs one ServerQuery command on this virtual server, over the live SSH session if there is one, else WebQuery. */
  private async remote(command: string, params: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
    await sleep(COMMAND_SPACING_MS);
    if (this.live && this.ssh) {
      const args = Object.entries(params).map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(' ');
      return parseSshRows(await this.ssh.executeCommand(args ? `${command} ${args}` : command));
    }
    const client = this.setup.hasWebQuery ? this.deps.pool.tryGetClient(this.configId) : null;
    if (!client) throw new Error('no way to ask this server (no WebQuery and no live SSH session)');
    const result = await client.execute(this.sid, command, params);
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  private async clientInfo(clid: number): Promise<ClientRow | null> {
    const rows = await this.remote('clientinfo', { clid: String(clid) });
    return rows[0] ? toClientRow(rows[0], clid) : null;
  }

  private async clientList(): Promise<ClientRow[]> {
    const rows = await this.remote('clientlist', { '-uid': '', '-ip': '', '-times': '', '-info': '' });
    return rows.map((r) => toClientRow(r)).filter((r): r is ClientRow => r !== null);
  }

  // --- Comparing with the real list ---------------------------------------------------------------

  /** What counts as a client of this journal: not its own session, not a query client or one of this app's bots unless the switches say so. */
  private counts(client: ClientRow): boolean {
    if (client.nickname.startsWith(OWN_NICKNAME_PREFIX)) return false;
    if (client.type === 1) return this.settings.recordQueryClients;
    if (!this.settings.recordOwnBots && this.deps.ownBotUids().has(client.uid)) return false;
    return true;
  }

  private async fullSync(): Promise<void> {
    let list: ClientRow[];
    try {
      list = await this.clientList();
    } catch (err) {
      const noWay = /no way to ask/.test(describeError(err));
      // No API key and no working SSH session: the SSH login is why, if there is one.
      this.failure = noWay ? (this.setup.ssh ? 'ssh-unavailable' : 'no-access') : 'unreachable';
      this.owner.logOnce(`sync:${this.configId}:${this.sid}`, `[TsLoginJournal] ${this.setup.name} (virtual server ${this.sid}): cannot read the client list (${describeError(err)})`);
      return; // a failure to look is not an end: nothing is closed
    }
    this.failure = null;
    this.lastSyncAt = Date.now();
    this.owner.clearLog(`sync:${this.configId}:${this.sid}`);

    const present = new Map<number, ClientRow>();
    for (const client of list) present.set(client.clid, client);

    // Sessions whose client is gone, or whose client id now belongs to somebody else.
    for (const [clid, session] of [...this.sessions]) {
      const now = present.get(clid);
      if (!now || now.uid !== session.uid) await this.closeSession(clid, JOURNAL_LEAVE_UNKNOWN, null);
    }

    // Clients without a session (they were here before, or the journal was not listening when they came).
    let withoutAddress = 0;
    let counted = 0;
    for (const client of list) {
      if (!this.counts(client)) continue;
      counted++;
      if (client.type !== 1 && !client.ip) withoutAddress++;
      if (this.sessions.has(client.clid)) continue;
      const joined = client.lastConnected && client.lastConnected * 1000 <= Date.now() ? new Date(client.lastConnected * 1000) : new Date();
      await this.openSession(client, joined);
    }
    // TeamSpeak leaves the address out when the account asking may not see it (b_client_remoteaddress_view).
    if (counted > 0 && withoutAddress === counted) this.failure = 'no-address-permission';
  }

  // --- The database ----------------------------------------------------------------------------------

  private async loadOpenSessions(): Promise<void> {
    const rows = await this.deps.prisma.connectionJournalEntry.findMany({
      where: { source: 'ts', serverConfigId: this.configId, virtualServerId: this.sid, leftAt: null, leaveReason: null },
      select: { id: true, clid: true, uid: true },
    });
    for (const row of rows) {
      if (row.clid !== null && row.uid) this.sessions.set(row.clid, { rowId: row.id, uid: row.uid });
    }
  }

  private async openSession(client: ClientRow, at: Date): Promise<void> {
    const row = await this.deps.prisma.connectionJournalEntry.create({
      data: {
        at,
        source: 'ts',
        event: 'ts-session',
        result: 'success',
        username: client.nickname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_NICKNAME_LENGTH) || null,
        ip: client.ip ?? 'unknown',
        serverConfigId: this.configId,
        virtualServerId: this.sid,
        serverName: this.setup.name,
        uid: client.uid,
        cldbid: client.cldbid,
        clid: client.clid,
        clientVersion: client.version,
        clientPlatform: client.platform,
      },
      select: { id: true },
    });
    this.sessions.set(client.clid, { rowId: row.id, uid: client.uid });
  }

  /** `leftAt` null with a reason of "unknown": the end was not seen, so no time is made up for it. */
  private async closeSession(clid: number, reason: string, leftAt: Date | null): Promise<void> {
    const session = this.sessions.get(clid);
    if (!session) return;
    this.sessions.delete(clid);
    await this.deps.prisma.connectionJournalEntry
      .updateMany({ where: { id: session.rowId, leftAt: null, leaveReason: null }, data: { leftAt, leaveReason: reason } })
      .catch((err: any) => console.warn(`[TsLoginJournal] Could not close session ${session.rowId}: ${err.message}`));
  }

  private async closeAll(reason: string, leftAt: Date | null): Promise<void> {
    for (const clid of [...this.sessions.keys()]) await this.closeSession(clid, reason, leftAt);
  }
}
