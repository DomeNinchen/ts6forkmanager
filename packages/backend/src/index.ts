import { createApp } from './app.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { PrismaClient } from './generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { ConnectionPool } from './ts-client/connection-pool.js';
import { BandwidthSampler } from './ts-client/bandwidth-sampler.js';
import { UserHistorySampler } from './ts-client/user-history-sampler.js';
import { ServerLifecycle } from './ts-client/server-lifecycle.js';
import { BotEngine } from './bot-engine/engine.js';
import { EventSessionManager } from './console/event-sessions.js';
import { VoiceBotManager } from './voice/voice-bot-manager.js';
import { MusicCommandHandler } from './voice/music-command-handler.js';
import { config } from './config.js';
import { setYtCookieFile } from './voice/audio/youtube.js';
import { sweepStreamTempFiles } from './voice/streaming/video-download.js';
import { loadDebugFlags } from './utils/debug-flags.js';
import { startScheduledRestartChecker } from './utils/scheduled-restart.js';
import { startUpdateChecker } from './utils/update-check.js';
import { scanMusicLibrary } from './voice/audio/music-library-scan.js';
import { startPlayedSongCleanup } from './voice/audio/played-song-cleanup.js';
import { startYtCookieChecker } from './utils/yt-cookie-check.js';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

