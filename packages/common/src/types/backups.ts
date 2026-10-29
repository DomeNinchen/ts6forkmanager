// Shapes exchanged between the backend's backup routes and the Backups page (R7).

/**
 * Where a backup came from. `manual` and `scheduled` are written by the Backups page,
 * `uploaded` was uploaded there, `before-restore` is the state the start saved before it
 * restored a backup (all in data/backups/managed/); `before-update` is the copy the container
 * takes on its own before it applies a pending migration (data/backups/, see db-backup.ts).
 */
export const BACKUP_KINDS = ['manual', 'scheduled', 'uploaded', 'before-restore', 'before-update'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** Written next to every backup as `<name>.json`. */
export interface BackupManifest {
  format: 1;
  /** ISO 8601. */
  createdAt: string;
  kind: Exclude<BackupKind, 'before-update'>;
  /** The backend that wrote it. */
  backendVersion: string;
  /** Migrations applied to the copy, oldest first: what decides whether this backend can take it. */
  migrations: string[];
  /** Of the .db file. */
  sha256: string;
  size: number;
  /** `PRAGMA integrity_check` of the copy right after it was written. */
  integrity: 'ok';
  createdBy: string | null;
}

export interface BackupEntry {
  kind: BackupKind;
  /** File name of the .db, unique within its kind. */
  name: string;
  size: number;
  /** ISO 8601. */
  createdAt: string;
  /** Who wrote it; for a before-update copy, the version that was about to start. */
  backendVersion: string | null;
  migrationCount: number | null;
  createdBy: string | null;
}

export interface BackupSettings {
  scheduleEnabled: boolean;
  /** 24h "HH:MM", server time. */
  time: string;
  /** 0 = Sunday .. 6 = Saturday. */
  days: number[];
  /** Scheduled backups kept; manual ones stay until deleted. */
  keep: number;
  /** Scheduled backups older than this are deleted too; null = by count only. */
  maxAgeDays: number | null;
  /** Largest backup that may be uploaded, in MiB. */
  maxUploadMb: number;
}

export interface BackupLastRun {
  /** ISO 8601. */
  at: string;
  kind: 'manual' | 'scheduled';
  ok: boolean;
  name: string | null;
  error: string | null;
}

export interface BackupOverview {
  backups: BackupEntry[];
  settings: BackupSettings;
  lastRun: BackupLastRun | null;
  /** Bytes free where the backups are written. */
  freeBytes: number | null;
  /** The live database including its write-ahead log. */
  databaseBytes: number;
  /** The backend's clock the schedule runs on, e.g. "17:39 (UTC)" - a container is often not in the admin's time zone. */
  serverTime: string;
  bounds: { keepMin: number; keepMax: number; maxAgeMin: number; maxAgeMax: number; uploadMbMin: number; uploadMbMax: number };
  /** A restore marked for the next start, not applied yet. */
  pendingRestore: { kind: BackupKind; name: string; requestedBy: string; requestedAt: string } | null;
  /** How the last restore ended. */
  lastRestore: BackupRestoreResult | null;
}

export interface BackupRestoreResult {
  /** ISO 8601. */
  at: string;
  ok: boolean;
  /** The backup, null when it no longer exists. */
  kind: BackupKind | null;
  name: string;
  requestedBy: string;
  /** The copy of the state before the restore, kind `before-restore`. */
  beforeRestore: string | null;
  /** The restore ran but the migrations after it failed, and the state before was put back. */
  rolledBack: boolean;
  error: string | null;
}

/** Result of "test backup": the same checks a restore will run, on a throwaway copy. */
export interface BackupCheckResult {
  /** Overall: can this backend take it? */
  ok: boolean;
  integrity: { ok: boolean; message: string };
  /** null when the backup has no manifest (a before-update copy). */
  checksum: { ok: boolean } | null;
  migrations: {
    /** `ok`: same set; `older`: this backend would migrate it forward; `newer`: written by a newer backend, refused; `no-history`: from before versioned migrations. */
    state: 'ok' | 'older' | 'newer' | 'no-history';
    /** Migrations this backend would still apply to it. */
    pending: string[];
    /** Migrations it has that this backend does not know. */
    unknown: string[];
  };
  /** Encrypted fields sampled with the running key. */
  key: { checked: number; failed: number; failedFields: string[] };
}
