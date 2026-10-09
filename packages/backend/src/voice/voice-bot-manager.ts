import { EventEmitter } from 'events';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { WebSocketServer } from 'ws';
import { VoiceBot, type VoiceBotConfig, type VoiceBotStatus } from './voice-bot.js';
import { generateIdentityAsync, restoreIdentity, type IdentityData } from './tslib/index.js';
import type { QueueItem } from './playlist/queue.js';
import type { MusicCommandHandler } from './music-command-handler.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { WebQueryClient } from '../ts-client/webquery-client.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { getStreamDefaults } from '../utils/stream-defaults.js';
import { musicAudience, sendToAudience } from '../utils/ws-audience.js';
import type { BotConnectionInfo } from '@ts6/common';

const PROGRESS_INTERVAL_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY_MS = 30000;
const RECONNECT_GRACE_PERIOD_MS = 5000;
// The server's flood protection (reported as a "ban") lifts by itself, but every
// further attempt - refused ones too - counts against its limit: retrying every
// 6 s never got through in 5 minutes, retrying every 30 s did after about 90 s.
// So it gets a much slower back-off than an ordinary failed connect, and the
// bots of one server take turns (several refused bots retrying at the same
// moment kept each other blocked: 5 of 8 bots were still out after 7 minutes).
const FLOOD_RECONNECT_BASE_MS = 30000;
const FLOOD_RECONNECT_MAX_MS = 300000;
const FLOOD_ATTEMPT_SPACING_MS = 30000;

interface ReconnectState {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** When the pending timer fires (epoch ms); null while an attempt runs */
  nextAttemptAt: number | null;
}

export class VoiceBotManager extends EventEmitter {
  private bots = new Map<number, VoiceBot>();
  private progressTimers = new Map<number, ReturnType<typeof setInterval>>();
  private reconnectState = new Map<number, ReconnectState>();
  // Per server (host:port), the earliest time the next flood-refused bot may try again
  private floodNextSlot = new Map<string, number>();
  // Bots whose automatic attempts ran out. Kept until the bot is started,
  // stopped or removed: that is what makes giving up final (a disconnect event
  // after the last attempt must not begin a new round). The reason is read from
  // the bot when asked for, not stored here: for an unresolvable host the
  // disconnect event that triggers the give-up fires before start() has noted why.
  private gaveUp = new Set<number>();
  // Video streams that currently have nobody watching: since when, and the
  // timer that ends each. Both exist only while such a stream is running.
  private videoEmptySince = new Map<number, number>();
  private videoIdleTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private musicCmdHandler: MusicCommandHandler | null = null;

  constructor(
    private prisma: PrismaClient,
    private wss: WebSocketServer,
    private pool: ConnectionPool,
  ) {
    super();
  }

  /** What a bot of this server connection uses for the few things only WebQuery can do (group lookups, description). */
  private webQueryFor(serverConfigId: number): () => WebQueryClient | null {
    return () => this.pool.tryGetClient(serverConfigId);
  }

  /**
   * The server connection's host was edited: bots that are loaded take the new
   * one. A bot that is connected stays where it is until its next (re)connect -
   * nothing can move a live voice connection to another server.
   */
  async syncServerHost(configId: number): Promise<void> {
    const server = await this.prisma.tsServerConfig.findUnique({ where: { id: configId }, select: { host: true } });
    if (!server) return;
    for (const bot of this.bots.values()) {
      if (bot.currentConfig.serverConfigId === configId) bot.updateConfig({ serverHost: server.host });
    }
  }

  /**
   * The server connection is gone (its database rows with it): stops and forgets
   * every bot that was loaded for it. Does not touch the database, which has
   * already cascaded; going through removeBot would fail on the missing rows.
   */
  async dropServerBots(configId: number): Promise<void> {
    const ids = [...this.bots.entries()]
      .filter(([, bot]) => bot.currentConfig.serverConfigId === configId)
      .map(([id]) => id);
    for (const id of ids) {
      this.clearReconnect(id);
      const bot = this.bots.get(id);
      this.stopProgressBroadcast(id);
      this.musicCmdHandler?.unregisterBot(id);
      this.bots.delete(id);
      if (bot && bot.status !== 'stopped') {
        await bot.stop().catch((err: any) => console.warn(`[VoiceBotManager] Bot ${id}: stopping it for a deleted server connection failed: ${err.message}`));
      }
    }
    if (ids.length > 0) {
      console.log(`[VoiceBotManager] Stopped ${ids.length} music bot(s) of deleted server connection ${configId}`);
    }
  }