async function main() {
  // C1: JWT secret startup guard
  if (config.jwtSecret === 'dev-secret-change-me-in-production') {
    if (config.nodeEnv === 'production') {
      console.error('[FATAL] JWT_SECRET is set to the default value. Set a secure JWT_SECRET environment variable before running in production.');
      process.exit(1);
    }
    console.warn('[WARN] JWT_SECRET is using the default development value. Set JWT_SECRET in production!');
  }

  // Configure yt-dlp cookie file: env var takes priority, then saved file from data dir
  const cookiePath = process.env.YT_COOKIE_FILE;
  const savedCookiePath = path.resolve('data', 'yt-cookies.txt');
  if (cookiePath && fs.existsSync(cookiePath)) {
    setYtCookieFile(cookiePath);
    console.log(`[yt-dlp] Using cookie file (env): ${cookiePath}`);
  } else if (fs.existsSync(savedCookiePath)) {
    setYtCookieFile(savedCookiePath);
    console.log(`[yt-dlp] Using saved cookie file: ${savedCookiePath}`);
  } else if (cookiePath) {
    console.warn(`[yt-dlp] Cookie file not found: ${cookiePath}`);
  }

  // Remove any pre-downloaded video temp files left over from a crash/restart
  sweepStreamTempFiles();

  const adapter = new PrismaBetterSqlite3({ url: config.databaseUrl });
  const prisma = new PrismaClient({ adapter });
  await loadDebugFlags(prisma);
  startScheduledRestartChecker(prisma);
  startUpdateChecker(prisma);
  startPlayedSongCleanup(prisma);
  startYtCookieChecker();

  // Pick up audio files already sitting in MUSIC_DIR (e.g. a volume shared
  // with another app) without requiring a manual scan first - see
  // clusterzx/ts6-manager#79. Best-effort: never blocks startup.
  try {
    const serverConfigs = await prisma.tsServerConfig.findMany({ select: { id: true } });
    let totalAdded = 0;
    for (const { id } of serverConfigs) {
      const { added } = await scanMusicLibrary(prisma, id);
      totalAdded += added;
    }
    if (totalAdded > 0) {
      console.log(`[MusicLibrary] Startup scan added ${totalAdded} track(s) found in MUSIC_DIR`);
    }
  } catch (err: any) {
    console.warn(`[MusicLibrary] Startup scan failed: ${err.message}`);
  }

  const app = createApp();
  const server = createServer(app);

  // Node's own request timeout (five minutes for a request to arrive in full) is
  // off: middleware/request-timeout.ts applies the same limit per request, and
  // lets an authenticated file upload from a slow line take longer. The header
  // timeout (60 s) still covers connections that never finish their headers.
  server.requestTimeout = 0;

  // H3: WebSocket with JWT authentication
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: ({ req }, done) => {
      try {
        const wsUrl = new URL(req.url!, `http://${req.headers.host}`);
        const token = wsUrl.searchParams.get('token');
        if (!token) return done(false, 401, 'Missing token');
        jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
        done(true);
      } catch {
        done(false, 401, 'Invalid token');
      }
    },
  });

  // Initialize TS connection pool
  const connectionPool = new ConnectionPool(prisma);
  await connectionPool.initialize();

  // Make services available via app.locals
  app.locals.prisma = prisma;
  app.locals.connectionPool = connectionPool;
  const bandwidthSampler = new BandwidthSampler(connectionPool, prisma);
  app.locals.bandwidthSampler = bandwidthSampler;
  const userHistorySampler = new UserHistorySampler(connectionPool, prisma);
  app.locals.userHistorySampler = userHistorySampler;
  // The long-term bandwidth and ping history is rolled up from the readings
  // BandwidthSampler already takes; wired before either sampler starts, so no
  // reading of the first pass is missed.
  bandwidthSampler.setMetricSink(userHistorySampler);
  app.locals.wss = wss;
  // The query console's live events: one shared SSH listener per virtual server, opened when an admin starts listening.
  const consoleEvents = new EventSessionManager(prisma, connectionPool);
  app.locals.consoleEvents = consoleEvents;

  // Initialize Bot Engine
  const botEngine = new BotEngine(prisma, connectionPool, wss, app);
  app.locals.botEngine = botEngine;
  await botEngine.start();

  // Initialize Voice Bot Manager (Music Bots)
  const voiceBotManager = new VoiceBotManager(prisma, wss, connectionPool);
  app.locals.voiceBotManager = voiceBotManager;
  await voiceBotManager.start();

  // One place that tells everything holding per-connection state (pool, flows,
  // SSH sessions, music bots, console listeners, samplers) when a server
  // connection is created, edited or deleted - so none of it needs a restart.
  app.locals.serverLifecycle = new ServerLifecycle({
    pool: connectionPool,
    botEngine,
    voiceBots: voiceBotManager,
    consoleEvents,
    bandwidthSampler,
  });

  // Wire VoiceBotManager into BotEngine for voice action nodes in flows
  botEngine.setVoiceBotManager(voiceBotManager);

  // Wire Music Command Handler for text-based music bot control (!radio, !play, etc.)
  // Listens directly on each VoiceBot's TS3 connection (no SSH needed)
  const musicCommandHandler = new MusicCommandHandler(prisma, voiceBotManager);
  voiceBotManager.setMusicCommandHandler(musicCommandHandler);

  // Start measuring bandwidth/ping for every running virtual server right
  // away, so the dashboard charts already have a full window of history the
  // first time anyone opens them. Deliberately not awaited: its first pass
  // talks to every configured TeamSpeak server, and an unreachable one would
  // otherwise hold up the HTTP listener. Failures are handled inside.
  void bandwidthSampler.start();

  // The long-term user-count history for Statistics -> History. Same reasoning
  // for not awaiting it: its first tick asks every configured server.
  void userHistorySampler.start();

  server.listen(config.port, () => {
    console.log(`[TS6 WebUI] Backend running on http://localhost:${config.port}`);
    console.log(`[TS6 WebUI] WebSocket available at ws://localhost:${config.port}/ws`);
    console.log(`[TS6 WebUI] Environment: ${config.nodeEnv}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[TS6 WebUI] Shutting down...');
    // Ends the streams and says `quit` to TeamSpeak for each listener, instead of dropping the connections.
    await consoleEvents.destroy();
    await voiceBotManager.stopAll();
    await botEngine.destroy();
    (app.locals.bandwidthSampler as BandwidthSampler).destroy();
    const history = app.locals.userHistorySampler as UserHistorySampler;
    history.destroy();
    // The bandwidth/ping windows still being filled are written out now;
    // after the database connection is closed there would be no way to.
    await history.flush();
    connectionPool.destroy();
    wss.close();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
