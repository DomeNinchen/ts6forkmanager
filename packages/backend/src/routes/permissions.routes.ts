import { Router, Request, Response } from 'express';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { evaluatePermissionAction, OVERVIEW_TIER_RANK, PERMISSION_ACTIONS, type PermissionAction } from '@ts6/common';

export const permissionRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};
const getSid = (req: Request) => parseInt(String(req.params.sid));

// The Permissions page is admin-only in the UI, so the whole router is - reads
// included (the permission overview of a client shows what they are allowed to do).
permissionRoutes.use(requirePermission('permissions.edit'));

permissionRoutes.get('/', async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'permissionlist')); } catch (err) { next(err); }
});

permissionRoutes.get('/find', async (req: Request, res: Response, next) => {
  try {
    const params: any = {};
    if (req.query.permid) params.permid = req.query.permid;
    if (req.query.permsid) params.permsid = req.query.permsid;
    res.json(await getClient(req).execute(getSid(req), 'permfind', params));
  } catch (err) {
    // permfind reports "invalid permission ID" (2562) both for a name that
    // doesn't exist and for a perfectly valid permission that simply isn't
    // assigned anywhere - confirmed live by removing a permission's last
    // assignment and watching this command start erroring. For a lookup
    // endpoint both mean the same thing, and returning the error instead
    // would leave the caller showing stale results from the previous search.
    if (err instanceof TSApiError && err.code === 2562) { res.json([]); return; }
    next(err);
  }
});

permissionRoutes.get('/overview/:cldbid', async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'permoverview', {
      cldbid: String(req.params.cldbid),
      cid: req.query.cid || 0,
      permid: req.query.permid || 0,
    }));
  } catch (err) { next(err); }
});