  setMusicCommandHandler(handler: MusicCommandHandler): void {
    this.musicCmdHandler = handler;
    // Register all existing bots
    for (const [id, bot] of this.bots) {
      handler.registerBot(id, bot);
    }
  }

  async start(): Promise<void> {
    const dbBots = await this.prisma.musicBot.findMany({
      include: { serverConfig: true },
    });

    console.log(`[VoiceBotManager] Loading ${dbBots.length} music bot(s)...`);

    for (const dbBot of dbBots) {
      let identity: IdentityData | undefined;
      if (dbBot.identityData) {
        // H8: Decrypt identity data before parsing
        const parsed = JSON.parse(decrypt(dbBot.identityData));
        // Reconstruct KeyObjects from serialized scalar data
        identity = restoreIdentity(parsed);
      }
      const config: VoiceBotConfig = {
        id: dbBot.id,
        serverConfigId: dbBot.serverConfigId,
        name: dbBot.name,
        serverHost: dbBot.serverConfig.host,
        serverPort: dbBot.voicePort ?? 9987,
        nickname: dbBot.nickname,
        serverPassword: dbBot.serverPassword ?? undefined,
        defaultChannel: dbBot.defaultChannel ?? undefined,
        channelPassword: dbBot.channelPassword ?? undefined,
        volume: dbBot.volume,
        identity,
        sidecarBinaryPath: process.env.SIDECAR_BINARY_PATH,
        sidecarPort: (dbBot as any).sidecarPort ?? 9800,
        descriptionTemplate: dbBot.descriptionTemplate ?? undefined,
        idlePauseMinutes: dbBot.idlePauseMinutes,
        avatarImage: dbBot.avatarData
          ? { data: Buffer.from(dbBot.avatarData), mimeType: dbBot.avatarMimeType || 'image/png' }
          : undefined,
        getWebQuery: this.webQueryFor(dbBot.serverConfigId),
      };

      const bot = this.createBotInstance(config);
      this.bots.set(dbBot.id, bot);

      if (dbBot.autoStart) {
        bot.start().catch((err) => {
          console.error(`[VoiceBotManager] Auto-start failed for bot ${dbBot.id}: ${err.message}`);
        });
      }
    }
  }

  /**
   * The client IDs of this app's other bots that are connected to the same
   * voice server: they are voice clients like anybody else, so only this
   * knowledge tells a bot that they are not company.
   */
  private otherBotClientIds(botId: number): ReadonlySet<number> {
    const me = this.bots.get(botId)?.currentConfig;
    const ids = new Set<number>();
    if (!me) return ids;
    for (const [id, other] of this.bots) {
      if (id === botId) continue;
      const cfg = other.currentConfig;
      if (cfg.serverConfigId !== me.serverConfigId || cfg.serverPort !== me.serverPort) continue;
      // A stopped bot keeps its last client ID, which a person may hold by now
      if (other.status === 'stopped' || other.status === 'starting' || other.status === 'error') continue;
      const clid = other.ts3ClientId;
      if (clid) ids.add(clid);
    }
    return ids;
  }

