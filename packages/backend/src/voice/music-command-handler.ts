import type { PrismaClient } from '../generated/prisma/client.js';
import { VoiceBotManager } from './voice-bot-manager.js';
import type { VoiceBot } from './voice-bot.js';
import type { QueueItem } from './playlist/queue.js';
import { downloadYouTube } from './audio/youtube.js';
import { STREAM_PRESETS } from './streaming/types.js';

const MUSIC_DIR = process.env.MUSIC_DIR || '/data/music';
const CMD_PREFIX = '!';

const MUSIC_COMMANDS = new Set([
  'radio', 'play', 'stop', 'pause', 'skip', 'next', 'prev',
  'vol', 'volume', 'np', 'nowplaying', 'queue', 'add',
  'stream', 'stopstream', 'viewers',
]);

/**
 * A bare URL is used as-is; anything else is treated as a search query via
 * yt-dlp's own "ytsearch1:" syntax, which resolves to the first result the
 * same way a real URL would - no separate search API/UI needed.
 */
function toYtDlpSource(input: string): string {
  return input.startsWith('http://') || input.startsWith('https://') ? input : `ytsearch1:${input}`;
}

/**
 * Handles text-based music commands (!radio, !play, !stop, etc.)
 * by listening directly on each VoiceBot's TS3 connection.
 *
 * The bot receives `notifytextmessage` in its own channel —
 * no SSH EventBridge needed.
 */
export class MusicCommandHandler {
  private registeredBots = new Set<number>();

  constructor(
    private prisma: PrismaClient,
    private voiceBotManager: VoiceBotManager,
  ) {}

  /**
   * Register text message listener on a VoiceBot instance.
   * Called by VoiceBotManager whenever a bot is created/started.
   */
  registerBot(botId: number, bot: VoiceBot): void {
    if (this.registeredBots.has(botId)) return;
    this.registeredBots.add(botId);

    bot.on('textMessage', (data: Record<string, string>) => {
      this.onTextMessage(botId, bot, data).catch(err => {
        console.error(`[MusicCmd] Error processing text message on bot ${botId}: ${err.message}`);
      });
    });

    console.log(`[MusicCmd] Registered text command listener on bot ${botId}`);
  }

  unregisterBot(botId: number): void {
    this.registeredBots.delete(botId);
  }

  private async onTextMessage(botId: number, bot: VoiceBot, data: Record<string, string>): Promise<void> {
    const msg = (data.msg || '').trim();
    if (!msg.startsWith(CMD_PREFIX)) return;

    const parts = msg.substring(CMD_PREFIX.length).split(/\s+/);
    const command = parts[0].toLowerCase();
    if (!MUSIC_COMMANDS.has(command)) return;

    const rawArgs = parts.slice(1).join(' ').trim();
    // TS3 auto-wraps links in chat as BBCode: [URL]https://...[/URL]. Every
    // command here that expects a bare URL (!play, !queue, !stream) reads
    // straight from `args`, so strip the wrapper once instead of at each
    // call site.
    const args = rawArgs.replace(/\[URL\](.*?)\[\/URL\]/gi, '$1');
    const userClid = parseInt(data.invokerid || '0');
    if (!userClid) return;

    // Ignore messages from ourselves (the bot)
    if (userClid === bot.ts3ClientId) return;

    console.log(`[MusicCmd] Bot ${botId}: !${command} ${args} (from clid=${userClid})`);

    try {
      switch (command) {
        case 'radio':
          await this.handleRadio(botId, bot, userClid, args);
          break;
        case 'play':
          await this.handlePlay(bot, userClid, args);
          break;
        case 'stop':
          this.handleStop(bot, userClid);
          break;
        case 'pause':
          this.handlePause(bot, userClid);
          break;
        case 'skip':
        case 'next':
          await this.handleSkip(bot, userClid);
          break;
        case 'prev':
          await this.handlePrev(bot, userClid);
          break;
        case 'vol':
        case 'volume':
          this.handleVolume(bot, userClid, args);
          break;
        case 'np':
        case 'nowplaying':
          this.handleNowPlaying(bot, userClid);
          break;
        case 'queue':
        case 'add':
          await this.handleQueue(bot, userClid, args);
          break;
        case 'stream':
          await this.handleStream(bot, userClid, args);
          break;
        case 'stopstream':
          await this.handleStopStream(bot, userClid);
          break;
        case 'viewers':
          this.handleViewers(bot, userClid);
          break;
      }
    } catch (err: any) {
      console.error(`[MusicCmd] Error handling !${command}: ${err.message}`);
      this.reply(bot, userClid, `Error: ${err.message}`);
    }
  }

