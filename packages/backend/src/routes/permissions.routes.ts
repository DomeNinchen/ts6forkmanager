import { Router, Request, Response } from 'express';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import { requireRole } from '../middleware/rbac.js';

export const permissionRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};
const getSid = (req: Request) => parseInt(String(req.params.sid));

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
