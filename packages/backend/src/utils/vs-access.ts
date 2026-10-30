import type { PrismaClient } from '../generated/prisma/client.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';

/**
 * Access per virtual server (R8). A non-admin's grant on a server connection lists the virtual
 * servers it covers, one by one (`UserVirtualServerAccess`); a virtual server added to the
 * connection later is not covered until an admin ticks it. `allVirtualServers` covers every one:
 * it is set for a connection without WebQuery (no server list to pick from) and, until it has been
 * narrowed below, for a grant made before access per virtual server existed.
 *
 * Music bots have no virtual server of their own; they belong to the one whose voice port they
 * connect to, looked up in the connection's server list.
 */

export interface Grant {
  all: boolean;
  sids: Set<number>;
}

export async function grantOf(prisma: PrismaClient, userId: number, serverConfigId: number): Promise<Grant | null> {
  const row = await prisma.userServerAccess.findUnique({
    where: { userId_serverConfigId: { userId, serverConfigId } },
    select: { allVirtualServers: true, virtualServers: { select: { sid: true } } },
  });
  return row ? { all: row.allVirtualServers, sids: new Set(row.virtualServers.map((v) => v.sid)) } : null;
}

export const grantCovers = (grant: Grant | null, sid: number): boolean => !!grant && (grant.all || grant.sids.has(sid));

// --- voice port -> virtual server, per connection -----------------------------------------------
const PORT_MAP_TTL_MS = 60_000;
const portMaps = new Map<number, { at: number; bySidPort: Map<number, number> }>();

type ServerListRow = { virtualserver_id?: unknown; virtualserver_port?: unknown };
async function serverList(pool: ConnectionPool, serverConfigId: number): Promise<ServerListRow[] | null> {
  const client = pool.tryGetClient(serverConfigId);
  if (!client) return null;
  const list = await client.execute(0, 'serverlist');
  return Array.isArray(list) ? list as ServerListRow[] : [];
}

/** The connection's voice port -> sid map (cached for a minute), or null without WebQuery. */
export async function virtualServerPorts(pool: ConnectionPool, serverConfigId: number): Promise<Map<number, number> | null> {
  const cached = portMaps.get(serverConfigId);
  if (cached && Date.now() - cached.at < PORT_MAP_TTL_MS) return cached.bySidPort;
  const list = await serverList(pool, serverConfigId);
  if (!list) return null;
  const bySidPort = new Map(list.map((s) => [Number(s.virtualserver_port), Number(s.virtualserver_id)] as [number, number]));
  portMaps.set(serverConfigId, { at: Date.now(), bySidPort });
  return bySidPort;
}

/** The last known virtual server for a voice port, without asking TeamSpeak (for WebSocket events). */
export const cachedSidOfPort = (serverConfigId: number, voicePort: number): number | undefined =>
  portMaps.get(serverConfigId)?.bySidPort.get(voicePort);

/** Whether a non-admin may use a music bot: their grant must cover the virtual server of its voice port. */
export async function mayUseMusicBot(
  prisma: PrismaClient, pool: ConnectionPool, userId: number, bot: { serverConfigId: number; voicePort: number },
): Promise<boolean> {
  const grant = await grantOf(prisma, userId, bot.serverConfigId);
  if (!grant) return false;
  if (grant.all) return true;
  // Fails closed: without the server list the bot's virtual server is unknown.
  const ports = await virtualServerPorts(pool, bot.serverConfigId).catch(() => null);
  const sid = ports?.get(bot.voicePort);
  return sid !== undefined && grant.sids.has(sid);
}

// --- narrowing grants from before per-virtual-server access -------------------------------------

/**
 * Turns every grant still covering "all virtual servers" on a connection with WebQuery into one
 * row per virtual server the connection has right now. A connection whose list cannot be read
 * (no WebQuery, not reachable) keeps its grants as they are and is tried again later.
 */
export async function narrowGrants(prisma: PrismaClient, pool: ConnectionPool): Promise<number> {
  const open = await prisma.userServerAccess.findMany({ where: { allVirtualServers: true }, select: { id: true, serverConfigId: true } });
  let narrowed = 0;
  for (const serverConfigId of new Set(open.map((g) => g.serverConfigId))) {
    const list = await serverList(pool, serverConfigId).catch(() => null);
    if (!list || list.length === 0) continue;
    const sids = list.map((s) => Number(s.virtualserver_id)).filter((n) => Number.isInteger(n) && n > 0);
    const ids = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: an admin may have saved this grant while the list was read.
      const still = (await tx.userServerAccess.findMany({ where: { serverConfigId, allVirtualServers: true }, select: { id: true } })).map((g) => g.id);
      await tx.userVirtualServerAccess.deleteMany({ where: { accessId: { in: still } } });
      await tx.userVirtualServerAccess.createMany({ data: still.flatMap((accessId) => sids.map((sid) => ({ accessId, sid }))) });
      await tx.userServerAccess.updateMany({ where: { id: { in: still } }, data: { allVirtualServers: false } });
      return still;
    });
    if (ids.length === 0) continue;
    narrowed += ids.length;
    console.log(`[VsAccess] ${ids.length} grant(s) on connection ${serverConfigId} now name virtual server(s) ${sids.join(', ')}`);
  }
  return narrowed;
}

const NARROW_FIRST_MS = 20_000;
const NARROW_EVERY_MS = 10 * 60_000;

/**
 * Narrows open grants shortly after start (the connections need a moment) and every 10 minutes, and
 * refreshes the voice port map of every connection then, so music bot events can name their
 * virtual server (cachedSidOfPort) without a lookup of their own.
 */
export function startGrantNarrowing(prisma: PrismaClient, pool: ConnectionPool): { stop: () => void } {
  const run = async () => {
    await narrowGrants(prisma, pool).catch((err) => console.error(`[VsAccess] Narrowing grants failed: ${err.message}`));
    for (const { id } of await prisma.tsServerConfig.findMany({ select: { id: true } }).catch(() => [])) {
      portMaps.delete(id);
      await virtualServerPorts(pool, id).catch(() => null);
    }
  };
  const first = setTimeout(run, NARROW_FIRST_MS);
  const timer = setInterval(run, NARROW_EVERY_MS);
  first.unref?.();
  timer.unref?.();
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}
