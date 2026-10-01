import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import type { UserHistorySampler } from '../ts-client/user-history-sampler.js';
import { isUserHistoryRange } from '../utils/user-history-series.js';

export const statisticsRoutes: Router = Router({ mergeParams: true });

// GET /user-history?range=24h|3d|7d|14d|31d — the recorded user count of one
// virtual server for the Statistics -> History chart: bucketed points with a
// 24-hour average, the stretches where the server was unreachable or stopped
// (or nobody was measuring), and the headline figures. Admin only, like the
// Statistics page it belongs to.
statisticsRoutes.get('/user-history', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const configId = parseInt(String(req.params.configId));
    const sid = parseInt(String(req.params.sid));
    if (!Number.isInteger(configId) || !Number.isInteger(sid)) {
      throw new AppError(400, 'Invalid server or virtual server id');
    }

    const range = req.query.range === undefined ? '24h' : req.query.range;
    if (!isUserHistoryRange(range)) {
      throw new AppError(400, 'range must be one of: 24h, 3d, 7d, 14d, 31d');
    }

    const sampler: UserHistorySampler = req.app.locals.userHistorySampler;
    const history = await sampler.getHistory(configId, sid, range);
    if (!history) throw new AppError(404, 'Server config not found');
    res.json(history);
  } catch (err) { next(err); }
});
