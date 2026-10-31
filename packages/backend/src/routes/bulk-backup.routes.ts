import { Router, type Request, type Response } from 'express';
import type { BulkBackupScope, BulkBackupStatus, UserPermission } from '@ts6/common';
import { requirePermission } from '../middleware/rbac.js';
import { getBackupSettings, lastBackupWithSnapshot } from '../utils/backups.js';
import { ensureBulkBackup } from '../utils/bulk-backup.js';

// What a deletion dialog shows about backups, and its "back up now" (R9 stage 3). Mounted at
// .../vs/:sid/bulk-backup; each scope is opened in app.ts for the permission of its deletion, so
// whoever may delete may also take the backup for it - and only a before-bulk one.
export const bulkBackupRoutes: Router = Router({ mergeParams: true });

/** The permission of the deletion each scope belongs to; the same as in app.ts. */
export const BULK_BACKUP_PERMISSIONS: Record<BulkBackupScope, UserPermission> = {
  groups: 'groups.edit',
  channels: 'channels.delete',
  profiles: 'clients.database',
};

const status = async (req: Request): Promise<BulkBackupStatus> => ({
  threshold: (await getBackupSettings(req.app.locals.prisma)).bulkBackupThreshold,
  last: lastBackupWithSnapshot(Number(req.params.configId), Number(req.params.sid)),
});

// One route per scope (not /:scope), so the access matrix tests each with its own permission.
for (const [scope, permission] of Object.entries(BULK_BACKUP_PERMISSIONS)) {
  bulkBackupRoutes.get(`/${scope}`, requirePermission(permission), async (req: Request, res: Response, next) => {
    try { res.json(await status(req)); } catch (err) { next(err); }
  });

  bulkBackupRoutes.post(`/${scope}`, requirePermission(permission), async (req: Request, res: Response, next) => {
    try {
      // Always the state as it is now; the deletions the dialog sends next then reuse this one.
      await ensureBulkBackup(req.app.locals.prisma, req.app.locals.connectionPool, Number(req.params.configId), Number(req.params.sid), req.user?.username ?? 'unknown', Date.now(), true);
      res.status(201).json(await status(req));
    } catch (err) { next(err); }
  });
}
