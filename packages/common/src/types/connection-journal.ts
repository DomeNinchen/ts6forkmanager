// Shapes exchanged between the backend's connection-journal routes and the Connection journal page.

/** Where a journal row comes from. Only `web` (the sign-in of this app) exists so far; TeamSpeak logins follow. */
export const JOURNAL_SOURCES = ['web'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

/**
 * What happened. `login` is the password step, `totp` the second factor, `sso` a sign-in through the
 * identity provider, `rate-limit` a request the sign-in limit turned away.
 */
export const JOURNAL_EVENTS = ['login', 'totp', 'sso', 'rate-limit'] as const;
export type JournalEvent = (typeof JOURNAL_EVENTS)[number];

export const JOURNAL_RESULTS = ['success', 'failure'] as const;
export type JournalResult = (typeof JOURNAL_RESULTS)[number];

/**
 * Why, as a short code the page words in the admin's language. A success carries one only where it
 * says something (the password was right but a second factor is still needed, a trusted device
 * skipped it, a recovery code was used).
 */
export const JOURNAL_REASONS = [
  'wrong-password',
  'unknown-user',
  'disabled',
  'sso-account',
  'totp-required',
  'trusted-device',
  'wrong-code',
  'recovery-code',
  'ticket-invalid',
  'sso-not-configured',
  'sso-invalid-state',
  'sso-no-subject',
  'sso-failed',
  'login-limit',
  'refresh-limit',
] as const;
export type JournalReason = (typeof JOURNAL_REASONS)[number];

export interface ConnectionJournalEntryDto {
  id: number;
  /** ISO 8601. */
  at: string;
  source: JournalSource;
  event: JournalEvent;
  result: JournalResult;
  reason: JournalReason | null;
  username: string | null;
  userId: number | null;
  ip: string;
  userAgent: string | null;
}

export const JOURNAL_SORT_COLUMNS = ['at', 'source', 'event', 'result', 'username', 'ip', 'reason'] as const;
export type JournalSortColumn = (typeof JOURNAL_SORT_COLUMNS)[number];

/** How far back the list looks. */
export const JOURNAL_RANGES = ['24h', '7d', '30d', 'all'] as const;
export type JournalRange = (typeof JOURNAL_RANGES)[number];

export interface ConnectionJournalPage {
  entries: ConnectionJournalEntryDto[];
  /** Number of rows that match the filters, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/** One address in the "by address" view. */
export interface ConnectionJournalIpRow {
  ip: string;
  total: number;
  failures: number;
  successes: number;
  /** ISO 8601 */
  lastAt: string;
  /** Distinct account names tried from this address. */
  usernames: number;
}

export interface ConnectionJournalIpPage {
  rows: ConnectionJournalIpRow[];
  /** Number of distinct addresses that match the filters, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}

export const JOURNAL_IP_SORT_COLUMNS = ['lastAt', 'total', 'ip'] as const;
export type JournalIpSortColumn = (typeof JOURNAL_IP_SORT_COLUMNS)[number];

export interface ConnectionJournalSettingsDto {
  enabled: boolean;
  retentionDays: number;
  maxRows: number;
  /** What the page shows next to the settings: bounds and what is stored now. */
  bounds: { retentionMin: number; retentionMax: number; maxRowsMin: number; maxRowsMax: number };
  entryCount: number;
  /** ISO 8601, or null when the journal is empty. */
  oldestAt: string | null;
}
