import type { IncomingMessage } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import { roleHasPermission, type UserPermission, type UserRole } from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { cachedSidOfPort, grantCovers, type Grant } from './vs-access.js';

/**
 * Who a WebSocket event is for.
 *
 * Every socket belongs to a signed-in user, and an event used to go to all of them whatever
 * their role or server access. Now an event names its audience: an admin always receives it;
 * any other role only if it holds `permission` AND the user has been granted the server
 * connection - and virtual server - the event is about (utils/vs-access.ts). An event without a
 * `serverConfigId` or `permission` is for admins only, and one whose virtual server is not known
 * reaches only grants covering every virtual server of the connection. A socket whose user is not
 * known yet (or no longer) receives nothing: this fails closed.
 */
export interface Audience {
  permission?: UserPermission;
  serverConfigId?: number;
  sid?: number;
}

/** Music bot events: whoever runs the Music Bots page, on the bot's server connection and virtual server (from its voice port). */
export const musicAudience = (serverConfigId: number | undefined, voicePort: number | undefined): Audience => ({
  permission: 'music.manage', serverConfigId,
  sid: serverConfigId !== undefined && voicePort !== undefined ? cachedSidOfPort(serverConfigId, voicePort) : undefined,
});
/** Bot flow events: whoever runs the Bot Flows editor, on the flow's own server connection and virtual server. */
export const botFlowAudience = (serverConfigId: number | undefined, sid: number | undefined): Audience => ({ permission: 'bots.manage', serverConfigId, sid });
/** Instance-wide events (the flow engine starting or stopping): admins only. */
export const instanceAudience: Audience = {};

/** The upgrade request, tagged by the JWT check in index.ts with the user the token belongs to. */
export type UpgradeRequest = IncomingMessage & { wsUserId?: number };

interface SocketUser {
  userId: number;
  role: UserRole;
  /** The server connections a non-admin has been granted, with the virtual servers each grant covers. */
  access: Map<number, Grant>;
}

const users = new WeakMap<WebSocket, SocketUser>();

/** How long a change of someone's role or server access can take to reach a socket that is already open. */
const REFRESH_EVERY_MS = 30_000;

export function mayReceive(socket: WebSocket, audience: Audience): boolean {
  const user = users.get(socket);
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (audience.serverConfigId === undefined || !audience.permission) return false;
  if (!roleHasPermission(user.role, audience.permission)) return false;
  const grant = user.access.get(audience.serverConfigId);
  if (!grant) return false;
  return audience.sid === undefined ? grant.all : grantCovers(grant, audience.sid);
}

/** Sends the event to the sockets whose user may receive it. */
export function sendToAudience(wss: WebSocketServer, type: string, payload: object, audience: Audience): void {
  const message = JSON.stringify({ type, ...payload });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* WebSocket.OPEN */ && mayReceive(client, audience)) client.send(message);
  }
}

/**
 * Looks up who each connecting socket is and keeps it current: role and server access are read
 * from the database when the socket connects and again every 30 seconds, and the socket of an
 * account that was disabled or deleted in the meantime is closed.
 */
export function attachWsAudience(wss: WebSocketServer, prisma: PrismaClient): { stop: () => void } {
  const load = async (sockets: Map<WebSocket, number>): Promise<void> => {
    if (sockets.size === 0) return;
    const ids = [...new Set(sockets.values())];
    const [accounts, grants] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true, enabled: true } }),
      prisma.userServerAccess.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, serverConfigId: true, allVirtualServers: true, virtualServers: { select: { sid: true } } },
      }),
    ]);
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    for (const [socket, userId] of sockets) {
      const account = accountById.get(userId);
      if (!account || !account.enabled) {
        users.delete(socket);
        socket.close(1008, 'Account disabled or deleted');
        continue;
      }
      users.set(socket, {
        userId,
        role: account.role as UserRole,
        access: new Map(grants.filter((g) => g.userId === userId).map((g) => [
          g.serverConfigId,
          { all: g.allVirtualServers, sids: new Set(g.virtualServers.map((v) => v.sid)) },
        ])),
      });
    }
  };

  wss.on('connection', (socket, req) => {
    const userId = (req as UpgradeRequest).wsUserId;
    if (userId === undefined) {
      socket.close(1008, 'Unknown user');
      return;
    }
    load(new Map([[socket, userId]])).catch((err) => {
      console.error(`[WsAudience] Could not look up the user of a new socket: ${err.message}`);
      socket.close(1011, 'Internal error');
    });
  });

  const timer = setInterval(() => {
    const open = new Map<WebSocket, number>();
    for (const client of wss.clients) {
      const user = users.get(client);
      if (user && client.readyState === 1) open.set(client, user.userId);
    }
    load(open).catch((err) => console.error(`[WsAudience] Refresh failed: ${err.message}`));
  }, REFRESH_EVERY_MS);
  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}