  private createBotInstance(config: VoiceBotConfig): VoiceBot {
    config.getOtherBotClientIds = () => this.otherBotClientIds(config.id);
    // Every event of this bot goes to the users who may see this bot: admins, and the music roles granted its server connection.
    const broadcast = (type: string, payload: object) => sendToAudience(this.wss, type, payload, musicAudience(config.serverConfigId));
    const bot = new VoiceBot(config);

    bot.on('statusChange', (status: VoiceBotStatus) => {
      broadcast('music:bot:status', { botId: config.id, status });

      if (status === 'playing') {
        this.startProgressBroadcast(config.id);
      } else {
        this.stopProgressBroadcast(config.id);
      }
    });

    // Fires once per successful connect (manual Start, autoStart at boot,
    // or an automatic reconnect) - unlike 'statusChange', which also reports
    // 'connected' every time playback simply returns to idle (track end,
    // Stop, a failed play), so autoplay can't hook into that one without
    // re-triggering on every song that finishes.
    bot.on('connected', () => {
      // Connected by whatever route (Start, restart, boot): nothing is given up on any more
      this.gaveUp.delete(config.id);
      this.runAutoplayOnConnect(config.id, bot).catch((err) => {
        console.error(`[VoiceBotManager] Bot ${config.id}: autoplay-on-connect failed: ${err.message}`);
      });
    });

    bot.on('error', (err: Error) => {
      console.error(`[VoiceBotManager] Bot ${config.id} error: ${err.message}`);
    });

    bot.on('nowPlaying', (item: QueueItem) => {
      const progress = bot.playbackProgress;
      broadcast('music:bot:nowPlaying', {
        botId: config.id,
        song: { id: item.id, title: item.title, artist: item.artist, duration: item.duration, source: item.source },
        progress: progress ? { position: progress.position, duration: progress.duration } : null,
      });
    });

    bot.on('trackEnd', (item: QueueItem | null) => {
      broadcast('music:bot:trackEnd', { botId: config.id, songId: item?.id ?? null });
    });

    bot.on('volumeChange', (volume: number) => {
      broadcast('music:bot:volumeChange', { botId: config.id, volume });
    });

    bot.on('metadataChange', (item: QueueItem) => {
      broadcast('music:bot:nowPlaying', {
        botId: config.id,
        song: { id: item.id, title: item.title, artist: item.artist, duration: item.duration, source: item.source },
        progress: null,
      });
    });

    bot.on('disconnected', () => {
      // A fatal error (banned, ...) tears the connection down half a second
      // after it is reported - that disconnect is the end of the story, not a
      // dropped connection to retry (see the 'fatalError' handler below).
      if (!bot.manuallyStopped && !bot.hasFatalError) {
        console.log(`[VoiceBotManager] Bot ${config.id}: unexpected disconnect, scheduling reconnect`);
        this.scheduleReconnect(config.id);
      }
    });

    // Video streaming events
    bot.on('videoStreamStarted', (data: any) => {
      broadcast('music:bot:videoStreamStarted', { botId: config.id, ...data });
      // Nobody has had the chance to join yet: the clock for an unwatched stream starts here
      this.evaluateVideoIdleStop(config.id);
    });

    bot.on('videoStreamStopped', () => {
      broadcast('music:bot:videoStreamStopped', { botId: config.id });
      this.evaluateVideoIdleStop(config.id);
    });

    bot.on('videoViewerJoined', (viewer: any) => {
      broadcast('music:bot:videoViewerJoined', { botId: config.id, viewer });
      this.evaluateVideoIdleStop(config.id);
    });

    bot.on('videoViewerLeft', (clid: number) => {
      broadcast('music:bot:videoViewerLeft', { botId: config.id, clid });
      this.evaluateVideoIdleStop(config.id);
    });

    bot.on('videoSourceChanged', (source: string) => {
      broadcast('music:bot:videoSourceChanged', { botId: config.id, source });
    });

    bot.on('fatalError', (msg: string) => {
      console.error(`[VoiceBotManager] Bot ${config.id}: fatal error — ${msg}. No reconnect.`);
      this.clearReconnect(config.id);
      broadcast('music:bot:error', { botId: config.id, error: msg });
    });

    // Register for music text commands
    if (this.musicCmdHandler) {
      this.musicCmdHandler.registerBot(config.id, bot);
    }

    return bot;
  }

