import type { BulkBackupScope, BulkBackupStatus } from '@ts6/common';
import api from './client';

const base = (configId: number, sid: number, scope: BulkBackupScope) =>
  `/servers/${configId}/vs/${sid}/bulk-backup/${scope}`;

/** A deletion dialog's backup step (R9): the last backup with a snapshot of this server, and "back up now". */
export const bulkBackupApi = {
  status: (configId: number, sid: number, scope: BulkBackupScope): Promise<BulkBackupStatus> =>
    api.get(base(configId, sid, scope)).then((r) => r.data),
  create: (configId: number, sid: number, scope: BulkBackupScope): Promise<BulkBackupStatus> =>
    api.post(base(configId, sid, scope)).then((r) => r.data),
};
