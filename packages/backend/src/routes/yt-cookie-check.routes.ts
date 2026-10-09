/**
 * YouTube cookie validity check route — the cached result is readable by any
 * authenticated user (the banner needs this in the layout for everyone, same
 * reasoning as update-check.routes.ts); forcing a fresh check, which makes a
 * request to YouTube, is an admin's. See ../utils/yt-cookie-check.ts.
 */

import { Router, type Request, type Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { getCachedCookieCheck, forceCookieCheck } from '../utils/yt-cookie-check.js';

const ytCookieCheckRoutes: Router = Router();

// GET /api/yt-cookie-check — cached result of the periodic validity check
ytCookieCheckRoutes.get('/', (_req: Request, res: Response) => {
  res.json(getCachedCookieCheck());
});

// POST /api/yt-cookie-check/recheck — on-demand refresh (Settings → YouTube, an admin tab)
ytCookieCheckRoutes.post('/recheck', requireRole('admin'), async (_req: Request, res: Response) => {
  res.json(await forceCookieCheck());
});

export { ytCookieCheckRoutes };