  async createBot(data: {
    name: string;
    serverConfigId: number;
    nickname?: string;
    serverPassword?: string;
    defaultChannel?: string;
    channelPassword?: string;
    voicePort?: number;
    volume?: number;
    autoStart?: boolean;
    descriptionTemplate?: string;
    autoplayMode?: string;
    autoplaySongId?: number;
    autoplayRadioStationId?: number;
    idlePauseMinutes?: number;
  }): Promise<{ id: number }> {
    // Enforce bot limit
    const limitSetting = await this.prisma.appSetting.findUnique({ where: { key: 'max_music_bots' } });
    const limit = parseInt(limitSetting?.value ?? '10') || 10;
    const currentCount = await this.prisma.musicBot.count();
    if (currentCount >= limit) {
      throw new Error(`Music bot limit reached (${limit}). Adjust the limit in Settings.`);
    }

    // Generate identity with security level high enough for most servers (default minimum is 8, many use 21+)
    // Uses worker thread to avoid blocking the event loop (~5s of SHA1 brute-force)
    const identity = await generateIdentityAsync(23);
    // H8: Encrypt identity data at rest
    const identityData = encrypt(JSON.stringify(identity, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));

    // Get server config for host
    const serverConfig = await this.prisma.tsServerConfig.findUnique({ where: { id: data.serverConfigId } });
    if (!serverConfig) throw new Error('Server config not found');

    const dbBot = await this.prisma.musicBot.create({
      data: {
        name: data.name,
        serverConfigId: data.serverConfigId,
        nickname: data.nickname ?? 'MusicBot',
        serverPassword: data.serverPassword,
        defaultChannel: data.defaultChannel,
        channelPassword: data.channelPassword,
        voicePort: data.voicePort ?? 9987,
        volume: data.volume ?? 50,
        autoStart: data.autoStart ?? false,
        identityData,
        descriptionTemplate: data.descriptionTemplate,
        autoplayMode: data.autoplayMode ?? 'none',
        autoplaySongId: data.autoplayMode === 'song' ? data.autoplaySongId : undefined,
        autoplayRadioStationId: data.autoplayMode === 'radio' ? data.autoplayRadioStationId : undefined,
        idlePauseMinutes: data.idlePauseMinutes ?? 0,
      },
    });

    const config: VoiceBotConfig = {
      id: dbBot.id,
      serverConfigId: data.serverConfigId,
      name: dbBot.name,
      serverHost: serverConfig.host,
      serverPort: dbBot.voicePort ?? 9987,
      nickname: dbBot.nickname,
      serverPassword: dbBot.serverPassword ?? undefined,
      defaultChannel: dbBot.defaultChannel ?? undefined,
      channelPassword: dbBot.channelPassword ?? undefined,
      volume: dbBot.volume,
      identity,
      sidecarBinaryPath: process.env.SIDECAR_BINARY_PATH,
      sidecarPort: 9800,
      descriptionTemplate: dbBot.descriptionTemplate ?? undefined,
      idlePauseMinutes: dbBot.idlePauseMinutes,
      getWebQuery: this.webQueryFor(data.serverConfigId),
    };

    const bot = this.createBotInstance(config);
    this.bots.set(dbBot.id, bot);

    return { id: dbBot.id };
  }

  getBot(id: number): VoiceBot | undefined {
    return this.bots.get(id);
  }

  /**
   * The unique ID (client_unique_identifier) TeamSpeak shows for this bot - the
   * only part of its identity that may leave the backend; the identity itself
   * holds the private key. null for a bot without a stored identity: it
   * connects with a throwaway one each time, so there is no ID worth showing.
   */
  getIdentityUid(id: number): string | null {
    return this.bots.get(id)?.currentConfig.identity?.uid ?? null;
  }

  /**
   * Every unique ID one of this app's bots has, stored or in use right now - what
   * tells a bot from a person in a client list. A bot without a stored identity
   * has a different one each time it connects, so the live one counts too.
   */
  ownIdentityUids(): Set<string> {
    const uids = new Set<string>();
    for (const bot of this.bots.values()) {
      const stored = bot.currentConfig.identity?.uid;
      if (stored) uids.add(stored);
      const live = bot.liveIdentityUid;
      if (live) uids.add(live);
    }
    return uids;
  }

  async removeBot(id: number): Promise<void> {
    this.clearReconnect(id);
    const bot = this.bots.get(id);
    if (bot && bot.status !== 'stopped') {
      await bot.stop();
    }
    this.stopProgressBroadcast(id);
    this.bots.delete(id);
    await this.prisma.musicBot.delete({ where: { id } });
  }

  /** Stop and delete every music bot across every server - see clusterzx/ts6-manager#58. */
  async removeAllBots(): Promise<number> {
    const all = await this.prisma.musicBot.findMany({ select: { id: true } });
    for (const { id } of all) {
      await this.removeBot(id);
    }
    return all.length;
  }