  private reply(bot: VoiceBot, targetClid: number, msg: string): void {
    try {
      bot.sendTextMessage(targetClid, msg);
    } catch (err: any) {
      console.error(`[MusicCmd] Failed to send reply: ${err.message}`);
    }
  }

  // ─── Command Handlers ───────────────────────────────────────

  private async handleRadio(botId: number, bot: VoiceBot, userClid: number, args: string): Promise<void> {
    // Get serverConfigId for this bot from DB
    const dbBot = await this.prisma.musicBot.findUnique({ where: { id: botId }, select: { serverConfigId: true } });
    if (!dbBot) {
      this.reply(bot, userClid, 'Bot config not found.');
      return;
    }

    const stations = await this.prisma.radioStation.findMany({
      where: { serverConfigId: dbBot.serverConfigId },
      orderBy: { name: 'asc' },
    });

    if (stations.length === 0) {
      this.reply(bot, userClid, 'No radio stations configured.');
      return;
    }

    // No argument — list stations
    if (!args) {
      const lines = stations.map((s: any) => `[${s.id}] ${s.name}${s.genre ? ` (${s.genre})` : ''}`);
      this.reply(bot, userClid, 'Radio Stations:\n' + lines.join('\n'));
      return;
    }

    // Argument — play station by ID
    const stationId = parseInt(args);
    if (isNaN(stationId)) {
      this.reply(bot, userClid, 'Usage: !radio <id> — Use !radio to list stations.');
      return;
    }

    const station = stations.find((s: any) => s.id === stationId);
    if (!station) {
      this.reply(bot, userClid, `Station #${stationId} not found. Use !radio to list stations.`);
      return;
    }

    const queueItem: QueueItem = {
      id: `radio_${station.id}`,
      title: station.name,
      artist: station.genre ?? 'Radio',
      filePath: '',
      source: 'radio',
      streamUrl: station.url,
    };

    await bot.playStream(queueItem);
    this.reply(bot, userClid, `Now playing: ${station.name}`);
  }

  private async handlePlay(bot: VoiceBot, userClid: number, args: string): Promise<void> {
    if (!args) {
      if (bot.status === 'paused') {
        bot.resume();
        this.reply(bot, userClid, 'Resumed.');
        return;
      }
      this.reply(bot, userClid, 'Usage: !play <youtube-url or search terms>');
      return;
    }

    this.reply(bot, userClid, 'Loading...');

    try {
      const { filePath, info } = await downloadYouTube(toYtDlpSource(args), MUSIC_DIR);

      const queueItem: QueueItem = {
        id: `yt_${info.id}`,
        title: info.title,
        artist: info.artist,
        duration: info.duration,
        filePath,
        source: 'youtube',
        sourceUrl: info.url,
      };

      bot.queue.add(queueItem);

      // Save to MusicRequest history
      this.saveMusicRequest(bot, queueItem);

      // If something is already playing, queue it instead of interrupting
      if (bot.status === 'playing' || bot.status === 'paused') {
        this.reply(bot, userClid, `Queued: ${info.artist} - ${info.title} (position #${bot.queue.length})`);
      } else {
        bot.queue.playAt(bot.queue.length - 1);
        await bot.play(queueItem);
        this.reply(bot, userClid, `Now playing: ${info.artist} - ${info.title}`);
      }
    } catch (err: any) {
      this.reply(bot, userClid, `Failed to play: ${err.message}`);
    }
  }

  private showQueue(bot: VoiceBot, userClid: number): void {
    const items = bot.queue.getAll();
    if (items.length === 0) {
      this.reply(bot, userClid, 'Queue is empty.');
      return;
    }

    const currentIdx = bot.queue.index;
    const lines = items.slice(0, 15).map((item, i) => {
      const marker = i === currentIdx ? '▶ ' : '  ';
      const artist = item.artist ? `${item.artist} - ` : '';
      const dur = item.duration ? ` [${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}]` : '';
      return `${marker}${i + 1}. ${artist}${item.title}${dur}`;
    });
    if (items.length > 15) lines.push(`  ... and ${items.length - 15} more`);
    this.reply(bot, userClid, `Queue (${items.length} tracks):\n${lines.join('\n')}`);
  }

