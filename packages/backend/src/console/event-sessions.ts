import crypto from 'crypto';
import {
  CONSOLE_EVENT_CATEGORIES,
  categoriesOfEvent,
  parseQueryResponse,
  tsEscape,
  type ConsoleEvent,
  type ConsoleEventCategory,
  type ConsoleEventEnd,
  type ConsoleEventFailure,
  type ConsoleEventRefusal,
  type ConsoleEventStatus,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { SshQueryClient } from '../bot-engine/ssh-query-client.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { decrypt } from '../utils/crypto.js';
import { getConsoleSettings } from '../utils/console-settings.js';
import { MIN_SPACING_MS, consoleFloodGuard } from './flood-guard.js';

// WebQuery can not do `servernotifyregister` - TeamSpeak answers 5120 - so live
// events need an SSH ServerQuery session. The console gives each virtual server
// one of its own, shared by every admin who is listening to it:
//  - never the bot engine's session: the engine tears down the connections it
//    does not need, and the console must neither be cut off by that nor leave
//    its registrations behind in a session the bots rely on;
//  - one per server and virtual server, not one per admin: TeamSpeak only lets
//    a handful of query connections in from one address, and the bots use them too.
// The session registers whatever the admins listening ask for in total, and
// each admin is then handed only the categories they asked for.

/** How long a session stays up after the last admin stopped listening, so that a page reload or a quick restart of the listening reuses it. */
export const IDLE_CLOSE_MS = 60_000;
/** A server connection with this many listener sessions open (one per virtual server) is as many query connections as the console may take. */
const MAX_SESSIONS_PER_CONFIG = 3;
const MAX_LISTENERS_PER_SESSION = 10;
const MAX_STREAMS_PER_USER = 4;
/** How often one admin may open a stream - far more than anyone clicks, but a client stuck in a loop would write an audit row each time. */
const MAX_OPENS_PER_MINUTE = 30;
const COMMAND_TIMEOUT_MS = 15_000;
/** After TeamSpeak refused the SSH login, no new try for this long - or until the connection is edited. */
const AUTH_RETRY_AFTER_MS = 60_000;
/** While the chat of a channel is being listened to, this often is checked that the listener is still in that channel. */
const CHANNEL_CHECK_MS = 30_000;

/** One browser stream, listening through a session. */
export interface EventSubscriber {
  readonly userId: number;
  readonly categories: ReadonlySet<ConsoleEventCategory>;
  /** Set when `textchannel` is among the categories: TeamSpeak delivers the chat of the channel the listener sits in, so this is where it has to sit. */
  readonly textChannelId: number | null;
  onStatus(status: ConsoleEventStatus): void;
  onEvent(event: ConsoleEvent): void;
  /** The session is gone for good; nothing more will come. */
  onEnd(end: ConsoleEventEnd): void;
}

export type EventSessionErrorCode = 'TEXT_CHANNEL_IN_USE' | 'TOO_MANY_LISTENERS' | 'TOO_MANY_STREAMS' | 'RATE_LIMITED';

/** Why a stream could not be attached; the admin can act on all of these. */
export class EventSessionError extends Error {
  constructor(
    readonly code: EventSessionErrorCode,
    message: string,
    readonly channelId?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface EventAttachment {
  /** What the listener looks like right now. Later changes arrive through `onStatus`. */
  status: ConsoleEventStatus;
  /** Idempotent. */
  detach(): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** SshQueryClient reports TeamSpeak's refusals as "TS error <id>: <message>". */
function refusalOf(category: ConsoleEventCategory, err: unknown): ConsoleEventRefusal {
  const message = describeError(err);
  const match = /^TS error (\d+): (.*)$/s.exec(message);
  return { category, code: match ? Number(match[1]) : -1, message: match ? match[2] : message };
}

/** `servernotifyregister` for a category. `channel` takes `id=0`, meaning every channel (an `id` is not used by the others, see reconcile). */
function registrationCommand(category: ConsoleEventCategory): string {
  return category === 'channel' ? 'servernotifyregister event=channel id=0' : `servernotifyregister event=${category}`;
}

type SessionState = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface SessionDeps {
  prisma: PrismaClient;
  pool: ConnectionPool;
  /** Called once when the session is over, so that the manager forgets it. */
  onGone(session: ListenerSession): void;
  /** The message of a login TeamSpeak refused a moment ago for this server connection, if there was one. */
  recentAuthFailure(configId: number): string | null;
  noteAuthFailure(configId: number, message: string): void;
}

class ListenerSession {
  private state: SessionState = 'connecting';
  private client: SshQueryClient | null = null;
  private readonly subscribers = new Set<EventSubscriber>();
  /** What TeamSpeak has registered for this session right now. */
  private readonly registered = new Set<ConsoleEventCategory>();
  private readonly refused = new Map<ConsoleEventCategory, ConsoleEventRefusal>();
  private listenerChannelId: number | null = null;
  private ownClientId: number | null = null;
  /** The commands of this session run one after the other, whoever asks. */
  private tasks: Promise<void> = Promise.resolve();
  /** Counts connections; work begun on an earlier one is dropped. */
  private epoch = 0;
  /** True while the session is signed in to its virtual server and can be told to register. */
  private ready = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private channelTimer: NodeJS.Timeout | null = null;
  private lastCommandAt = 0;
  private spacingMs = MIN_SPACING_MS;
  private readonly nickname = `TS6-Console-${crypto.randomBytes(2).toString('hex')}`;

  constructor(
    readonly configId: number,
    readonly sid: number,
    private readonly deps: SessionDeps,
  ) {}

  // --- Subscribers ---------------------------------------------------------

  add(subscriber: EventSubscriber): ConsoleEventStatus {
    if (this.subscribers.size >= MAX_LISTENERS_PER_SESSION) {
      throw new EventSessionError('TOO_MANY_LISTENERS', 'Too many admins are listening to this virtual server already');
    }
    if (subscriber.categories.has('textchannel') && subscriber.textChannelId !== null) {
      const current = this.wantedTextChannel();
      if (current !== null && current !== subscriber.textChannelId) {
        throw new EventSessionError(
          'TEXT_CHANNEL_IN_USE',
          `Another admin is already listening to the chat of channel ${current}; one session hears one channel`,
          current,
        );
      }
    }

    this.subscribers.add(subscriber);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // What was refused to an earlier admin may be allowed now (permissions change), so ask again.
    for (const category of subscriber.categories) this.refused.delete(category);
    if (this.ready) this.enqueue(() => this.reconcileAndAnnounce());
    return this.statusFor(subscriber);
  }

  remove(subscriber: EventSubscriber): void {
    if (!this.subscribers.delete(subscriber)) return;
    if (this.state === 'closed') return;
    if (this.subscribers.size === 0) {
      // The registrations stay: the next admin may be back within the minute, and nobody is sent anything meanwhile.
      this.idleTimer = setTimeout(() => void this.shutdown(null), IDLE_CLOSE_MS);
      this.idleTimer.unref?.();
    } else if (this.ready) {
      this.enqueue(() => this.reconcileAndAnnounce());
    }
  }

  // --- Connection ----------------------------------------------------------

  async start(): Promise<void> {
    const { prisma, pool } = this.deps;
    try {
      const row = await prisma.tsServerConfig.findUnique({ where: { id: this.configId } });
      if (!row) return this.fail('SSH_CONNECT_FAILED', 'The server connection does not exist any more');
      if (!row.sshUsername || !row.sshPassword || !row.sshPort) {
        return this.fail('SSH_CONNECT_FAILED', 'SSH credentials are not configured for this server connection');
      }
      // A wrong password tried again and again is how a query login gets banned.
      const refusedBefore = this.deps.recentAuthFailure(this.configId);
      if (refusedBefore) return this.fail('SSH_AUTH_FAILED', refusedBefore);
      const settings = await getConsoleSettings(prisma);
      this.spacingMs = settings.floodGuardEnabled ? await consoleFloodGuard.minSpacingMs(pool, this.configId) : MIN_SPACING_MS;
      if (this.state === 'closed') return;

      const client = new SshQueryClient({
        host: row.host,
        port: row.sshPort,
        username: row.sshUsername,
        password: decrypt(row.sshPassword),
      });
      this.client = client;
      client.on('ready', () => this.onReady());
      client.on('event', (name, data) => this.dispatch(name, data));
      client.on('close', () => this.onLost());
      client.on('error', (err) => this.onClientError(err));
      await client.connect();
    } catch (err) {
      // Everyone may have left, or the connection been edited, while this was still connecting.
      if (this.state === 'closed') return;
      this.fail(this.client?.hasFatalError ? 'SSH_AUTH_FAILED' : 'SSH_CONNECT_FAILED', describeError(err));
    }
  }

  /** Fires on the first connection and on every reconnect that SshQueryClient makes by itself. */
  private onReady(): void {
    if (this.state === 'closed') return;
    const epoch = ++this.epoch;
    this.resetRemoteState();

    this.enqueue(async () => {
      if (this.stale(epoch)) return;
      try {
        await this.send(`use sid=${this.sid}`);
      } catch (err) {
        if (this.stale(epoch)) return;
        const message = describeError(err);
        // Only TeamSpeak's own refusal says anything about the virtual server. A connection that
        // dropped meanwhile is not its fault: the reconnect starts the setup over. A server that
        // does not answer at all is reported rather than waited on for ever.
        if (/^TS error \d+:/.test(message)) this.fail('VIRTUAL_SERVER_UNAVAILABLE', message);
        else if (/timed out/i.test(message)) this.fail('SSH_CONNECT_FAILED', message);
        return;
      }
      // So that an admin who sees this query client in the client list knows what it is. Not worth failing over.
      await this.send(`clientupdate client_nickname=${tsEscape(this.nickname)}`).catch(() => undefined);
      if (this.stale(epoch)) return;

      this.ready = true;
      await this.reconcile(epoch);
      if (this.stale(epoch)) return;
      this.state = 'live';
      console.log(`[ConsoleEvents] Listening on server ${this.configId}, virtual server ${this.sid}`);
      this.broadcastStatus();
    });
  }

  /** The SSH connection dropped; SshQueryClient reconnects on its own and calls onReady again. */
  private onLost(): void {
    if (this.state === 'closed') return;
    this.epoch++;
    this.resetRemoteState();
    // SshQueryClient reports a loss from both the channel and the connection; once is enough to say.
    if (this.state === 'reconnecting') return;
    this.state = 'reconnecting';
    console.warn(`[ConsoleEvents] Lost the listener of server ${this.configId}, virtual server ${this.sid}; reconnecting`);
    this.broadcastStatus();
  }

  private onClientError(err: Error): void {
    console.warn(`[ConsoleEvents] SSH error on server ${this.configId}: ${err.message}`);
    // A wrong password is not going to get better by retrying; SshQueryClient has stopped trying too.
    if (this.client?.hasFatalError) this.fail('SSH_AUTH_FAILED', err.message);
  }

  /** Everything TeamSpeak remembered about a connection is gone with it. */
  private resetRemoteState(): void {
    this.ready = false;
    this.registered.clear();
    this.refused.clear();
    this.listenerChannelId = null;
    this.ownClientId = null;
    this.syncChannelCheck();
  }

  // --- Registering ---------------------------------------------------------

  private wantedCategories(): Set<ConsoleEventCategory> {
    const wanted = new Set<ConsoleEventCategory>();
    for (const subscriber of this.subscribers) for (const category of subscriber.categories) wanted.add(category);
    return wanted;
  }

  private wantedTextChannel(): number | null {
    for (const subscriber of this.subscribers) {
      if (subscriber.categories.has('textchannel') && subscriber.textChannelId !== null) return subscriber.textChannelId;
    }
    return null;
  }

  private reconcileAndAnnounce(): Promise<void> {
    const epoch = this.epoch;
    return this.reconcile(epoch).then(() => {
      if (!this.stale(epoch)) this.broadcastStatus();
    });
  }

  /** Brings TeamSpeak's registrations in line with what the listening admins ask for, between them. */
  private async reconcile(epoch: number): Promise<void> {
    // Nobody is listening - the session is waiting out its last minute. Leave it as it is: the next
    // admin may be back before it closes, and what is registered reaches no one meanwhile.
    if (this.subscribers.size === 0) return;
    const wanted = this.wantedCategories();

    // TeamSpeak delivers the chat of the channel the listener is in - measured on 6.0.0-beta13.1: a
    // listener registered with `id=` of a channel it was not in heard nothing, and one registered with
    // the id of another channel than its own heard its own. So the channel is a place, not a parameter.
    const channelId = this.wantedTextChannel();
    if (wanted.has('textchannel') && channelId !== null && this.listenerChannelId !== channelId) {
      try {
        // Where the listener is right now: a session starts in the default channel, and TeamSpeak
        // refuses to move a client into the channel it is already in (770).
        const me = parseQueryResponse((await this.send('whoami')).split('\n')[0] ?? '')[0] ?? {};
        this.ownClientId = Number(me.client_id ?? me.clid);
        if (Number(me.client_channel_id) !== channelId) {
          await this.send(`clientmove clid=${this.ownClientId} cid=${channelId}`);
        }
        this.listenerChannelId = channelId;
        this.refused.delete('textchannel');
      } catch (err) {
        if (this.stale(epoch)) return;
        this.refused.set('textchannel', refusalOf('textchannel', err));
        wanted.delete('textchannel');
      }
    }
    if (this.stale(epoch)) return;

    for (const category of [...this.registered]) {
      if (wanted.has(category)) continue;
      await this.send(`servernotifyunregister event=${category}`).catch(() => undefined);
      if (this.stale(epoch)) return;
      this.registered.delete(category);
    }

    for (const category of CONSOLE_EVENT_CATEGORIES) {
      if (!wanted.has(category) || this.registered.has(category) || this.refused.has(category)) continue;
      try {
        await this.send(registrationCommand(category));
        this.registered.add(category);
      } catch (err) {
        if (this.stale(epoch)) return;
        this.refused.set(category, refusalOf(category, err));
      }
      if (this.stale(epoch)) return;
    }

    this.syncChannelCheck();
  }

  /** While the chat of a channel is listened to, now and then makes sure that the listener has not been moved away or lost its channel. */
  private syncChannelCheck(): void {
    const needed = this.state !== 'closed' && this.registered.has('textchannel') && this.listenerChannelId !== null;
    if (needed && !this.channelTimer) {
      this.channelTimer = setInterval(() => {
        const epoch = this.epoch;
        this.enqueue(() => this.checkChannel(epoch));
      }, CHANNEL_CHECK_MS);
      this.channelTimer.unref?.();
    } else if (!needed && this.channelTimer) {
      clearInterval(this.channelTimer);
      this.channelTimer = null;
    }
  }

  private async checkChannel(epoch: number): Promise<void> {
    if (this.stale(epoch) || !this.ready || this.listenerChannelId === null || !this.registered.has('textchannel')) return;
    const me = parseQueryResponse((await this.send('whoami')).split('\n')[0] ?? '')[0] ?? {};
    if (Number(me.client_channel_id) === this.listenerChannelId) return;

    try {
      await this.send(`clientmove clid=${this.ownClientId} cid=${this.listenerChannelId}`);
    } catch (err) {
      if (this.stale(epoch)) return;
      // Typically the channel is gone. Better to say so than to go on delivering another channel's chat as this one's.
      await this.send('servernotifyunregister event=textchannel').catch(() => undefined);
      this.registered.delete('textchannel');
      this.refused.set('textchannel', refusalOf('textchannel', err));
      this.listenerChannelId = null;
      this.syncChannelCheck();
      this.broadcastStatus();
    }
  }

  // --- Plumbing ------------------------------------------------------------

  private stale(epoch: number): boolean {
    return epoch !== this.epoch || this.state === 'closed';
  }

  private enqueue(task: () => Promise<void>): void {
    this.tasks = this.tasks.then(task).catch((err) => {
      if (this.state !== 'closed') console.warn(`[ConsoleEvents] A listener task failed on server ${this.configId}: ${describeError(err)}`);
    });
  }

  /** One command, kept at least `spacingMs` after the last so that the session stays under the query flood limit. */
  private async send(command: string): Promise<string> {
    const client = this.client;
    if (!client) throw new Error('SSH not connected');
    const wait = this.lastCommandAt + this.spacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCommandAt = Date.now();
    return client.executeCommand(command, COMMAND_TIMEOUT_MS);
  }

  private dispatch(name: string, data: Record<string, string>): void {
    if (this.state === 'closed' || this.subscribers.size === 0) return;
    const categories = categoriesOfEvent(name, data);
    const event: ConsoleEvent = { at: new Date().toISOString(), name, categories, data };
    for (const subscriber of this.subscribers) {
      // An event nobody has classified goes to everyone, rather than to no one.
      if (categories.length > 0 && !categories.some((category) => this.hears(subscriber, category))) continue;
      try {
        subscriber.onEvent(event);
      } catch (err) {
        console.warn(`[ConsoleEvents] A listener could not take an event: ${describeError(err)}`);
      }
    }
  }

  /**
   * Whether what this admin asked for in a category is registered and so being heard. The chat of a
   * channel only counts once the listener sits in the channel this admin asked for: until it has been
   * moved there, or while an earlier admin's channel is still the one it sits in, it is another's.
   */
  private hears(subscriber: EventSubscriber, category: ConsoleEventCategory): boolean {
    if (!subscriber.categories.has(category) || !this.registered.has(category)) return false;
    return category !== 'textchannel' || this.listenerChannelId === subscriber.textChannelId;
  }

  private statusFor(subscriber: EventSubscriber): ConsoleEventStatus {
    const asked = (category: ConsoleEventCategory) => subscriber.categories.has(category);
    return {
      state: this.state === 'closed' ? 'reconnecting' : this.state,
      registered: CONSOLE_EVENT_CATEGORIES.filter((category) => this.hears(subscriber, category)),
      refused: CONSOLE_EVENT_CATEGORIES.filter((category) => asked(category) && this.refused.has(category)).map(
        (category) => this.refused.get(category)!,
      ),
      textChannelId: this.hears(subscriber, 'textchannel') ? this.listenerChannelId : null,
    };
  }

  private broadcastStatus(): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber.onStatus(this.statusFor(subscriber));
      } catch (err) {
        console.warn(`[ConsoleEvents] A listener could not take a status: ${describeError(err)}`);
      }
    }
  }

  // --- Ending --------------------------------------------------------------

  private fail(failure: ConsoleEventFailure, message: string): void {
    console.warn(`[ConsoleEvents] Listener of server ${this.configId}, virtual server ${this.sid} failed: ${failure}: ${message}`);
    if (failure === 'SSH_AUTH_FAILED') this.deps.noteAuthFailure(this.configId, message);
    void this.shutdown({ reason: 'SESSION_FAILED', failure, message });
  }

  /** Ends the session. `end` is what the admins still listening are told; null when there are none. */
  async shutdown(end: ConsoleEventEnd | null): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.epoch++;
    this.ready = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.channelTimer) clearInterval(this.channelTimer);
    this.idleTimer = this.channelTimer = null;
    this.deps.onGone(this);

    const subscribers = [...this.subscribers];
    this.subscribers.clear();
    for (const subscriber of subscribers) {
      try {
        subscriber.onEnd(end ?? { reason: 'SESSION_FAILED', message: 'The listener was closed' });
      } catch (err) {
        console.warn(`[ConsoleEvents] A listener could not take the end: ${describeError(err)}`);
      }
    }

    const client = this.client;
    this.client = null;
    if (client) await client.destroy().catch(() => undefined);
  }
}

