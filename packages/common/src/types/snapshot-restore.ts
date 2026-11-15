// Bringing single server/channel groups (stage 3) and channels (stage 4) back from a snapshot:
// created again with normal commands under the caller's rights, so they get NEW ids. What still
// points at the old id (manager settings, bot flows) is listed, never rewritten.
import type { SnapshotCompareSource, SnapshotObjectKind } from './snapshot-compare.js';

export type SnapshotGroupKind = 'serverGroup' | 'channelGroup';

/** TeamSpeak's limit for a group name (servergroupadd answers 1541 above it). */
export const GROUP_NAME_MAX = 30;
/** TeamSpeak's limit for a channel name (41 characters answer 1541, measured on 6.0.0-beta13.1). */
export const CHANNEL_NAME_MAX = 40;

export interface SnapshotRestoreChannelChoice {
  /** The channel's id in the snapshot. */
  id: number;
  /** When the name is taken under the same parent: create it under this name instead of skipping it. */
  newName?: string;
  /** A channel that had a password: TeamSpeak keeps only a hash, which cannot be set again - a new one, or none. */
  password?: string;
}

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
  groups?: SnapshotRestoreGroupChoice[];
  /** Deleted parents are always added (a channel needs its parent); deleted subchannels only when listed. */
  channels?: SnapshotRestoreChannelChoice[];
  /** Also add the server group members again (only those still in the client database). Off by default. */
  members?: boolean;
  /** Preview only: nothing is created and no backup is taken. */
  dryRun?: boolean;
  /** Restore although the automatic backup before it failed (the dialog's explicit choice). */
  skipBackup?: boolean;
}

/** A place in the manager that names the group's OLD id; it is not changed. */
export interface SnapshotGroupReference {
  where: 'protected-group' | 'temporary-group' | 'support-queue' | 'raid-protection' | 'command-permission' | 'command-admin-group' | 'flow' | 'music-bot';
  /** What exactly, e.g. a flow's name and node, a support queue's channel, a raid setting. */
  detail: string;
}

export interface SnapshotRestorePermFailure {
  perm: string;
  message: string;
}

export interface SnapshotRestoreOutcome {
  kind: SnapshotObjectKind;
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
  reason?: 'name-taken' | 'still-exists' | 'not-in-snapshot' | 'invalid-name' | 'parent-missing';
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
  /** Channels: `parent` = added because its parent was deleted too (always restored with it); `child` = a deleted subchannel the preview offers (can be left out). */
  role?: 'parent' | 'child';
  /** Channels: the parent's id in the snapshot (0 = top level). */
  parentOldId?: number;
  /** Channels that had a password: whether a new one was (or will be) set. */
  password?: 'set' | 'none';
  /** Channels: the snapshot's default-channel flag is not carried over (it would move the server's default channel). */
  defaultDropped?: true;
}

export interface SnapshotRestoreResult {
  dryRun?: true;
  outcomes: SnapshotRestoreOutcome[];
  /** The before-bulk backup taken first (absent in a preview or with skipBackup). */
  backup?: string;
}
