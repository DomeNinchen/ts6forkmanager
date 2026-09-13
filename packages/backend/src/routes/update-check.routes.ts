/**
 * Update-check route — read-only, any authenticated user (informational,
 * not a security-sensitive setting). See ../utils/update-check.ts.
 */

import { Router, type Request, type Response } from 'express';
import { getCachedUpdateCheck, forceUpdateCheck } from '../utils/update-check.js';

const updateCheckRoutes: Router = Router();

// GET /api/update-check — cached result of the periodic GitHub check
updateCheckRoutes.get('/', (_req: Request, res: Response) => {
  res.json(getCachedUpdateCheck());
});

// POST /api/update-check/recheck — on-demand refresh (e.g. Settings → Update Status)
updateCheckRoutes.post('/recheck', async (_req: Request, res: Response) => {
  res.json(await forceUpdateCheck());
});

export { updateCheckRoutes };
