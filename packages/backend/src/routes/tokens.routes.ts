import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';

export const tokenRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};
const getSid = (req: Request) => parseInt(String(req.params.sid));

tokenRoutes.get('/', async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'privilegekeylist')); } catch (err) { next(err); }
});

tokenRoutes.post('/', requireRole('admin'), async (req: Request, res: Response, next) => {
  try { res.status(201).json(await getClient(req).execute(getSid(req), 'privilegekeyadd', req.body)); } catch (err) { next(err); }
});

tokenRoutes.delete('/:token', requireRole('admin'), async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'privilegekeydelete', { token: String(req.params.token) })); } catch (err) { next(err); }
});

// Temporary server passwords - separate from privilege keys, not saved to
// disk (lost on server restart), just a time-limited password to connect.
tokenRoutes.get('/temp-passwords', async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'servertemppasswordlist')); } catch (err) { next(err); }
});

tokenRoutes.post('/temp-passwords', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { pw, desc, duration, tcid, tcpw } = req.body;
    const result = await getClient(req).execute(getSid(req), 'servertemppasswordadd', {
      pw, desc: desc || '', duration, tcid: tcid || 0, tcpw: tcpw || '',
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

tokenRoutes.delete('/temp-passwords/:pw', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(getSid(req), 'servertemppassworddel', { pw: String(req.params.pw) });
    res.json(result);
  } catch (err) { next(err); }
});
