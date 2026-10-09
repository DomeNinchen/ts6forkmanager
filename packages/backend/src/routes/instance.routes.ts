import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';

export const instanceRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};

// Instance, host and binding data (bound addresses, hardware, instance-wide
// settings). The Instance and Statistics pages are admin-only in the UI, so the
// whole router is - reads included.
instanceRoutes.use(requireRole('admin'));

instanceRoutes.get('/', async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(0, 'instanceinfo')); } catch (err) { next(err); }
});

// M3: Whitelist safe parameters for instanceedit
const ALLOWED_INSTANCE_PARAMS = new Set([
  'serverinstance_guest_serverquery_group',
  'serverinstance_template_serveradmin_group',
  'serverinstance_template_serverdefault_group',
  'serverinstance_template_channeladmin_group',
  'serverinstance_template_channeldefault_group',
  'serverinstance_filetransfer_port',
  'serverinstance_serverquery_flood_commands',
  'serverinstance_serverquery_flood_time',
  'serverinstance_serverquery_ban_time',
]);

instanceRoutes.put('/', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    // An unknown setting, or nothing left to change, is a 400 - filtering it out
    // quietly would still answer "ok" for an edit that never happened.
    const filtered: Record<string, unknown> = {};
    const unknown: string[] = [];
    for (const [key, val] of Object.entries(req.body ?? {})) {
      if (!ALLOWED_INSTANCE_PARAMS.has(key)) unknown.push(key);
      else if (val !== null && val !== undefined) filtered[key] = val;
    }
    if (unknown.length > 0) throw new AppError(400, `Unknown instance setting: ${unknown.join(', ')}`);
    if (Object.keys(filtered).length === 0) throw new AppError(400, 'No instance setting to change');
    res.json(await getClient(req).execute(0, 'instanceedit', filtered));
  } catch (err) { next(err); }
});

instanceRoutes.get('/host', async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(0, 'hostinfo')); } catch (err) { next(err); }
});

instanceRoutes.get('/version', async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(0, 'version')); } catch (err) { next(err); }
});

// IP addresses the instance listens on, per subsystem - instance-wide, not tied to any one virtual server.
instanceRoutes.get('/bindings', async (req: Request, res: Response, next) => {
  try {
    const [voice, query, filetransfer] = await Promise.all([
      getClient(req).execute(0, 'bindinglist', { subsystem: 'voice' }),
      getClient(req).execute(0, 'bindinglist', { subsystem: 'query' }),
      getClient(req).execute(0, 'bindinglist', { subsystem: 'filetransfer' }),
    ]);
    res.json({ voice, query, filetransfer });
  } catch (err) { next(err); }
});