  async getBotsForServer(configId: number): Promise<Array<{ botId: number; bot: VoiceBot }>> {
    const dbBots = await this.prisma.musicBot.findMany({
      where: { serverConfigId: configId },
      select: { id: true },
    });
    const result: Array<{ botId: number; bot: VoiceBot }> = [];
    for (const db of dbBots) {
      const bot = this.bots.get(db.id);
      if (bot && bot.status !== 'stopped') {
        result.push({ botId: db.id, bot });
      }
    }
    return result;
  }

  listBots(): Array<{ id: number; status: VoiceBotStatus; connection: BotConnectionInfo | null; nowPlaying: QueueItem | null }> {
    const list: Array<{ id: number; status: VoiceBotStatus; connection: BotConnectionInfo | null; nowPlaying: QueueItem | null }> = [];
    for (const [id, bot] of this.bots) {
      list.push({ id, status: bot.status, connection: this.getConnectionInfo(id), nowPlaying: bot.nowPlaying });
    }
    return list;
  }

  /** What a bot that is not connected is doing about it, for the UI: an
   * attempt running, waiting for the next automatic attempt (and when), or
   * done trying (and why). null when connected, or stopped on purpose. */
  getConnectionInfo(botId: number): BotConnectionInfo | null {
    const bot = this.bots.get(botId);
    if (!bot || bot.manuallyStopped) return null;
    if (bot.status === 'connected' || bot.status === 'playing' || bot.status === 'paused') return null;

    const state = this.reconnectState.get(botId);
    const kind = bot.failureKind ?? 'other';
    const reason = bot.failureReason;
    const attempt = state?.attempts ?? 0;

    if (this.gaveUp.has(botId)) {
      return { phase: 'failed', attempt: MAX_RECONNECT_ATTEMPTS, maxAttempts: MAX_RECONNECT_ATTEMPTS, nextAttemptAt: null, kind, reason };
    }

    // Refused for good (banned, wrong password, server full): nothing will be tried again
    if (bot.hasFatalError) {
      return { phase: 'failed', attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS, nextAttemptAt: null, kind, reason };
    }
    if (state?.timer && state.nextAttemptAt !== null) {
      return { phase: 'retrying', attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS, nextAttemptAt: new Date(state.nextAttemptAt).toISOString(), kind, reason };
    }
    // An automatic attempt is under way (its grace pause included), or Start / boot is connecting.
    // 'error' is the half second between a failed attempt and the disconnect that
    // decides what happens next (retry or give up) - still "connecting", not "nothing".
    if (state || bot.status === 'starting' || bot.status === 'error') {
      return { phase: 'connecting', attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS, nextAttemptAt: null, kind, reason };
    }
    return null;
  }

  async startBot(id: number): Promise<void> {
    const bot = this.bots.get(id);
    if (!bot) throw new Error(`Music bot ${id} not found`);
    this.clearReconnect(id);
    await bot.start();
  }

  async restartBot(id: number): Promise<void> {
    const bot = this.bots.get(id);
    if (!bot) throw new Error(`Music bot ${id} not found`);
    this.clearReconnect(id);
    await bot.restart();
  }

  async stopBot(id: number): Promise<void> {
    const bot = this.bots.get(id);
    if (!bot) throw new Error(`Music bot ${id} not found`);
    this.clearReconnect(id);
    await bot.stop();
  }

  async stopAll(): Promise<void> {
    // Clear all reconnect timers first to prevent reconnect during shutdown
    for (const [id, state] of this.reconnectState) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.reconnectState.clear();

    const promises: Promise<void>[] = [];
    for (const bot of this.bots.values()) {
      if (bot.status !== 'stopped') {
        promises.push(bot.stop());
      }
    }
    this.progressTimers.forEach((timer) => clearInterval(timer));
    this.progressTimers.clear();
    await Promise.allSettled(promises);
  }

  // --- Auto-reconnect logic ---

