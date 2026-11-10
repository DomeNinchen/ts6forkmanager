import { Router, Request, Response } from 'express';
import {
  SUPPORT_OPEN_STATES,
  SUPPORT_QUEUE_DEFAULTS,
  SUPPORT_RETENTION_MAX_DAYS,
  supportRoomName,
  supportSettingsProblem,
  type SupportQueueConflict,
  type SupportQueueSettings,
  type SupportQueueView,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { requirePermission, requireRole } from '../middleware/rbac.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import { targetIds } from '../utils/protected-groups.js';
import { mayRole } from '../utils/role-table.js';
import { acquireChannelCreateLock, clientMoveTolerating770 } from '../utils/channel-create-lock.js';
import {
  closeOpenCases, emitCaseTaken, getQueueStatus, isAvailableSupporter, orderOpenCases, parseClientList, parseSettings,
  resetQueueState, toCaseEntry, toQueueConfig,
} from '../utils/support-queue.js';

// Support queue (R14): view with server.view (the same as the client list), act with clients.move,
// set up as admin only (his decision 7).
export const supportQueueRoutes: Router = Router({ mergeParams: true });

const HISTORY_MAX = 500;
// shortcut: statistics are computed on the page from at most this many cases; move them into SQL if a queue ever has more in 90 days.
const STATS_MAX = 20_000;
const OPEN = [...SUPPORT_OPEN_STATES];

/** Which web user acted is for those who may act themselves; read-only viewers get the case without it. */
function forViewer<T extends { actedBy: string | null }>(req: Request, entry: T): T {
  return req.user?.role === 'admin' || mayRole(req.user?.role, 'clients.move') ? entry : { ...entry, actedBy: null };
}

function scope(req: Request) {
  return {
    prisma: req.app.locals.prisma as PrismaClient,
    pool: req.app.locals.connectionPool as ConnectionPool,
    serverConfigId: parseInt(String(req.params.configId)),
    sid: parseInt(String(req.params.sid)),
  };
}

/** A queue of this virtual server by its id (stage 4: several per virtual server, one per waiting channel). */
async function queueOf(req: Request) {
  const { prisma, serverConfigId, sid } = scope(req);
  const [id] = targetIds([req.params.queueId], 'queueId');
  const row = await prisma.supportQueue.findFirst({ where: { id, serverConfigId, sid } });
  if (!row) throw new AppError(404, 'Support queue not found', undefined, 'QUEUE_NOT_FOUND');
  return row;
}

async function caseOf(req: Request) {
  const { prisma, serverConfigId, sid } = scope(req);
  const [id] = targetIds([req.params.id], 'id');
  const row = await prisma.supportCase.findFirst({ where: { id, queue: { serverConfigId, sid } }, include: { queue: true } });
  if (!row) throw new AppError(404, 'Support case not found');
  return row;
}

/**
 * Enabled flows on this virtual server that react to the same waiting channel: the Support System
 * template pointed at it, or a client-move/enter trigger whose flow compares ctid with it.
 * shortcut: a text match on the flow JSON (conditions and filters), not an evaluation of the flow; enough to warn, not to block.
 */
export async function findQueueConflicts(prisma: PrismaClient, serverConfigId: number, sid: number, channelId: number): Promise<SupportQueueConflict[]> {
  if (!channelId) return [];
  const flows = await prisma.botFlow.findMany({ where: { serverConfigId, virtualServerId: sid, enabled: true }, select: { id: true, name: true, flowData: true } });
  const ctid = new RegExp(`ctid[^0-9]{0,40}?\\b${channelId}\\b`);
  return flows
    .filter((f) => {
      let data: any;
      try { data = JSON.parse(f.flowData); } catch { return false; }
      if (data?.template?.id === 'support-system' && Number(data.template.config?.supportChannelId) === channelId) return true;
      const listens = (data?.nodes ?? []).some((n: any) => n?.type === 'trigger_event' && ['notifyclientmoved', 'notifycliententerview'].includes(n?.data?.config?.eventName ?? n?.config?.eventName));
      return listens && ctid.test(f.flowData);
    })
    .map((f) => ({ flowId: f.id, name: f.name }));
}

// Every queue of the virtual server with its open cases, oldest queue first.
supportQueueRoutes.get('/queues', requirePermission('server.view'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const queues = await prisma.supportQueue.findMany({ where: { serverConfigId, sid }, orderBy: { id: 'asc' } });
    const rows = await prisma.supportCase.findMany({ where: { queueId: { in: queues.map((q) => q.id) }, state: { in: OPEN } } });
    const views: SupportQueueView[] = queues.map((q) => ({
      config: toQueueConfig(q),
      status: getQueueStatus(q.id),
      cases: orderOpenCases(rows.filter((r) => r.queueId === q.id)).map((e) => forViewer(req, e)),
    }));
    res.json(views);
  } catch (err) { next(err); }
});

