import type { BackupCheckResult, BackupEntry, BackupKind, BackupOverview, BackupSettings } from '@ts6/common';
import api from './client';

const one = (kind: BackupKind, name: string) => `/backups/${kind}/${encodeURIComponent(name)}`;

export const backupsApi = {
  overview: (): Promise<BackupOverview> => api.get('/backups').then((r) => r.data),

  // Copying and checking a large database takes longer than the default 15 s.
  create: (): Promise<BackupEntry> => api.post('/backups', undefined, { timeout: 600_000 }).then((r) => r.data),

  setSettings: (settings: BackupSettings): Promise<BackupOverview> => api.put('/backups/settings', settings).then((r) => r.data),

  check: (kind: BackupKind, name: string): Promise<BackupCheckResult> =>
    api.post(`${one(kind, name)}/check`, undefined, { timeout: 600_000 }).then((r) => r.data),

  // A link the browser opens itself, so the ZIP streams to disk (see backups.routes.ts).
  createDownloadLink: (kind: BackupKind, name: string): Promise<{ url: string }> =>
    api.post(`${one(kind, name)}/download-links`).then((r) => r.data),

  remove: (kind: BackupKind, name: string): Promise<void> => api.delete(one(kind, name)).then(() => undefined),
};
