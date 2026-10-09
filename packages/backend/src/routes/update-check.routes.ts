/**
 * Update-check route — the cached result is readable by any authenticated user
 * (informational, not a security-sensitive setting); forcing a fresh check, which
 * calls GitHub, is an admin's. See ../utils/update-check.ts.
 */

import { Router, type Request, type Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { getCachedUpdateCheck, forceUpdateCheck } from '../utils/update-check.js';

const updateCheckRoutes: Router = Router();

// GET /api/update-check — cached result of the periodic GitHub check
updateCheckRoutes.get('/', (_req: Request, res: Response) => {
  res.json(getCachedUpdateCheck());
});

// POST /api/update-check/recheck — on-demand refresh (Settings → Update Status, and right after an admin signs in)
updateCheckRoutes.post('/recheck', requireRole('admin'), async (_req: Request, res: Response, next) => {
  try {
    res.json(await forceUpdateCheck());
  } catch (err) { next(err); }
});

export { updateCheckRoutes };