  private async handleQueue(bot: VoiceBot, userClid: number, args: string): Promise<void> {
    // No args or "show" — display current queue
    if (!args || args.toLowerCase() === 'show') {
      this.showQueue(bot, userClid);
      return;
    }

    // !queue remove <index>
    if (args.toLowerCase().startsWith('remove ')) {
      const idx = parseInt(args.substring(7).trim()) - 1; // 1-based to 0-based
      const items = bot.queue.getAll();
      if (isNaN(idx) || idx < 0 || idx >= items.length) {
        this.reply(bot, userClid, `Invalid index. Queue has ${items.length} tracks.`);
        return;
      }
      const removed = items[idx];
      bot.queue.remove(removed.id);
      this.reply(bot, userClid, `Removed #${idx + 1}: ${removed.title}`);
      return;
    }

    // !queue play <index>
    if (args.toLowerCase().startsWith('play ')) {
      const idx = parseInt(args.substring(5).trim()) - 1; // 1-based to 0-based
      const item = bot.queue.playAt(idx);
      if (!item) {
        this.reply(bot, userClid, `Invalid index. Queue has ${bot.queue.length} tracks.`);
        return;
      }
      if (item.streamUrl) {
        await bot.playStream(item);
      } else {
        await bot.play(item);
      }
      this.reply(bot, userClid, `Playing #${idx + 1}: ${item.title}`);
      return;
    }

    // !queue clear
    if (args.toLowerCase() === 'clear') {
      bot.queue.clear();
      this.reply(bot, userClid, 'Queue cleared.');
      return;
    }

    // URL or search terms provided — add to queue without interrupting
    this.reply(bot, userClid, 'Loading...');

    try {
      const { filePath, info } = await downloadYouTube(toYtDlpSource(args), MUSIC_DIR);

      const queueItem: QueueItem = {
        id: `yt_${info.id}`,
        title: info.title,
        artist: info.artist,
        duration: info.duration,
        filePath,
        source: 'youtube',
        sourceUrl: info.url,
      };

      bot.queue.add(queueItem);

      // Save to MusicRequest history
      this.saveMusicRequest(bot, queueItem);

      // If nothing is playing, start playing the queued item
      if (bot.status !== 'playing' && bot.status !== 'paused') {
        bot.queue.playAt(bot.queue.length - 1);
        await bot.play(queueItem);
        this.reply(bot, userClid, `Now playing: ${info.artist} - ${info.title}`);
      } else {
        this.reply(bot, userClid, `Queued: ${info.artist} - ${info.title} (position #${bot.queue.length})`);
      }
    } catch (err: any) {
      this.reply(bot, userClid, `Failed to queue: ${err.message}`);
    }
  }

  private handleStop(bot: VoiceBot, userClid: number): void {
    if (bot.status !== 'playing' && bot.status !== 'paused') {
      // Avoids the misleading "Playback stopped." when nothing was actually
      // playing - e.g. only a video stream was active (stopped separately
      // via !stopstream, which this command intentionally doesn't touch).
      this.reply(bot, userClid, 'Nothing was playing.');
      return;
    }
    bot.stopAudio();
    this.reply(bot, userClid, 'Playback stopped.');
  }

  private handlePause(bot: VoiceBot, userClid: number): void {
    if (bot.status === 'paused') {
      bot.resume();
      this.reply(bot, userClid, 'Resumed.');
    } else if (bot.status === 'playing') {
      bot.pause();
      this.reply(bot, userClid, 'Paused.');
    } else {
      this.reply(bot, userClid, 'Nothing is playing.');
    }
  }

  private async handleSkip(bot: VoiceBot, userClid: number): Promise<void> {
    const next = bot.queue.next();
    if (next) {
      if (next.streamUrl) {
        await bot.playStream(next);
      } else {
        await bot.play(next);
      }
      this.reply(bot, userClid, `Skipped to: ${next.title}`);
    } else {
      bot.stopAudio();
      this.reply(bot, userClid, 'Queue empty — playback stopped.');
    }
  }

