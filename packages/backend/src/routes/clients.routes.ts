import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/rbac.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { TSApiError, AppError } from '../middleware/error-handler.js';
import { clientDatabaseRoutes } from './client-database.routes.js';
import type { BulkSkipReason } from '@ts6/common';
import { assertClientsNotProtected, protectedAmong, targetIds } from '../utils/protected-groups.js';
import { bulkIds, runPerTarget, sendBulk } from '../utils/bulk.js';

export const clientRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};
const getSid = (req: Request) => parseInt(String(req.params.sid));

clientRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    // M2: Only include -ip flag for admin users
    const flags: Record<string, string> = {
      '-uid': '', '-away': '', '-voice': '', '-times': '', '-groups': '', '-info': '', '-country': '',
    };
    if (req.user?.role === 'admin') {
      flags['-ip'] = '';
    }
    const result = await getClient(req).execute(getSid(req), 'clientlist', flags);
    res.json(result);
  } catch (err) { next(err); }
});

// The client database (every profile the server has ever seen) - admin-only, see its own file.
// Mounted before the generic /:clid routes below so "database" is never read as a client id.
clientRoutes.use('/database', clientDatabaseRoutes);

// Bulk routes - registered before the generic /:clid routes below, since
// Express would otherwise match e.g. "/bulk/move" as "/:clid/move" with
// clid="bulk" (the same ordering gotcha as elsewhere in this codebase).
// Each answers one outcome per client (utils/bulk.ts); a protected client is skipped, not a 403 for all.

/** The named clients, read once: nickname, and why one is left out (gone, protected, already in the channel). */
async function bulkTargets(req: Request, ids: number[], opts: { protect: boolean; cid?: number }) {
  const list = await getClient(req).execute(getSid(req), 'clientlist', { '-groups': '' }) as Array<Record<string, unknown>>;
  const rows = Array.isArray(list) ? list : [];
  const byClid = new Map(rows.map((c) => [Number(c.clid), c]));
  // Fails closed like assertClientsNotProtected: without the list nothing runs.
  const protectedIds = opts.protect ? await protectedAmong(req, rows) : new Set<number>();
  return ids.map((id) => {
    const c = byClid.get(id);
    const reason: BulkSkipReason | undefined = !c ? 'not-connected'
      : protectedIds.has(id) ? 'protected'
      : opts.cid !== undefined && Number(c.cid) === opts.cid ? 'already-there'
      : undefined;
    return { id, name: c ? String(c.client_nickname ?? id) : `#${id}`, reason };
  });
}

clientRoutes.post('/bulk/move', requirePermission('clients.move'), async (req: Request, res: Response, next) => {
  try {
    const ids = bulkIds(req.body?.clids, 'clids');
    const { cid, cpw } = req.body as { cid: number; cpw?: string };
    const targets = await bulkTargets(req, ids, { protect: true, cid: Number(cid) });
    sendBulk(res, await runPerTarget(targets, (clid) => getClient(req).execute(getSid(req), 'clientmove', { clid: String(clid), cid, cpw })));
  } catch (err) { next(err); }
});

clientRoutes.post('/bulk/kick', requirePermission('clients.kick'), async (req: Request, res: Response, next) => {
  try {
    const ids = bulkIds(req.body?.clids, 'clids');
    const { reasonid, reasonmsg } = req.body as { reasonid?: number; reasonmsg?: string };
    const targets = await bulkTargets(req, ids, { protect: true });
    sendBulk(res, await runPerTarget(targets, (clid) =>
      getClient(req).execute(getSid(req), 'clientkick', { clid: String(clid), reasonid: reasonid || 5, reasonmsg })));
  } catch (err) { next(err); }
});

clientRoutes.post('/bulk/ban', requirePermission('clients.ban'), async (req: Request, res: Response, next) => {
  try {
    const ids = bulkIds(req.body?.clids, 'clids');
    const { time, banreason } = req.body as { time?: number; banreason?: string };
    const targets = await bulkTargets(req, ids, { protect: true });
    sendBulk(res, await runPerTarget(targets, (clid) =>
      getClient(req).execute(getSid(req), 'banclient', { clid: String(clid), time: time || 0, banreason })));
  } catch (err) { next(err); }
});

