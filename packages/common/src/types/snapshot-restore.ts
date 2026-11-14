// Bringing single server or channel groups back from a snapshot (stage 3): created again with
// normal commands under the caller's rights, so they get NEW ids. What still points at the old id
// (manager settings, bot flows) is listed, never rewritten.
import type { SnapshotCompareSource } from './snapshot-compare.js';

export type SnapshotGroupKind = 'serverGroup' | 'channelGroup';

/** TeamSpeak's limit for a group name (servergroupadd answers 1541 above it). */
export const GROUP_NAME_MAX = 30;

export interface SnapshotRestoreGroupChoice {
  kind: SnapshotGroupKind;
  /** The group's id in the snapshot. */
  id: number;
  /** When the name is taken on the server: create the group under this name instead of skipping it. */
  newName?: string;
}

export interface SnapshotRestoreRequest {
  /** The snapshot to take the groups from (a file or a backup; not the live server). */
  source: SnapshotCompareSource;
  groups: SnapshotRestoreGroupChoice[];
  /** Also add the server group members again (only those still in the client database). Off by default. */
  members?: boolean;
  /** Preview only: nothing is created and no backup is taken. */
  dryRun?: boolean;
  /** Restore although the automatic backup before it failed (the dialog's explicit choice). */
  skipBackup?: boolean;
}

/** A place in the manager that names the group's OLD id; it is not changed. */
export interface SnapshotGroupReference {
  where: 'protected-group' | 'temporary-group' | 'support-queue' | 'raid-protection' | 'command-permission' | 'command-admin-group' | 'flow';
  /** What exactly, e.g. a flow's name and node, a support queue's channel, a raid setting. */
  detail: string;
}

export interface SnapshotRestorePermFailure {
  perm: string;
  message: string;
}

export interface SnapshotRestoreOutcome {
  kind: SnapshotGroupKind;
  /** The id in the snapshot. */
  oldId: number;
  /** The name in the snapshot. */
  name: string;
  /**
   * preview: `ready` (would be created), `name-taken` (needs a choice: skip or another name).
   * run: `created`, `skipped`, `failed`.
   */
  status: 'ready' | 'name-taken' | 'created' | 'skipped' | 'failed';
  /** skipped: why. */
  reason?: 'name-taken' | 'still-exists' | 'not-in-snapshot' | 'invalid-name';
  /** failed: TeamSpeak's error text. */
  message?: string;
  /** The name it was (or would be) created under, when not the snapshot's. */
  createdAs?: string;
  newId?: number;
  permissions: number;
  /** Permissions that could not be set; the group is kept. */
  permFailures?: SnapshotRestorePermFailure[];
  /** Server groups: members in the snapshot; with `members`, how many were added again / are no longer in the client database / failed. */
  members?: { inSnapshot: number; added?: number; missing?: number; failed?: number };
  references: SnapshotGroupReference[];
}

export interface SnapshotRestoreResult {
  dryRun?: true;
  outcomes: SnapshotRestoreOutcome[];
  /** The before-bulk backup taken first (absent in a preview or with skipBackup). */
  backup?: string;
}