export class EventSessionManager {
  private readonly sessions = new Map<string, ListenerSession>();
  /** Every stream that is attached, to cap them per admin. */
  private readonly attached = new Map<EventSubscriber, ListenerSession>();
  /** Per admin: when they opened streams lately. */
  private readonly opened = new Map<number, number[]>();
  /** Per server connection: when TeamSpeak last refused the SSH login, and what it said. */
  private readonly authFailures = new Map<number, { at: number; message: string }>();
  private destroyed = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly pool: ConnectionPool,
  ) {}

  /**
   * Starts listening for a stream. Throws EventSessionError for what the admin
   * can fix; a listener that can not be brought up at all (no route to the
   * server, a wrong SSH password, a virtual server that is not running) is
   * reported later, through `onEnd`, because it is only found out by trying.
   */
  attach(configId: number, sid: number, subscriber: EventSubscriber): EventAttachment {
    if (this.destroyed) throw new Error('The event listener is shutting down');

    const now = Date.now();
    const recent = (this.opened.get(subscriber.userId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= MAX_OPENS_PER_MINUTE) {
      throw new EventSessionError('RATE_LIMITED', 'Streams were opened too often in the last minute', undefined, recent[0] + 60_000 - now);
    }
    // Counted before the other checks: a refused try writes an audit row as well.
    this.opened.set(subscriber.userId, [...recent, now]);

    let streams = 0;
    for (const other of this.attached.keys()) if (other.userId === subscriber.userId) streams++;
    if (streams >= MAX_STREAMS_PER_USER) {
      throw new EventSessionError('TOO_MANY_STREAMS', `At most ${MAX_STREAMS_PER_USER} live event streams per admin; close another one first`);
    }

    const key = `${configId}:${sid}`;
    let session = this.sessions.get(key);
    const isNew = !session;
    if (!session) {
      let forConfig = 0;
      for (const other of this.sessions.values()) if (other.configId === configId) forConfig++;
      if (forConfig >= MAX_SESSIONS_PER_CONFIG) {
        throw new EventSessionError(
          'TOO_MANY_LISTENERS',
          `This server connection already has ${MAX_SESSIONS_PER_CONFIG} listeners open; TeamSpeak only lets so many query connections in`,
        );
      }
      session = new ListenerSession(configId, sid, {
        prisma: this.prisma,
        pool: this.pool,
        onGone: (gone) => this.forget(gone),
        recentAuthFailure: (id) => this.recentAuthFailure(id),
        noteAuthFailure: (id, message) => this.authFailures.set(id, { at: Date.now(), message }),
      });
      this.sessions.set(key, session);
    }

    const status = session.add(subscriber);
    this.attached.set(subscriber, session);
    if (isNew) void session.start();

    return {
      status,
      detach: () => {
        if (this.attached.get(subscriber) !== session) return;
        this.attached.delete(subscriber);
        session!.remove(subscriber);
      },
    };
  }

  private recentAuthFailure(configId: number): string | null {
    const failure = this.authFailures.get(configId);
    if (!failure) return null;
    if (Date.now() - failure.at < AUTH_RETRY_AFTER_MS) return failure.message;
    this.authFailures.delete(configId);
    return null;
  }

  private forget(session: ListenerSession): void {
    const key = `${session.configId}:${session.sid}`;
    if (this.sessions.get(key) === session) this.sessions.delete(key);
    for (const [subscriber, owner] of this.attached) if (owner === session) this.attached.delete(subscriber);
  }

  /** The connection's address or SSH login changed, or it is gone: the sessions on the old one must not outlive it. */
  async closeConfig(configId: number): Promise<void> {
    // New credentials deserve a try right away.
    this.authFailures.delete(configId);
    const closing: Promise<void>[] = [];
    for (const session of [...this.sessions.values()]) {
      if (session.configId === configId) closing.push(session.shutdown({ reason: 'CONNECTION_CHANGED' }));
    }
    await Promise.all(closing);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await Promise.all([...this.sessions.values()].map((session) => session.shutdown({ reason: 'SERVER_SHUTDOWN' })));
  }
}