// R11 "why": can client `actor` do `action` to client `target`? Answers with the checks and the overview
// rows that decide each value (no sentences: the page words them). Only computed from what TeamSpeak
// reports; which channel each value is read in follows the measured rules in @ts6/common
// (evaluatePermissionAction). An offline actor is evaluated in the server's default channel.
const asId = (v: unknown, what: string, required = true): number | undefined => {
  if (v === undefined || v === '') {
    if (required) throw new AppError(400, `${what} is required`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new AppError(400, `${what} must be a non-negative integer`);
  return n;
};
const list = (r: any): any[] => (Array.isArray(r) ? r : r ? [r] : []);

permissionRoutes.get('/explain', async (req: Request, res: Response, next) => {
  try {
    const action = String(req.query.action ?? '') as PermissionAction;
    if (!(PERMISSION_ACTIONS as readonly string[]).includes(action)) throw new AppError(400, 'Unknown action');
    const actorDbid = asId(req.query.actor, 'actor')!;
    const targetDbid = asId(req.query.target, 'target')!;
    const isGroup = action === 'group-add' || action === 'group-remove';
    const sgid = asId(req.query.sgid, 'sgid', isGroup);
    const destination = asId(req.query.destination, 'destination', action === 'move');
    const banDuration = asId(req.query.duration, 'duration', false) ?? 0;
    if (actorDbid === targetDbid) throw new AppError(400, 'Actor and target must be different clients');

    const client = getClient(req);
    const sid = getSid(req);
    const notFound = async (cldbid: number) => {
      try { await client.execute(sid, 'clientdbinfo', { cldbid }); return false; } catch (err) {
        if (err instanceof TSApiError && (err.code === 512 || err.code === 1281 || err.code === 1540)) return true;
        throw err;
      }
    };
    for (const [who, cldbid] of [['actor', actorDbid], ['target', targetDbid]] as const) {
      if (await notFound(cldbid)) throw new AppError(404, `The ${who} is not in the client database`, undefined, `${who}-not-found`);
    }

    const [online, channels, permList] = await Promise.all([
      client.execute(sid, 'clientlist').then(list),
      client.execute(sid, 'channellist').then(list),
      client.execute(sid, 'permissionlist').then(list),
    ]);
    // Voice clients only: a query login of the same database id is never the one acting in the channel
    const where = (cldbid: number) => online.find((c) => Number(c.client_database_id) === cldbid && Number(c.client_type) === 0);
    const actorOn = where(actorDbid);
    const targetOn = where(targetDbid);
    const defaultCid = Number(channels.find((c) => String(c.channel_flag_default) === '1')?.cid ?? channels[0]?.cid ?? 0);
    if (destination !== undefined && !channels.some((c) => Number(c.cid) === destination)) {
      throw new AppError(404, 'The destination channel does not exist', undefined, 'destination-not-found');
    }
    const permName = new Map(permList.filter((p) => p.permid !== undefined).map((p) => [Number(p.permid), String(p.permname)]));
    const overview = async (cldbid: number, cid: number) =>
      list(await client.execute(sid, 'permoverview', { cldbid, cid, permid: 0 }))
        .filter((r) => OVERVIEW_TIER_RANK[Number(r.t)] !== undefined)
        .map((r) => ({
          rank: OVERVIEW_TIER_RANK[Number(r.t)], t: Number(r.t), id1: Number(r.id1), id2: Number(r.id2),
          permsid: permName.get(Number(r.p)) ?? `permid_${r.p}`,
          permvalue: Number(r.v) || 0, permnegated: Number(r.n) || 0, permskip: Number(r.s) || 0,
        }));

    const actorCid = actorOn ? Number(actorOn.cid) : defaultCid;
    const targetCid = targetOn ? Number(targetOn.cid) : defaultCid;
    const [actorInOwnChannel, actorInTargetChannel, actorInDestination, target] = await Promise.all([
      overview(actorDbid, actorCid),
      targetOn ? overview(actorDbid, targetCid) : undefined,
      destination !== undefined ? overview(actorDbid, destination) : undefined,
      overview(targetDbid, targetCid),
    ]);
    let group: { sgid: number; perms: { permsid: string; permvalue: number }[]; targetIsMember: boolean } | undefined;
    if (isGroup) {
      const groupPerms = await client.execute(sid, 'servergrouppermlist', { sgid, '-permsid': '' }).then(list).catch((err) => {
        if (err instanceof TSApiError && err.code === 1281) return [];
        if (err instanceof TSApiError && err.code === 2560) throw new AppError(404, 'The server group does not exist', undefined, 'group-not-found');
        throw err;
      });
      const memberOf = await client.execute(sid, 'servergroupsbyclientid', { cldbid: targetDbid }).then(list).catch((err) => {
        if (err instanceof TSApiError && err.code === 1281) return [];
        throw err;
      });
      group = {
        sgid: sgid!,
        perms: groupPerms.map((p) => ({ permsid: String(p.permsid), permvalue: Number(p.permvalue) || 0 })),
        targetIsMember: memberOf.some((g) => Number(g.sgid) === sgid),
      };
    }

    const result = evaluatePermissionAction({
      action, targetOnline: !!targetOn, actorOnline: !!actorOn,
      actorInOwnChannel, actorInTargetChannel, actorInDestination, target, group, banDuration,
      destinationIsTargetChannel: destination !== undefined && !!targetOn && destination === targetCid,
    });
    res.json({
      ...result,
      context: {
        actor: { cldbid: actorDbid, online: !!actorOn, cid: actorCid },
        target: { cldbid: targetDbid, online: !!targetOn, cid: targetCid },
        destination: destination ?? null, sgid: sgid ?? null, banDuration, defaultCid,
      },
    });
  } catch (err) { next(err); }
});

// Automatic Groups: servergroupautoaddperm / servergroupautodelperm apply a set
// of permissions to every regular server group whose i_group_auto_update_type
// equals sgtype, not to a single group, and TeamSpeak applies them across the
// whole instance rather than just the virtual server in the URL. Admin only for
// that reason. Template groups and the built-in query groups carry the same
// permission but are left alone (measured on 6.0.0-beta13.1).
const AUTO_GROUP_TYPES = new Set([10, 15, 20, 25, 30, 35, 40, 45, 50]);
const PERMSID_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_AUTO_PERMS = 200;

function parseAutoGroupRequest(body: any, withValues: boolean): { sgtype: number; perms: Record<string, string>[] } {
  const sgtype = Number(body?.sgtype);
  if (!AUTO_GROUP_TYPES.has(sgtype)) throw new AppError(400, 'sgtype must be one of the automatic group types (10, 15, 20, 25, 30, 35, 40, 45, 50)');
  const list = body?.permissions;
  if (!Array.isArray(list) || list.length === 0) throw new AppError(400, 'permissions must be a non-empty list');
  if (list.length > MAX_AUTO_PERMS) throw new AppError(400, `At most ${MAX_AUTO_PERMS} permissions per request`);

  const seen = new Set<string>();
  const perms = list.map((p: any): Record<string, string> => {
    const permsid = typeof p?.permsid === 'string' ? p.permsid : '';
    if (!PERMSID_PATTERN.test(permsid)) throw new AppError(400, `Invalid permission name: ${permsid || '(empty)'}`);
    if (seen.has(permsid)) throw new AppError(400, `Permission listed twice: ${permsid}`);
    seen.add(permsid);
    if (!withValues) return { permsid };
    const permvalue = Number(p.permvalue);
    if (!Number.isInteger(permvalue)) throw new AppError(400, `permvalue of ${permsid} must be a whole number`);
    return {
      permsid,
      permvalue: String(permvalue),
      permnegated: p.permnegated ? '1' : '0',
      permskip: p.permskip ? '1' : '0',
    };
  });
  return { sgtype, perms };
}

async function runAutoGroupCommand(req: Request, res: Response, command: string, withValues: boolean) {
  const { sgtype, perms } = parseAutoGroupRequest(req.body, withValues);
  // WebQuery's list form: one object per permission, the shared sgtype only on the first.
  const payload = perms.map((p, i) => (i === 0 ? { sgtype: String(sgtype), ...p } : p));
  const envelope = await getClient(req).executeRaw(getSid(req), command, payload);
  if (envelope.status.code !== 0) throw new TSApiError(envelope.status.code, envelope.status.message);
  res.json({ ok: true, sgtype, count: perms.length });
}

permissionRoutes.post('/automatic-groups/add', requireRole('admin'), async (req: Request, res: Response, next) => {
  try { await runAutoGroupCommand(req, res, 'servergroupautoaddperm', true); } catch (err) { next(err); }
});

permissionRoutes.post('/automatic-groups/remove', requireRole('admin'), async (req: Request, res: Response, next) => {
  try { await runAutoGroupCommand(req, res, 'servergroupautodelperm', false); } catch (err) { next(err); }
});
