// The answer every bulk action gives (R9): one line per target, so a partial failure says
// exactly which targets went through and why the others did not.

/** The most targets one bulk request may name. */
export const BULK_MAX = 500;

/**
 * Why a target was left out without being run: the manager's own checks (protected, not-connected,
 * already-there) or a skip TeamSpeak reports for the client database (online = connected profile,
 * no-value = nothing to ban by).
 */
export const BULK_SKIP_REASONS = ['protected', 'not-connected', 'already-there', 'online', 'no-value'] as const;
export type BulkSkipReason = (typeof BULK_SKIP_REASONS)[number];

export interface BulkOutcome {
  id: number;
  /** Nickname, icon id, group name ... - what the page shows for the target. */
  name: string;
  status: 'ok' | 'skipped' | 'failed';
  /** skipped: the manager's own reason. */
  reason?: BulkSkipReason;
  /** failed: TeamSpeak's error text. */
  message?: string;
}

export interface BulkResult {
  outcomes: BulkOutcome[];
}