// Ended cases, newest first: of one queue, or (/history) of every queue of the virtual server.
// ?days=N: every case that ended in the last N days (for the statistics, at most STATS_MAX).
async function history(req: Request, res: Response, next: (err?: unknown) => void) {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const days = req.query.days === undefined ? null : parseInt(String(req.query.days));
    if (days !== null && !(days >= 1 && days <= SUPPORT_RETENTION_MAX_DAYS)) throw new AppError(400, `days must be 1 to ${SUPPORT_RETENTION_MAX_DAYS}`);
    const limit = days !== null ? STATS_MAX : Math.min(Math.max(parseInt(String(req.query.limit ?? '100')) || 100, 1), HISTORY_MAX);
    const where = {
      ...(req.params.queueId !== undefined ? { queueId: (await queueOf(req)).id } : { queue: { serverConfigId, sid } }),
      state: { notIn: OPEN },
      ...(days !== null ? { endedAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {}),
    };
    const rows = await prisma.supportCase.findMany({ where, orderBy: { endedAt: 'desc' }, take: limit });
    res.json(rows.map((r) => forViewer(req, toCaseEntry(r))));
  } catch (err) { next(err); }
}
supportQueueRoutes.get('/history', requirePermission('server.view'), history);
supportQueueRoutes.get('/queues/:queueId/history', requirePermission('server.view'), history);

supportQueueRoutes.get('/queues/:queueId/config', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const config = toQueueConfig(await queueOf(req));
    res.json({ config, conflicts: await findQueueConflicts(prisma, serverConfigId, sid, config.channelId) });
  } catch (err) { next(err); }
});

/** The body of a create or save, checked: the waiting channel must exist and belong to no other queue. */
async function queueBody(req: Request, ownId: number | null) {
  const { prisma, pool, serverConfigId, sid } = scope(req);
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false');
  const [channelId] = targetIds([req.body?.channelId], 'channelId');
  const keys = Object.keys(SUPPORT_QUEUE_DEFAULTS) as (keyof SupportQueueSettings)[];
  const settings = Object.fromEntries(keys.map((k) => [k, req.body?.settings?.[k]])) as unknown as SupportQueueSettings;
  const problem = supportSettingsProblem(settings);
  if (problem) throw new AppError(400, problem);
  const taken = await prisma.supportQueue.findFirst({ where: { serverConfigId, sid, channelId, ...(ownId !== null ? { id: { not: ownId } } : {}) } });
  if (taken) throw new AppError(409, 'This channel is already the waiting channel of another queue', parseSettings(taken.settings).name, 'CHANNEL_IN_USE');
  try {
    await pool.getClient(serverConfigId).execute(sid, 'channelinfo', { cid: channelId });
  } catch (err) {
    if (err instanceof TSApiError && err.code === 768) throw new AppError(400, 'No channel with this id', undefined, 'CHANNEL_NOT_FOUND');
    throw err;
  }
  return { enabled, channelId, settings: JSON.stringify(settings) };
}

/** The unique (connection, virtual server, channel) index can still refuse when two saves race. */
function channelRace(err: unknown): never {
  if ((err as { code?: string })?.code === 'P2002') throw new AppError(409, 'This channel is already the waiting channel of another queue', undefined, 'CHANNEL_IN_USE');
  throw err;
}

supportQueueRoutes.post('/queues', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const data = await queueBody(req, null);
    const row = await prisma.supportQueue.create({ data: { serverConfigId, sid, ...data } }).catch(channelRace);
    res.status(201).json({ config: toQueueConfig(row), conflicts: await findQueueConflicts(prisma, serverConfigId, sid, row.channelId) });
  } catch (err) { next(err); }
});

