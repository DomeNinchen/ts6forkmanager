import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/rbac.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';

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
    res.json(await getClient(req).execute(getSid(req), 'servergroupdel', { sgid: String(req.params.sgid), force: 1 }));
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
