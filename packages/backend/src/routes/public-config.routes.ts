import { Router, Request, Response } from 'express';
import { getPrivacyNoticeEnabled } from '../utils/privacy-notice-settings.js';

export const publicConfigRoutes: Router = Router();

/**
 * GET /api/public-config - the few installation-wide settings a not-logged-in visitor's
 * browser needs (login page, setup page). Mounted before the auth middleware.
 *
 * Whitelist only: every field here is readable by anyone who can reach the app, so a
 * new setting goes in deliberately, never "everything in AppSetting". Writing stays
 * with the admin-only routes under /api/settings.
 */
publicConfigRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      privacyNotice: { enabled: await getPrivacyNoticeEnabled(prisma) },
    });
  } catch (err) { next(err); }
});
