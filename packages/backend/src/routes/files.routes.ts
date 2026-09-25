import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { TSApiError } from '../middleware/error-handler.js';
import { sshExecute, toSshAppError } from '../utils/ssh-query.js';

export const fileRoutes: Router = Router({ mergeParams: true });

// List files in a channel directory
// Uses shared SSH connection because ft* commands are not supported via WebQuery HTTP
fileRoutes.get('/:cid', async (req: Request, res: Response, next) => {
  try {
    const result = await sshExecute(req, 'ftgetfilelist', {
      cid: String(req.params.cid),
      cpw: String(req.query.cpw || ''),
      path: String(req.query.path || '/'),
    });
    res.json(result);
  } catch (err: any) {
    // TS3 error 1281 = database_empty_result → empty directory
    if (err instanceof TSApiError && err.code === 1281) {
      return res.json([]);
    }
    next(toSshAppError(err));
  }
});

// Create directory
fileRoutes.post('/:cid/mkdir', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await sshExecute(req, 'ftcreatedir', {
      cid: String(req.params.cid),
      cpw: '',
      dirname: req.body.dirname,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Delete file
fileRoutes.delete('/:cid/file', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await sshExecute(req, 'ftdeletefile', {
      cid: String(req.params.cid),
      cpw: '',
      name: req.body.name,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Move a file to another channel's file repository - ftrenamefile does this
// entirely server-side (no byte transfer through us) when tcid is given.
fileRoutes.post('/:cid/move', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await sshExecute(req, 'ftrenamefile', {
      cid: String(req.params.cid),
      cpw: '',
      tcid: String(req.body.targetCid),
      tcpw: '',
      oldname: req.body.name,
      newname: req.body.name,
    });
    res.json(result);
  } catch (err) { next(err); }
});