// clientedit has no multi-clid form; protection does not apply (it guards kick, ban and move).
clientRoutes.post('/bulk/describe', requirePermission('clients.manage'), async (req: Request, res: Response, next) => {
  try {
    const ids = bulkIds(req.body?.clids, 'clids');
    const { description } = req.body as { description: string };
    const targets = await bulkTargets(req, ids, { protect: false });
    sendBulk(res, await runPerTarget(targets, (clid) =>
      getClient(req).execute(getSid(req), 'clientedit', { clid: String(clid), client_description: description })));
  } catch (err) { next(err); }
});

// clientinfo carries the client's address (connection_client_ip), which the list
// above deliberately withholds from non-admins (M2) - and no page reads a single
// client's info through here anyway.
clientRoutes.get('/:clid', requirePermission('clients.manage'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientinfo', { clid: String(req.params.clid) });
    res.json(result);
  } catch (err) { next(err); }
});

// Kick, ban and move refuse a target in a protected server group for non-admins (utils/protected-groups.ts).
clientRoutes.post('/:clid/kick', requirePermission('clients.kick'), async (req: Request, res: Response, next) => {
  try {
    const [clid] = targetIds([req.params.clid], 'clid');
    await assertClientsNotProtected(req, getClient(req), [clid]);
    const result = await getClient(req).execute(getSid(req), 'clientkick', {
      clid: String(clid), reasonid: req.body.reasonid || 5, reasonmsg: req.body.reasonmsg,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/ban', requirePermission('clients.ban'), async (req: Request, res: Response, next) => {
  try {
    const [clid] = targetIds([req.params.clid], 'clid');
    await assertClientsNotProtected(req, getClient(req), [clid]);
    const result = await getClient(req).execute(getSid(req), 'banclient', {
      clid: String(clid), time: req.body.time || 0, banreason: req.body.banreason,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/move', requirePermission('clients.move'), async (req: Request, res: Response, next) => {
  try {
    const [clid] = targetIds([req.params.clid], 'clid');
    await assertClientsNotProtected(req, getClient(req), [clid]);
    const result = await getClient(req).execute(getSid(req), 'clientmove', {
      clid: String(clid), cid: req.body.cid, cpw: req.body.cpw,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/poke', requirePermission('clients.message'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientpoke', {
      clid: String(req.params.clid), msg: req.body.msg,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/message', requirePermission('clients.message'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'sendtextmessage', {
      targetmode: 1, target: String(req.params.clid), msg: req.body.msg,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.get('/:cldbid/permissions', requirePermission('permissions.edit'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientpermlist', {
      cldbid: String(req.params.cldbid), '-permsid': '',
    });
    res.json(result);
  } catch (err) {
    // TS3 error 1281 = database_empty_result → client has no permissions yet
    if (err instanceof TSApiError && err.code === 1281) {
      res.json([]);
      return;
    }
    next(err);
  }
});

clientRoutes.put('/:cldbid/permissions', requirePermission('permissions.edit'), async (req: Request, res: Response, next) => {
  try {
    const cldbid = String(req.params.cldbid);
    const { permsid, permvalue, permnegated, permskip } = req.body;
    // Resolve permission name to numeric ID
    const permLookup = await getClient(req).execute(getSid(req), 'permidgetbyname', { permsid });
    const permid = permLookup?.[0]?.permid;
    if (!permid) throw new Error(`Unknown permission: ${permsid}`);
    await getClient(req).executePost(getSid(req), 'clientaddperm', {
      cldbid, permid: String(permid), permvalue: String(permvalue ?? 0),
      permnegated: String(permnegated ?? 0), permskip: String(permskip ?? 0),
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

clientRoutes.delete('/:cldbid/permissions', requirePermission('permissions.edit'), async (req: Request, res: Response, next) => {
  try {
    const cldbid = String(req.params.cldbid);
    const { permsid } = req.body;
    const permLookup = await getClient(req).execute(getSid(req), 'permidgetbyname', { permsid });
    const permid = permLookup?.[0]?.permid;
    if (!permid) throw new Error(`Unknown permission: ${permsid}`);
    await getClient(req).executePost(getSid(req), 'clientdelperm', {
      cldbid, permid: String(permid),
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

clientRoutes.get('/:clid/groups', requirePermission('clients.manage'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'servergroupsbyclientid', {
      cldbid: String(req.params.clid),
    });
    res.json(result);
  } catch (err) { next(err); }
});
