// Shapes exchanged between the backend's connection-journal routes and the Connection journal page.

/** Where a journal row comes from: `web` is the sign-in of this app, `ts` a client on a TeamSpeak virtual server. */
export const JOURNAL_SOURCES = ['web', 'ts'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

/**
 * What happened. Web: `login` is the password step, `totp` the second factor, `sso` a sign-in through
 * the identity provider, `rate-limit` a request the sign-in limit turned away. TeamSpeak:
 * `ts-session` is one connection of one client - a row that is opened when it joins and closed when it leaves.
 */
export const JOURNAL_EVENTS = ['login', 'totp', 'sso', 'rate-limit', 'ts-session'] as const;
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
  /** TeamSpeak rows only; null on a web row. */
  ts: ConnectionJournalTsDetails | null;
}

/** What a TeamSpeak session row says besides the common columns (the nickname is `username`). */
export interface ConnectionJournalTsDetails {
  serverConfigId: number | null;
  virtualServerId: number | null;
  serverName: string | null;
  uid: string | null;
  cldbid: number | null;
  clientVersion: string | null;
  clientPlatform: string | null;
  /** ISO 8601; null while the client is still there, or when the end was not seen (then `leaveReason` is "unknown"). */
  leftAt: string | null;
  /** What TeamSpeak said when the client left, or "unknown" / "recording-stopped". Null while the client is there. */
  leaveReason: string | null;
}

/** A TeamSpeak session whose end was not seen (the journal was not watching, the server restarted, the backend was down). */
export const JOURNAL_LEAVE_UNKNOWN = 'unknown';
/** A session that was still open when the journal stopped watching its server (switched off, connection disabled or deleted). */
export const JOURNAL_LEAVE_RECORDING_STOPPED = 'recording-stopped';

/** Why the TeamSpeak side of the journal cannot (fully) see a virtual server. */
export type JournalTsProblem =
  /** The connection has neither an API key nor an SSH login. */
  | 'no-access'
  /** There is no API key and the SSH login does not work (refused or not reachable). */
  | 'ssh-unavailable'
  /** The server did not answer. */
  | 'unreachable'
  /** The client list came without addresses: the account the app uses may not see them (b_client_remoteaddress_view). */
  | 'no-address-permission';

/** How one watched virtual server is covered right now; `virtualServerId` 0 is a whole connection that cannot be watched. */
export interface ConnectionJournalTsStatus {
  configId: number;
  connectionName: string;
  virtualServerId: number;
  /** `events`: SSH events, nothing missed. `polling`: asked every 15 seconds, a visit shorter than that is not seen. `idle`: cannot be watched. */
  mode: 'events' | 'polling' | 'idle';
  problem: JournalTsProblem | null;
  /** Clients on the server right now that have an open row. */
  openSessions: number;
  /** ISO 8601 of the last comparison with the real client list, null if there was none yet. */
  lastSyncAt: string | null;
}

export const JOURNAL_SORT_COLUMNS =['at', 'source', 'event', 'result', 'username', 'ip', 'reason', 'serverName'] as const;
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
  /** Also record ServerQuery clients (the admin identity of this app, other query tools) on TeamSpeak. Off by default. */
  recordQueryClients: boolean;
  /** Also record this app's own music bots on TeamSpeak. Off by default. */
  recordOwnBots: boolean;
  /** What the page shows next to the settings: bounds and what is stored now. */
  bounds: { retentionMin: number; retentionMax: number; maxRowsMin: number; maxRowsMax: number };
  entryCount: number;
  /** ISO 8601, or null when the journal is empty. */
  oldestAt: string | null;
}