  private scheduleReconnect(botId: number): void {
    const bot = this.bots.get(botId);
    if (!bot) return;

    // Also covers the failure path of attemptReconnect: a refused connection
    // (banned, wrong password, server full) must not queue another attempt.
    if (bot.hasFatalError) {
      this.clearReconnect(botId);
      return;
    }

    // Final: the disconnect event that follows the last failed attempt (and the
    // catch of attemptReconnect) must not start a new round
    if (this.gaveUp.has(botId)) return;

    let state = this.reconnectState.get(botId);
    if (!state) {
      state = { attempts: 0, timer: null, nextAttemptAt: null };
      this.reconnectState.set(botId, state);
    }

    // Prevent double-scheduling (can happen when both 'disconnected' handler
    // and attemptReconnect catch block trigger simultaneously)
    if (state.timer) return;

    if (state.attempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[VoiceBotManager] Bot ${botId}: max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
      this.gaveUp.add(botId);
      this.reconnectState.delete(botId);
      this.broadcastForBot(botId, 'music:bot:reconnectFailed', { botId });
      return;
    }

    const flood = bot.isFloodBlocked;
    let delay: number;
    if (flood) {
      delay = Math.min(Math.pow(2, state.attempts) * FLOOD_RECONNECT_BASE_MS, FLOOD_RECONNECT_MAX_MS);
      const { serverHost, serverPort } = bot.currentConfig;
      const server = `${serverHost}:${serverPort}`;
      const turn = Math.max(Date.now() + delay, this.floodNextSlot.get(server) ?? 0);
      this.floodNextSlot.set(server, turn + FLOOD_ATTEMPT_SPACING_MS);
      delay = turn - Date.now();
    } else {
      delay = Math.min(Math.pow(2, state.attempts) * 1000, MAX_RECONNECT_DELAY_MS);
    }
    state.attempts++;
    console.log(`[VoiceBotManager] Bot ${botId}: reconnect attempt ${state.attempts}/${MAX_RECONNECT_ATTEMPTS} in ${Math.round(delay / 100) / 10}s${flood ? ' (the server\'s flood protection refused the connection, backing off slowly)' : ''}`);

    state.nextAttemptAt = Date.now() + delay;
    state.timer = setTimeout(() => this.attemptReconnect(botId), delay);
  }

  private async attemptReconnect(botId: number): Promise<void> {
    const bot = this.bots.get(botId);
    const state = this.reconnectState.get(botId);
    if (!bot || !state) return;

    // Don't reconnect if bot hit a fatal error (wrong password, banned, etc.)
    if (bot.status === 'error') {
      console.log(`[VoiceBotManager] Bot ${botId}: in error state, aborting reconnect`);
      this.reconnectState.delete(botId);
      return;
    }

    // Mark timer as executed so scheduleReconnect can run again
    state.timer = null;
    state.nextAttemptAt = null;

    try {
      // Ensure previous connection is fully cleaned up before reconnecting
      // This prevents duplicate clients when the TS server restarts
      bot.ensureDisconnected();
      await new Promise((r) => setTimeout(r, RECONNECT_GRACE_PERIOD_MS));

      await bot.start();
      console.log(`[VoiceBotManager] Bot ${botId}: reconnected successfully after ${state.attempts} attempt(s)`);
      this.reconnectState.delete(botId);
    } catch (err: any) {
      console.error(`[VoiceBotManager] Bot ${botId}: reconnect attempt ${state.attempts} failed: ${err.message}`);
      // Schedule next attempt (guard in scheduleReconnect prevents double-scheduling
      // if 'disconnected' event also fires from the failed connect)
      this.scheduleReconnect(botId);
    }
  }

  /** Starts the bot's configured autoplay track/station right after it
   * connects, as long as it came up idle - never overrides a queue that
   * survived a reconnect on the same bot instance. */
  private async runAutoplayOnConnect(botId: number, bot: VoiceBot): Promise<void> {
    if (bot.queue.length > 0) return;

    const dbBot = await this.prisma.musicBot.findUnique({ where: { id: botId } });
    if (!dbBot || dbBot.autoplayMode === 'none') return;

    if (dbBot.autoplayMode === 'song' && dbBot.autoplaySongId) {
      const song = await this.prisma.song.findUnique({ where: { id: dbBot.autoplaySongId } });
      if (!song) return;
      const queueItem: QueueItem = {
        id: String(song.id),
        title: song.title,
        artist: song.artist ?? undefined,
        duration: song.duration ?? undefined,
        filePath: song.filePath,
        source: song.source as any,
        sourceUrl: song.sourceUrl ?? undefined,
      };
      bot.queue.insertNext(queueItem);
      await bot.play(queueItem);
    } else if (dbBot.autoplayMode === 'radio' && dbBot.autoplayRadioStationId) {
      const station = await this.prisma.radioStation.findUnique({ where: { id: dbBot.autoplayRadioStationId } });
      if (!station) return;
      const queueItem: QueueItem = {
        id: `radio_${station.id}`,
        title: station.name,
        artist: station.genre ?? 'Radio',
        filePath: '',
        source: 'radio',
        streamUrl: station.url,
      };
      await bot.playStream(queueItem);
    }
  }

