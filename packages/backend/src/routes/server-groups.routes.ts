import { Router, Request, Response } from 'express';
import { requirePermission, requireRole } from '../middleware/rbac.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { AppError } from '../middleware/error-handler.js';
import { protectedGroupIds, targetIds } from '../utils/protected-groups.js';
import { backupBeforeDeleting } from '../utils/bulk-backup.js';

export const serverGroupRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};
const getSid = (req: Request) => parseInt(String(req.params.sid));

// The group list (names, ids, types) is also what the Music Bots permission tab
// offers its operators; a group's members and permissions are admin-only.
serverGroupRoutes.get('/', requirePermission('groups.view'), async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'servergrouplist')); } catch (err) { next(err); }
});

// Protected groups (utils/protected-groups.ts): which groups of this virtual server non-admins may not
// kick, ban or move members of. Readable with the group list; only an admin changes them.
serverGroupRoutes.get('/protected', requirePermission('groups.view'), async (req: Request, res: Response, next) => {
  try {
    const ids = await protectedGroupIds(req.app.locals.prisma, parseInt(String(req.params.configId)), getSid(req));
    res.json({ sgids: [...ids].sort((a, b) => a - b) });
  } catch (err) { next(err); }
});

serverGroupRoutes.put('/:sgid/protected', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const [sgid] = targetIds([req.params.sgid], 'sgid');
    if (typeof req.body?.protected !== 'boolean') throw new AppError(400, 'protected must be true or false');
    const where = { serverConfigId: parseInt(String(req.params.configId)), sid: getSid(req), sgid };
    const prisma = req.app.locals.prisma;
    if (req.body.protected) {
      await prisma.protectedServerGroup.upsert({ where: { serverConfigId_sid_sgid: where }, create: where, update: {} });
    } else {
      await prisma.protectedServerGroup.deleteMany({ where });
    }
    res.json({ sgid, protected: req.body.protected });
  } catch (err) { next(err); }
});

serverGroupRoutes.post('/', requirePermission('groups.edit'), async (req: Request, res: Response, next) => {
  try { res.status(201).json(await getClient(req).execute(getSid(req), 'servergroupadd', req.body)); } catch (err) { next(err); }
});

serverGroupRoutes.put('/:sgid', requirePermission('groups.edit'), async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'servergrouprename', { sgid: String(req.params.sgid), ...req.body }));
  } catch (err) { next(err); }
});

serverGroupRoutes.delete('/:sgid', requirePermission('groups.edit'), async (req: Request, res: Response, next) => {
  try {
    await backupBeforeDeleting(req);
    const result = await getClient(req).execute(getSid(req), 'servergroupdel', { sgid: String(req.params.sgid), force: 1 });
    // A deleted group protects nobody; drop its mark so the list stays what the server has.
    const sgid = Number(req.params.sgid);
    if (Number.isInteger(sgid)) {
      await req.app.locals.prisma.protectedServerGroup.deleteMany({ where: { serverConfigId: parseInt(String(req.params.configId)), sid: getSid(req), sgid } });
    }
    res.json(result);
  } catch (err) { next(err); }
});

serverGroupRoutes.post('/:sgid/copy', requirePermission('groups.edit'), async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'servergroupcopy', { ssgid: String(req.params.sgid), ...req.body }));
  } catch (err) { next(err); }
});

serverGroupRoutes.get('/:sgid/members', requirePermission('groups.members'), async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'servergroupclientlist', { sgid: String(req.params.sgid), '-names': '' }));
  } catch (err) { next(err); }
});

serverGroupRoutes.post('/:sgid/members', requirePermission('groups.members'), async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'servergroupaddclient', { sgid: String(req.params.sgid), cldbid: req.body.cldbid }));
  } catch (err) { next(err); }
});

serverGroupRoutes.delete('/:sgid/members/:cldbid', requirePermission('groups.members'), async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'servergroupdelclient', { sgid: String(req.params.sgid), cldbid: String(req.params.cldbid) }));
  } catch (err) { next(err); }
});

serverGroupRoutes.get('/:sgid/permissions', requirePermission('permissions.edit'), async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'servergrouppermlist', { sgid: String(req.params.sgid), '-permsid': '' }));
  } catch (err) { next(err); }
});

serverGroupRoutes.put('/:sgid/permissions', requirePermission('permissions.edit'), async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'servergroupaddperm', { sgid: String(req.params.sgid), ...req.body }));
  } catch (err) { next(err); }
});

serverGroupRoutes.delete('/:sgid/permissions', requirePermission('permissions.edit'), async (req: Request, res: Response, next) => {
  try {
    res.json(await getClient(req).execute(getSid(req), 'servergroupdelperm', { sgid: String(req.params.sgid), ...req.body }));
  } catch (err) { next(err); }
});
