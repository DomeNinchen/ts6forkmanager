import { Router, Request, Response } from 'express';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { BandwidthSampler } from '../ts-client/bandwidth-sampler.js';

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
    const [serverInfo, clientList, channelList, connectionInfo, serverConfig] = await Promise.all([
      client.execute(sid, 'serverinfo'),
      client.execute(sid, 'clientlist'),
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
      onlineUsers: onlineClients.length,
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