  /**
   * Ends a video stream that nobody has watched for the time set in Settings ->
   * Streaming (0 = never). Called whenever something that bears on it changes -
   * the stream starts or stops, a viewer joins or leaves, the setting is saved -
   * and works out what is due from the bot's own state, so no caller has to know
   * whether the stream is empty right now.
   *
   * The setting is read on every evaluation rather than once when the stream
   * starts: lowering it applies to a stream that has already been empty a while.
   */
  private evaluateVideoIdleStop(botId: number): void {
    this.runVideoIdleStop(botId).catch((err: any) => {
      console.error(`[VoiceBotManager] Bot ${botId}: checking the idle video stream failed: ${err.message}`);
    });
  }

  /** Re-checks every running video stream; for when the setting was just saved. */
  reevaluateVideoIdleStops(): void {
    for (const [id, bot] of this.bots) {
      if (bot.videoStreaming) this.evaluateVideoIdleStop(id);
    }
  }

  private clearVideoIdleTimer(botId: number): void {
    const timer = this.videoIdleTimers.get(botId);
    if (timer) {
      clearTimeout(timer);
      this.videoIdleTimers.delete(botId);
    }
  }

  private async runVideoIdleStop(botId: number): Promise<void> {
    this.clearVideoIdleTimer(botId);
    const bot = this.bots.get(botId);
    if (!bot || !bot.videoStreaming || bot.videoViewerCount > 0) {
      this.videoEmptySince.delete(botId);
      return;
    }
    if (!this.videoEmptySince.has(botId)) this.videoEmptySince.set(botId, Date.now());

    const { idleStopMinutes } = await getStreamDefaults(this.prisma);

    // Whatever happened while the setting was being read ran its own evaluation
    // and has cleaned up after itself; this one must not set a timer for a
    // stream that has since gained a viewer or ended.
    if (!bot.videoStreaming || bot.videoViewerCount > 0) return;
    if (idleStopMinutes <= 0) return;

    const since = this.videoEmptySince.get(botId) ?? Date.now();
    const remaining = since + idleStopMinutes * 60_000 - Date.now();
    if (remaining > 0) {
      this.clearVideoIdleTimer(botId);
      this.videoIdleTimers.set(botId, setTimeout(() => this.evaluateVideoIdleStop(botId), remaining));
      return;
    }

    console.log(`[VoiceBotManager] Bot ${botId}: nobody has watched the video stream for ${idleStopMinutes} min, stopping it`);
    this.videoEmptySince.delete(botId);
    await bot.stopVideoStream();
  }

  private clearReconnect(botId: number): void {
    this.gaveUp.delete(botId);
    const state = this.reconnectState.get(botId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.reconnectState.delete(botId);
  }

  private startProgressBroadcast(botId: number): void {
    this.stopProgressBroadcast(botId);
    const timer = setInterval(() => {
      const bot = this.bots.get(botId);
      if (!bot || bot.status !== 'playing') {
        this.stopProgressBroadcast(botId);
        return;
      }
      const progress = bot.playbackProgress;
      if (progress) {
        this.broadcastForBot(botId, 'music:bot:progress', {
          botId,
          position: progress.position,
          duration: progress.duration,
        });
      }
    }, PROGRESS_INTERVAL_MS);
    this.progressTimers.set(botId, timer);
  }

  private stopProgressBroadcast(botId: number): void {
    const timer = this.progressTimers.get(botId);
    if (timer) {
      clearInterval(timer);
      this.progressTimers.delete(botId);
    }
  }

  /**
   * An event of a bot that is only known by its id: it goes to the users who may see that bot - admins,
   * and the music roles granted its server connection. A bot that is gone is nobody's but the admins'.
   */
  private broadcastForBot(botId: number, type: string, payload: object): void {
    sendToAudience(this.wss, type, payload, musicAudience(this.bots.get(botId)?.currentConfig.serverConfigId));
  }
}
