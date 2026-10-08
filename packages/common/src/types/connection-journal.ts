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
  scope: JournalAddressScope;
  /** Null when the address was not looked up (no GeoIP database yet), is not public, or is not in the database. */
  geo: ConnectionJournalGeo | null;
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

export const JOURNAL_SORT_COLUMNS = ['at', 'source', 'event', 'result', 'username', 'ip', 'country', 'reason', 'serverName'] as const;
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
  /** ISO 3166-1 alpha-2 code, null when the address was not looked up or is not in the database. */
  country: string | null;
  city: string | null;
  scope: JournalAddressScope;
}

/** What kind of address it is: only a `public` one can be placed on a map. */
export type JournalAddressScope = 'public' | 'private' | 'loopback' | 'unknown';

/** Where an address is, from the GeoIP database. Only the fields the database has are filled. */
export interface ConnectionJournalGeo {
  /** ISO 3166-1 alpha-2 code. */
  country: string;
  region: string | null;
  city: string | null;
}

export interface ConnectionJournalIpPage {
  rows: ConnectionJournalIpRow[];
  /** Number of distinct addresses that match the filters, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}

export const JOURNAL_IP_SORT_COLUMNS = ['lastAt', 'total', 'ip', 'country'] as const;
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

// --- GeoIP -----------------------------------------------------------------------------------

/** DB-IP's free "Lite" editions the app can download; a file of the admin's own is `custom`. */
export const GEOIP_EDITIONS = ['country', 'city'] as const;
export type GeoIpEdition = (typeof GEOIP_EDITIONS)[number];

/** Why the last download, update or upload did not work. */
export type GeoIpErrorCode =
  /** The file of this month (and last month's) is not on the download server. */
  | 'not-published'
  /** The download server could not be reached or answered with an error. */
  | 'download-failed'
  /** The file is larger than the app accepts. */
  | 'too-large'
  /** Not an MMDB file at all (or damaged). */
  | 'invalid-file'
  /** A readable MMDB, but not a country or city database (an ASN database, say). */
  | 'not-a-geo-database';

export interface ConnectionJournalGeoIpStatus {
  installed: boolean;
  /** `dbip`: downloaded by the app. `custom`: a file the admin uploaded. */
  source: 'dbip' | 'custom' | null;
  /** What is installed: a DB-IP edition, or `custom`. */
  edition: GeoIpEdition | 'custom' | null;
  /** DB-IP's release, e.g. "2026-10"; null for a custom file. */
  version: string | null;
  /** The database type the file says it is (e.g. "DBIP-Country-Lite"). */
  databaseType: string | null;
  /** ISO 8601, when the database was built. */
  builtAt: string | null;
  installedAt: string | null;
  sizeBytes: number | null;
  /** What the next download (and the monthly update) fetches. */
  selectedEdition: GeoIpEdition;
  /** Fetch a newer DB-IP release by itself once a month. Off by default. */
  autoUpdate: boolean;
  state: 'idle' | 'downloading' | 'installing';
  /** While downloading. `totalBytes` is the compressed size the server announced, if it did. */
  progress: { receivedBytes: number; totalBytes: number | null } | null;
  /** ISO 8601 of the last time a newer release was looked for (automatically or by hand). */
  lastCheckAt: string | null;
  lastError: { code: GeoIpErrorCode; detail: string } | null;
  /** Looking up the entries that were recorded before there was a database. */
  backfill: { running: boolean; done: number; total: number };
  /**
   * Whose data the page has to credit: `dbip` (CC BY 4.0: a link back to db-ip.com wherever the data is shown) or
   * `maxmind` (a GeoLite2 file: "This product includes GeoLite data created by MaxMind").
   */
  attribution: 'dbip' | 'maxmind' | null;
}

/** One country that occurs in the journal, with how many entries. */
export interface ConnectionJournalCountry {
  country: string;
  count: number;
}