supportQueueRoutes.put('/queues/:queueId/config', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const existing = await queueOf(req);
    const data = await queueBody(req, existing.id);
    const row = await prisma.supportQueue.update({ where: { id: existing.id }, data }).catch(channelRace);
    // Switched off or moved to another channel: what was open belongs to the old setup.
    if (existing.channelId !== row.channelId || (existing.enabled && !row.enabled)) await closeOpenCases(prisma, row.id);
    if (existing.channelId !== row.channelId || existing.enabled !== row.enabled) resetQueueState(row.id);
    res.json({ config: toQueueConfig(row), conflicts: await findQueueConflicts(prisma, serverConfigId, sid, row.channelId) });
  } catch (err) { next(err); }
});

// Deletes a queue with its cases, open and ended (his choice: the history goes with it).
supportQueueRoutes.delete('/queues/:queueId', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { prisma } = scope(req);
    const row = await queueOf(req);
    await prisma.supportQueue.delete({ where: { id: row.id } });
    resetQueueState(row.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

/** The client of a case and the online supporters right now. */
async function lookUp(pool: ConnectionPool, serverConfigId: number, sid: number, uid: string, channelId: number) {
  const clients = parseClientList(await pool.getClient(serverConfigId).execute(sid, 'clientlist', { '-uid': '', '-away': '', '-groups': '' }));
  const mine = clients.filter((c) => c.uid === uid);
  return { clients, client: mine.find((c) => c.cid === channelId) ?? mine[0] ?? null };
}

/**
 * Moves the query client out of the room it was put into. Its old channel may be gone by now (a temporary
 * one empties when it leaves it): then the default channel. Never fails the take - client and supporter
 * are already in the room by then.
 */
async function leaveRoom(q: ReturnType<ConnectionPool['getBotClient']>, sid: number, clid: string, home: string): Promise<void> {
  try {
    await clientMoveTolerating770(q, sid, clid, home);
  } catch (err) {
    try {
      const channels = await q.execute(sid, 'channellist', { '-flags': '' }) as Array<Record<string, unknown>>;
      const fallback = channels.find((c) => String(c.channel_flag_default) === '1');
      if (!fallback) throw err;
      await clientMoveTolerating770(q, sid, clid, String(fallback.cid));
    } catch (err2: any) {
      console.warn(`[SupportQueue] Could not move the query client out of the support room: ${err2?.message ?? err2}`);
    }
  }
}

// A supporter takes a waiting case: a room is created and both are moved into it (his decisions 2b and 3).
// Body: { supporterClid }.
supportQueueRoutes.post('/cases/:id/take', requirePermission('clients.move'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, pool, serverConfigId, sid } = scope(req);
    const row = await caseOf(req);
    if (row.state !== 'waiting') throw new AppError(409, 'This case is no longer waiting', undefined, 'CASE_NOT_WAITING');
    const [supporterClid] = targetIds([req.body?.supporterClid], 'supporterClid');
    const settings = parseSettings(row.queue.settings);
    const { clients, client } = await lookUp(pool, serverConfigId, sid, row.clientUid, row.queue.channelId);
    if (!client) throw new AppError(409, 'The client is not online', undefined, 'CLIENT_OFFLINE');
    const supporter = clients.find((c) => c.clid === supporterClid);
    if (!supporter || !isAvailableSupporter(supporter, settings)) {
      throw new AppError(400, 'This client is not an available supporter (in a supporter group, not away, not in an AFK channel)', undefined, 'NOT_A_SUPPORTER');
    }

    // Taken first, so the job does not see the moves below as something of its own; undone if they fail.
    const takenBy = JSON.stringify([{ uid: supporter.uid, nickname: supporter.nickname, cldbid: supporter.cldbid }]);
    const actedBy = req.user?.username ?? 'unknown';
    const { count } = await prisma.supportCase.updateMany({
      where: { id: row.id, state: 'waiting' },
      data: { state: 'in-progress', takenAt: new Date(), takenBy, takenVia: 'web', actedBy, absentSince: null },
    });
    if (count === 0) throw new AppError(409, 'This case is no longer waiting', undefined, 'CASE_NOT_WAITING');

    // Rooms and moves go out under the bot identity when there is one (his decision 14).
    const q = pool.getBotClient(serverConfigId);
    const release = await acquireChannelCreateLock(`${serverConfigId}:${sid}`);
    let roomCid: number | null = null;
    let who: any;
    try {
      who = (await q.execute(sid, 'whoami'))?.[0];
      const params: Record<string, string> = { channel_name: supportRoomName(settings.roomName, client.nickname, supporter.nickname) };
      if (settings.roomType === 'permanent') params.channel_flag_permanent = '1';
      else if (settings.roomType === 'semipermanent') params.channel_flag_semi_permanent = '1';
      let created: any;
      try {
        created = await q.executePost(sid, 'channelcreate', params);
      } catch (err) {
        // 771: a channel of that name exists already (two cases of the same nickname) - the case id tells them apart.
        if (!(err instanceof TSApiError && err.code === 771)) throw err;
        params.channel_name = `${[...params.channel_name].slice(0, 32).join('')} #${row.id}`;
        created = await q.executePost(sid, 'channelcreate', params);
      }
      // TS6 sometimes answers channelcreate with a bare "ok": no cid, and the query client is not moved in
      // (measured 2026-11-10; the NaN cid then gave 1540 convert error). The name was free (else 771), so it finds the room.
      roomCid = Number(created?.[0]?.cid) || null;
      if (!roomCid) {
        const channels = await q.execute(sid, 'channellist', {}) as Array<Record<string, unknown>>;
        roomCid = Number(channels.find((c) => c.channel_name === params.channel_name && String(c.pid) === '0')?.cid) || null;
        if (!roomCid) throw new AppError(502, 'TeamSpeak did not say which channel it created for the support room');
      }
      // TeamSpeak put the query client into the room; while it sits there a temporary room never empties.
      await clientMoveTolerating770(q, sid, String(client.clid), String(roomCid));
      await clientMoveTolerating770(q, sid, String(supporter.clid), String(roomCid));
      if (who?.client_id && who.client_channel_id !== undefined) await leaveRoom(q, sid, String(who.client_id), String(who.client_channel_id));
    } catch (err) {
      // A move failed after the room was made: the query client still sits in it, and a temporary room would never empty.
      if (roomCid && who?.client_id && who.client_channel_id !== undefined) await leaveRoom(q, sid, String(who.client_id), String(who.client_channel_id));
      await prisma.supportCase.updateMany({ where: { id: row.id, state: 'in-progress' }, data: { state: 'waiting', takenAt: null, takenBy: null, takenVia: null, actedBy: null, roomCid } });
      throw err;
    } finally {
      release();
    }
    const done = await prisma.supportCase.update({ where: { id: row.id }, data: { roomCid } });
    emitCaseTaken(row.queue, done, client.clid);
    res.json(toCaseEntry(done));
  } catch (err) { next(err); }
});

