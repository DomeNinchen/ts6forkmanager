/** What the manager did with its own data of a deleted virtual server. */
export interface VirtualServerCleanup {
  /** Users' access grants to this virtual server, removed. */
  accessGrants: number;
  /** Server groups marked protected, removed. */
  protectedGroups: number;
  /** Open temporary group memberships, ended (kept as history). */
  temporaryGroups: number;
  /** Support queues, switched off (their cases stay as history). */
  supportQueues: number;
  /** Raid protection settings removed (incidents stay as history). */
  raidProtection: boolean;
  /** Flows that were switched on, now off. */
  flowsDisabled: Array<{ id: number; name: string }>;
  /** Embed widgets that point to this server; left as they are. */
  widgets: Array<{ id: number; name: string }>;
}

/** The answer of DELETE /servers/:configId/virtual-servers/:sid. */
export interface VirtualServerDeleteResult {
  deleted: true;
  /** The before-deletion backup, or null when it was skipped. */
  backup: string | null;
  /** null when the clean-up failed after TeamSpeak had deleted the server. */
  cleanup: VirtualServerCleanup | null;
  cleanupError?: string;
}
