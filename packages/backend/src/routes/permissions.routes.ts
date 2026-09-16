import { Router, Request, Response } from 'express';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { TSApiError } from '../middleware/error-handler.js';

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
