import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { TSApiError, AppError } from '../middleware/error-handler.js';

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

clientRoutes.get('/database', async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientdblist', {
      start: req.query.start || 0, duration: req.query.duration || 100,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.get('/database/:cldbid', async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientdbinfo', { cldbid: String(req.params.cldbid) });
    res.json(result);
  } catch (err) { next(err); }
});

// Bulk routes - registered before the generic /:clid routes below, since
// Express would otherwise match e.g. "/bulk/move" as "/:clid/move" with
// clid="bulk" (the same ordering gotcha as elsewhere in this codebase).
clientRoutes.post('/bulk/move', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { clids, cid, cpw } = req.body as { clids: number[]; cid: number; cpw?: string };
    if (!Array.isArray(clids) || clids.length === 0) throw new AppError(400, 'clids must be a non-empty array');
    const result = await getClient(req).executeJsonBody(getSid(req), 'clientmove', { clid: clids, cid, cpw });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/bulk/kick', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { clids, reasonid, reasonmsg } = req.body as { clids: number[]; reasonid?: number; reasonmsg?: string };
    if (!Array.isArray(clids) || clids.length === 0) throw new AppError(400, 'clids must be a non-empty array');
    const result = await getClient(req).executeJsonBody(getSid(req), 'clientkick', { clid: clids, reasonid: reasonid || 5, reasonmsg });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/bulk/ban', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { clids, time, banreason } = req.body as { clids: number[]; time?: number; banreason?: string };
    if (!Array.isArray(clids) || clids.length === 0) throw new AppError(400, 'clids must be a non-empty array');
    const result = await getClient(req).executeJsonBody(getSid(req), 'banclient', { clid: clids, time: time || 0, banreason });
    res.json(result);
  } catch (err) { next(err); }
});

// clientedit (unlike move/kick/ban) has no documented multi-clid form, so this
// applies the same description to each selected client with its own call.
clientRoutes.post('/bulk/describe', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { clids, description } = req.body as { clids: number[]; description: string };
    if (!Array.isArray(clids) || clids.length === 0) throw new AppError(400, 'clids must be a non-empty array');
    const results = await Promise.allSettled(
      clids.map((clid) => getClient(req).execute(getSid(req), 'clientedit', { clid, client_description: description })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    res.json({ succeeded: clids.length - failed, failed });
  } catch (err) { next(err); }
});

clientRoutes.get('/:clid', async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientinfo', { clid: String(req.params.clid) });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/kick', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientkick', {
      clid: String(req.params.clid), reasonid: req.body.reasonid || 5, reasonmsg: req.body.reasonmsg,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/ban', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'banclient', {
      clid: String(req.params.clid), time: req.body.time || 0, banreason: req.body.banreason,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/move', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientmove', {
      clid: String(req.params.clid), cid: req.body.cid, cpw: req.body.cpw,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/poke', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'clientpoke', {
      clid: String(req.params.clid), msg: req.body.msg,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.post('/:clid/message', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'sendtextmessage', {
      targetmode: 1, target: String(req.params.clid), msg: req.body.msg,
    });
    res.json(result);
  } catch (err) { next(err); }
});

clientRoutes.get('/:cldbid/permissions', async (req: Request, res: Response, next) => {
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

clientRoutes.put('/:cldbid/permissions', requireRole('admin'), async (req: Request, res: Response, next) => {
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

clientRoutes.delete('/:cldbid/permissions', requireRole('admin'), async (req: Request, res: Response, next) => {
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

clientRoutes.get('/:clid/groups', async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'servergroupsbyclientid', {
      cldbid: String(req.params.clid),
    });
    res.json(result);
  } catch (err) { next(err); }
});
