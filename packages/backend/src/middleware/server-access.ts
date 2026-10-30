import { Request, Response, NextFunction } from 'express';
import { grantCovers, grantOf } from '../utils/vs-access.js';

/**
 * H9: Middleware to enforce per-server access control.
 * Admins bypass this check. Everyone else needs a UserServerAccess grant on the connection, and on a
 * /vs/:sid path one that covers that virtual server (utils/vs-access.ts).
 */
export function requireServerAccess() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Admins have access to all servers
    if (req.user?.role === 'admin') return next();

    const configId = parseInt(req.params.configId as string);
    if (isNaN(configId)) {
      res.status(400).json({ error: 'Invalid server config ID' });
      return;
    }
    // Virtual server 0 is the instance itself (WebQuery runs a command on sid 0 instance-wide, the
    // log route then reads the instance log), and only an admin acts on the instance.
    const sid = req.params.sid as string | undefined;
    if (sid !== undefined && !/^[1-9]\d*$/.test(sid)) {
      res.status(403).json({ error: 'No access to this virtual server' });
      return;
    }

    const grant = await grantOf(req.app.locals.prisma, req.user!.id, configId);
    if (!grant) {
      res.status(403).json({ error: 'No access to this server' });
      return;
    }
    if (sid !== undefined && !grantCovers(grant, Number(sid))) {
      res.status(403).json({ error: 'No access to this virtual server' });
      return;
    }

    next();
  };
}