// Removes a waiting client from the queue and moves them to the server's default channel; while they
// stayed in the waiting channel the next look would queue them again.
supportQueueRoutes.post('/cases/:id/remove', requirePermission('clients.move'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, pool, serverConfigId, sid } = scope(req);
    const row = await caseOf(req);
    const { count } = await prisma.supportCase.updateMany({
      where: { id: row.id, state: 'waiting' },
      data: { state: 'cancelled', endedAt: new Date(), endReason: 'removed', actedBy: req.user?.username ?? 'unknown' },
    });
    if (count === 0) throw new AppError(409, 'This case is no longer waiting', undefined, 'CASE_NOT_WAITING');
    const { client } = await lookUp(pool, serverConfigId, sid, row.clientUid, row.queue.channelId);
    if (client && client.cid === row.queue.channelId) {
      const q = pool.getBotClient(serverConfigId);
      const channels = await q.execute(sid, 'channellist', { '-flags': '' }) as Array<Record<string, unknown>>;
      const home = channels.find((c) => String(c.channel_flag_default) === '1');
      if (home && Number(home.cid) !== row.queue.channelId) await clientMoveTolerating770(q, sid, String(client.clid), String(home.cid));
    }
    res.json(toCaseEntry((await prisma.supportCase.findUniqueOrThrow({ where: { id: row.id } }))));
  } catch (err) { next(err); }
});

// Marks a taken case as done (for one the job cannot end by itself, e.g. client and supporter stay together).
supportQueueRoutes.post('/cases/:id/close', requirePermission('clients.move'), async (req: Request, res: Response, next) => {
  try {
    const { prisma } = scope(req);
    const row = await caseOf(req);
    const { count } = await prisma.supportCase.updateMany({
      where: { id: row.id, state: 'in-progress' },
      data: { state: 'done', endedAt: new Date(), endReason: 'closed', actedBy: req.user?.username ?? 'unknown' },
    });
    if (count === 0) throw new AppError(409, 'This case is not in progress', undefined, 'CASE_NOT_IN_PROGRESS');
    res.json(toCaseEntry((await prisma.supportCase.findUniqueOrThrow({ where: { id: row.id } }))));
  } catch (err) { next(err); }
});
