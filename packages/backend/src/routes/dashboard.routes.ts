import { Router, Request, Response } from 'express';
import { AppError } from '../middleware/error-handler.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { BandwidthSampler } from '../ts-client/bandwidth-sampler.js';
import type { UserHistorySampler } from '../ts-client/user-history-sampler.js';
import type { VoiceBotManager } from '../voice/voice-bot-manager.js';
import { ONLINE_COUNT_SCOPES, type OnlineCountScope } from '@ts6/common';
import { countOnline, filterNeedsDetails, getOnlineCountFilter, parseOnlineCountFilter, setOnlineCountFilter } from '../utils/online-count.js';
import { widgetDataCache } from './widget-public.routes.js';

export const dashboardRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};

dashboardRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const configId = parseInt(String(req.params.configId));
    const sid = parseInt(String(req.params.sid));
    const client = getClient(req);

    const sampler: BandwidthSampler = req.app.locals.bandwidthSampler;
    sampler.ensureSampling(configId, sid);

    const prisma = req.app.locals.prisma;
    const filter = await getOnlineCountFilter(prisma, configId, sid, 'dashboard');
    const [serverInfo, clientList, channelList, connectionInfo, serverConfig] = await Promise.all([
      client.execute(sid, 'serverinfo'),
      // Groups and unique IDs only when the admin's filter needs them.
      client.execute(sid, 'clientlist', filterNeedsDetails(filter) ? { '-groups': '', '-uid': '' } : undefined),
      client.execute(sid, 'channellist'),
      client.execute(sid, 'serverrequestconnectioninfo'),
      prisma.tsServerConfig.findUnique({ where: { id: configId } }),
    ]);

    const info = Array.isArray(serverInfo) ? serverInfo[0] : serverInfo;
    const connInfo = Array.isArray(connectionInfo) ? connectionInfo[0] : connectionInfo;
    const clients = Array.isArray(clientList) ? clientList : [];
    const channels = Array.isArray(channelList) ? channelList : [];

    const onlineClients = clients.filter((c: any) => String(c.client_type) === '0');
    // Ping is real network reachability of this server's own host (timed TCP
    // connect, see BandwidthSampler.tcpPing) - not TeamSpeak's own
    // virtualserver_total_ping, which averages currently connected clients
    // and reads as a meaningless 0 whenever nobody's online. Reuses the
    // sampler's newest measurement instead of timing a second, redundant
    // connect here, so the headline number always matches the history chart.
    const latestSample = await sampler.getLatest(configId, sid);
    const latestPing = latestSample?.ping ?? -1;

    res.json({
      serverName: info.virtualserver_name,
      platform: info.virtualserver_platform,
      version: info.virtualserver_version,
      // The admin-set filter applies to the headline number only; slots stay occupied by whoever
      // is connected, so the capacity figure counts everyone.
      onlineUsers: countOnline(clients, filter, (req.app.locals.voiceBotManager as VoiceBotManager).ownIdentityUids()),
      slotsUsed: onlineClients.length,
      maxClients: Number(info.virtualserver_maxclients) || 0,
      uptime: Number(info.virtualserver_uptime) || 0,
      channelCount: channels.length,
      bandwidth: {
        incoming: Number(connInfo.connection_bandwidth_received_last_second_total) || 0,
        outgoing: Number(connInfo.connection_bandwidth_sent_last_second_total) || 0,
      },
      ping: latestPing,
      pingTarget: (serverConfig?.pingHost || serverConfig?.host) ?? null,
    });
  } catch (err) { next(err); }
});

// GET /bandwidth-history — the last 20 minutes, measured continuously since
// the backend started and stored in the database, so a fresh page load (or the
// first load after a deployment) has a full window to show instead of an empty
// chart that only fills in while someone watches it. This is the charts' only
// data source; the frontend does not append points of its own.
dashboardRoutes.get('/bandwidth-history', async (req: Request, res: Response, next) => {
  try {
    const configId = parseInt(String(req.params.configId));
    const sid = parseInt(String(req.params.sid));
    const sampler: BandwidthSampler = req.app.locals.bandwidthSampler;
    res.json(await sampler.getHistory(configId, sid));
  } catch (err) { next(err); }
});

// GET /user-history — the last 24 hours of the recorded user count, for the
// dashboard's history card. Open to every role with access to this server,
// like the rest of the dashboard (the live count is on this page already).
// Deliberately takes no range: the longer windows and the recording settings
// stay on the admin-only Statistics -> History tab.
dashboardRoutes.get('/user-history', async (req: Request, res: Response, next) => {
  try {
    const configId = parseInt(String(req.params.configId));
    const sid = parseInt(String(req.params.sid));
    if (!Number.isInteger(configId) || !Number.isInteger(sid)) {
      throw new AppError(400, 'Invalid server or virtual server id');
    }
    const sampler: UserHistorySampler = req.app.locals.userHistorySampler;
    const history = await sampler.getHistory(configId, sid, '24h');
    if (!history) throw new AppError(404, 'Server config not found');
    res.json(history);
  } catch (err) { next(err); }
});

function scopeOf(req: Request): OnlineCountScope {
  const scope = String(req.query.scope ?? '');
  if (!(ONLINE_COUNT_SCOPES as readonly string[]).includes(scope)) {
    throw new AppError(400, `scope must be one of: ${ONLINE_COUNT_SCOPES.join(', ')}`);
  }
  return scope as OnlineCountScope;
}

// GET /online-filter?scope=dashboard|widgets — which server groups (and whether this app's own
// music bots) the online-users number leaves out on this virtual server. Admin-only: the mount
// opens just the plain dashboard reads to the other roles.
dashboardRoutes.get('/online-filter', async (req: Request, res: Response, next) => {
  try {
    const configId = parseInt(String(req.params.configId));
    const sid = parseInt(String(req.params.sid));
    res.json(await getOnlineCountFilter(req.app.locals.prisma, configId, sid, scopeOf(req)));
  } catch (err) { next(err); }
});

// PUT /online-filter?scope=dashboard|widgets — replaces that filter.
dashboardRoutes.put('/online-filter', async (req: Request, res: Response, next) => {
  try {
    const configId = parseInt(String(req.params.configId));
    const sid = parseInt(String(req.params.sid));
    const scope = scopeOf(req);
    const filter = parseOnlineCountFilter(req.body);
    if (!filter) throw new AppError(400, 'Expected { excludedGroups: positive integer[], excludeMusicBots: boolean }');
    const saved = await setOnlineCountFilter(req.app.locals.prisma, configId, sid, scope, filter);
    // Embeds serve a cached copy for up to 45 s; drop it so the new count shows on the next load.
    if (scope === 'widgets') widgetDataCache.clear();
    res.json(saved);
  } catch (err) { next(err); }
});
