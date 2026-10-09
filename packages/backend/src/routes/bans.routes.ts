import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';

export const banRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};
const getSid = (req: Request) => parseInt(String(req.params.sid));

// The ban list carries addresses, UIDs and reasons. The Bans page is admin-only
// in the UI, so the whole router is - reads included.
banRoutes.use(requireRole('admin'));

banRoutes.get('/', async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'banlist')); } catch (err) { next(err); }
});

banRoutes.post('/', requireRole('admin'), async (req: Request, res: Response, next) => {
  try { res.status(201).json(await getClient(req).execute(getSid(req), 'banadd', req.body)); } catch (err) { next(err); }
});

banRoutes.delete('/:banid', requireRole('admin'), async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'bandel', { banid: String(req.params.banid) })); } catch (err) { next(err); }
});

banRoutes.delete('/', requireRole('admin'), async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'bandelall')); } catch (err) { next(err); }
});