  private async handlePrev(bot: VoiceBot, userClid: number): Promise<void> {
    const prev = bot.queue.previous();
    if (prev) {
      if (prev.streamUrl) {
        await bot.playStream(prev);
      } else {
        await bot.play(prev);
      }
      this.reply(bot, userClid, `Previous: ${prev.title}`);
    } else {
      this.reply(bot, userClid, 'No previous track.');
    }
  }

  private handleVolume(bot: VoiceBot, userClid: number, args: string): void {
    if (!args) {
      const vol = bot.currentConfig.volume;
      this.reply(bot, userClid, `Volume: ${vol}%`);
      return;
    }

    const vol = parseInt(args);
    if (isNaN(vol) || vol < 0 || vol > 100) {
      this.reply(bot, userClid, 'Usage: !vol <0-100>');
      return;
    }

    bot.setVolume(vol);
    this.reply(bot, userClid, `Volume set to ${vol}%.`);
  }

  private handleNowPlaying(bot: VoiceBot, userClid: number): void {
    const np = bot.nowPlaying;
    if (!np) {
      this.reply(bot, userClid, 'Nothing is playing.');
      return;
    }

    const artist = np.artist ? `${np.artist} - ` : '';
    this.reply(bot, userClid, `Now playing: ${artist}${np.title}`);
  }

  // ─── Video Streaming Commands ─────────────────────────────

  private async handleStream(bot: VoiceBot, userClid: number, args: string): Promise<void> {
    if (!args) {
      this.reply(bot, userClid, 'Usage: !stream <url or search terms> [preset]  — Presets: 480p, 720p, 1080p');
      return;
    }

    // A URL is always one token; search terms can be several words, so only
    // the LAST word can be an optional preset suffix - and only if it's
    // actually a known preset, otherwise it's just part of the query (e.g.
    // a single-word search isn't mistaken for "no query, just a preset").
    const words = args.split(/\s+/);
    const lastWord = words[words.length - 1];
    const hasPreset = words.length > 1 && lastWord in STREAM_PRESETS;
    const preset = hasPreset ? lastWord : undefined;
    const query = hasPreset ? words.slice(0, -1).join(' ') : args;
    const source = toYtDlpSource(query);

    if (bot.videoStreaming) {
      // Change source if already streaming
      try {
        await bot.setVideoSource(source);
        this.reply(bot, userClid, `Stream source changed to: ${query}`);
      } catch (err: any) {
        this.reply(bot, userClid, `Error: ${err.message}`);
      }
      return;
    }

    this.reply(bot, userClid, 'Starting video stream...');
    try {
      await bot.startVideoStream(source, preset);
      this.reply(bot, userClid, `Video stream started: ${query}`);
    } catch (err: any) {
      this.reply(bot, userClid, `Failed to start stream: ${err.message}`);
    }
  }

  private async handleStopStream(bot: VoiceBot, userClid: number): Promise<void> {
    if (!bot.videoStreaming) {
      this.reply(bot, userClid, 'No active video stream.');
      return;
    }
    await bot.stopVideoStream();
    this.reply(bot, userClid, 'Video stream stopped.');
  }

  private handleViewers(bot: VoiceBot, userClid: number): void {
    const status = bot.videoStreamStatus;
    if (!status.streaming) {
      this.reply(bot, userClid, 'No active video stream.');
      return;
    }
    if (status.viewers.length === 0) {
      this.reply(bot, userClid, 'No viewers connected.');
      return;
    }
    const lines = status.viewers.map((v) => {
      const duration = Math.floor((Date.now() - v.joinedAt) / 1000);
      return `  clid=${v.clid} (${duration}s)`;
    });
    this.reply(bot, userClid, `Viewers (${status.viewerCount}):\n${lines.join('\n')}`);
  }

  private saveMusicRequest(bot: VoiceBot, item: QueueItem): void {
    if (!item.sourceUrl || !bot.currentConfig.serverConfigId) return;
    this.prisma.musicRequest.upsert({
      where: {
        serverConfigId_url: {
          serverConfigId: bot.currentConfig.serverConfigId,
          url: item.sourceUrl,
        },
      },
      update: {
        requestedAt: new Date(),
        title: item.title || 'Unknown Title',
      },
      create: {
        serverConfigId: bot.currentConfig.serverConfigId,
        url: item.sourceUrl,
        title: item.title || 'Unknown Title',
        requestedAt: new Date(),
      },
    }).catch((err) => {
      console.error('[MusicCmd] Failed to save music request history:', err.message);
    });
  }
}
