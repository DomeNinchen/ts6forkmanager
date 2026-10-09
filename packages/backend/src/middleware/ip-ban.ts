import type { NextFunction, Request, Response } from 'express';
import { clientIpOf } from '../utils/connection-journal.js';
import type { IpBanService } from '../utils/ip-bans.js';

/**
 * Turns away every request from a banned address (see utils/ip-bans.ts) - the whole API, public
 * routes included, so a widget embedded on somebody's site stops answering to it as well. Only
 * /api/health stays open, so a monitor behind the same address keeps seeing the backend alive.
 *
 * The answer is a plain 403 with a sentence that says why, which is what a wrongly banned
 * visitor needs to make sense of it; a visitor who is banned rightly learns nothing from it.
 */
export function ipBanMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/api/health') return next();
  const bans = req.app.locals.ipBans as IpBanService | undefined;
  if (!bans) return next();
  const ip = clientIpOf(req);
  if (!bans.isBlocked(ip)) return next();
  bans.noteBlocked(ip);
  res.status(403).json({ error: 'Your address is blocked', code: 'ip-blocked' });
}
