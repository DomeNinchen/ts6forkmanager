// Comparing a TeamSpeak snapshot with the live virtual server: groups, channels and their
// permissions, each object added / removed / changed. Read-only; secrets in the snapshot
// (keys, password hashes, client identities) never reach this shape.

export type SnapshotObjectKind = 'serverGroup' | 'channelGroup' | 'channel';

export interface SnapshotPermValue {
  value: number;
  negated: boolean;
  skip: boolean;
}

/** One field of a group or channel; null = not set on that side. Channel parent/position are names, not ids. */
export interface SnapshotFieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface SnapshotPermChange {
  /** The permission's name (permsid), e.g. i_client_talk_power. */
  perm: string;
  before: SnapshotPermValue | null;
  after: SnapshotPermValue | null;
}

/** before = the snapshot, after = the live server. */
export interface SnapshotObjectDiff {
  kind: SnapshotObjectKind;
  id: number;
  name: string;
  /** added = only on the live server, removed = only in the snapshot. */
  status: 'added' | 'removed' | 'changed';
  fields: SnapshotFieldChange[];
  perms: SnapshotPermChange[];
}

export interface SnapshotCompareCounts {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export interface SnapshotCompareResult {
  /** The snapshot format version both sides were read in. */
  formatVersion: string;
  objects: SnapshotObjectDiff[];
  counts: Record<SnapshotObjectKind, SnapshotCompareCounts>;
}

/** Where the "before" side comes from: a snapshot file the admin picked, or a backup holding one of this virtual server. */
export type SnapshotCompareSource =
  | { type: 'file'; snapshot: { version: string | number; data: string } }
  | { type: 'backup'; kind: string; name: string };

/** A backup that can be compared with this virtual server. */
export interface SnapshotBackupSource {
  kind: string;
  name: string;
  createdAt: string;
}
