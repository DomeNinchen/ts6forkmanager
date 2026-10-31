import type { Request } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { WebQueryClient } from '../ts-client/webquery-client.js';
import { AppError } from '../middleware/error-handler.js';

/**
 * Protected server groups (R8): a client in one of them cannot be kicked, banned or moved by
 * a web user who is not an admin. Every such action goes through the connection's own query
 * login, so TeamSpeak's own "needed power" never sees the web user - this check is the only
 * thing that stops a moderator from removing an admin.
 *
 * It fails closed: if the target's groups cannot be read, the action is refused.
 */

/** Machine-readable reason the frontend translates; `details` carries the protected nicknames. */
export const PROTECTED_TARGET = 'PROTECTED_TARGET';

export async function protectedGroupIds(prisma: PrismaClient, serverConfigId: number, sid: number): Promise<Set<number>> {
  const rows = await prisma.protectedServerGroup.findMany({ where: { serverConfigId, sid }, select: { sgid: true } });
  return new Set(rows.map((r) => r.sgid));
}

/** '6,8' / 6 / ['6'] -> [6, 8]; anything that is not a plain group id is dropped. */
function groupIds(value: unknown): number[] {
  return String(value ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

/** Positive whole numbers only - anything else would let one request name targets the check never saw. */
export function targetIds(values: unknown[], label: string): number[] {
  const ids = values.map((v) => (typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : NaN));
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new AppError(400, `${label} must be positive whole numbers`);
  return ids;
}

function refuse(names: string[]): never {
  throw new AppError(403, 'Target is in a protected server group', names.join(', '), PROTECTED_TARGET);
}

function context(req: Request) {
  return {
    prisma: req.app.locals.prisma as PrismaClient,
    configId: parseInt(String(req.params.configId)),
    sid: parseInt(String(req.params.sid)),
  };
}

/** Refuses (403) if a connected client among `clids` is in a protected group and the caller is not an admin. */
export async function assertClientsNotProtected(req: Request, client: WebQueryClient, clids: number[]): Promise<void> {
  if (req.user?.role === 'admin') return;
  const { prisma, configId, sid } = context(req);
  const protectedIds = await protectedGroupIds(prisma, configId, sid);
  if (protectedIds.size === 0) return;
  const list = await client.execute(sid, 'clientlist', { '-groups': '' }) as Array<Record<string, unknown>>;
  const byClid = new Map((Array.isArray(list) ? list : []).map((c) => [Number(c.clid), c]));
  const hit = clids
    .map((clid) => byClid.get(clid))
    // A clid the server does not know is no client to protect; TeamSpeak refuses the action itself.
    .filter((c): c is Record<string, unknown> => !!c && groupIds(c.client_servergroups).some((g) => protectedIds.has(g)));
  if (hit.length) refuse(hit.map((c) => String(c.client_nickname ?? c.clid)));
}

/** For a bulk action: the clids among the listed clients that are protected for this caller (none for an admin). */
export async function protectedAmong(req: Request, clients: Array<Record<string, unknown>>): Promise<Set<number>> {
  if (req.user?.role === 'admin') return new Set();
  const { prisma, configId, sid } = context(req);
  const protectedIds = await protectedGroupIds(prisma, configId, sid);
  return new Set(clients
    .filter((c) => groupIds(c.client_servergroups).some((g) => protectedIds.has(g)))
    .map((c) => Number(c.clid)));
}

/** The same for client database profiles (offline clients), by database id. */
export async function assertProfilesNotProtected(req: Request, client: WebQueryClient, cldbids: number[]): Promise<void> {
  if (req.user?.role === 'admin') return;
  const { prisma, configId, sid } = context(req);
  const protectedIds = await protectedGroupIds(prisma, configId, sid);
  if (protectedIds.size === 0) return;
  const hit: string[] = [];
  for (const cldbid of cldbids) {
    const groups = await client.execute(sid, 'servergroupsbyclientid', { cldbid: String(cldbid) }) as Array<Record<string, unknown>>;
    if ((Array.isArray(groups) ? groups : []).some((g) => protectedIds.has(Number(g.sgid)))) hit.push(`#${cldbid}`);
  }
  if (hit.length) refuse(hit);
}
