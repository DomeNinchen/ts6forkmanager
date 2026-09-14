/**
 * YouTube cookie validity check route — read-only, any authenticated user
 * (the banner needs this in the layout for everyone, same reasoning as
 * update-check.routes.ts). See ../utils/yt-cookie-check.ts.
 */

import { Router, type Request, type Response } from 'express';
import { getCachedCookieCheck, forceCookieCheck } from '../utils/yt-cookie-check.js';

const ytCookieCheckRoutes: Router = Router();

// GET /api/yt-cookie-check — cached result of the periodic validity check
ytCookieCheckRoutes.get('/', (_req: Request, res: Response) => {
  res.json(getCachedCookieCheck());
});

// POST /api/yt-cookie-check/recheck — on-demand refresh
ytCookieCheckRoutes.post('/recheck', async (_req: Request, res: Response) => {
  res.json(await forceCookieCheck());
});

export { ytCookieCheckRoutes };
