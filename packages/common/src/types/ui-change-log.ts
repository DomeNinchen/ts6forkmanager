// Shapes exchanged between the backend's change-log middleware/routes and the
// Change log page (R6). One row per writing request a web user makes through
// the normal interface - everything the query console's own trail (console.ts)
// does not cover.

/** The methods that change something; a GET never produces a row. */
export const UI_CHANGE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type UiChangeMethod = (typeof UI_CHANGE_METHODS)[number];

/**
 * How a change ended. `pending` is written before a security-critical change is
 * run (so one that takes the backend down still leaves a trace), then becomes
 * `ok` or `error`. `denied` is a request the role check turned away (403), which
 * never reached its handler.
 */
export const UI_CHANGE_STATUSES = ['pending', 'ok', 'error', 'denied'] as const;
export type UiChangeStatus = (typeof UI_CHANGE_STATUSES)[number];

/** How far back the list looks. */
export const UI_CHANGE_RANGES = ['24h', '7d', '30d', 'all'] as const;
export type UiChangeRange = (typeof UI_CHANGE_RANGES)[number];

/** The value a masked secret field is stored and shown as - never the secret itself. */
export const UI_CHANGE_SECRET_PLACEHOLDER = '(changed)';

export interface UiChangeLogEntry {
  id: number;
  /** ISO 8601. */
  createdAt: string;
  userId: number | null;
  username: string;
  /** The caller's role at the time. */
  role: string;
  /** The visitor's address; null when IP recording is off. */
  ip: string | null;
  method: UiChangeMethod;
  /** The route group, for the "area" filter (e.g. "channels", "server-groups", "users"). */
  area: string;
  /** The matched path with ids named (e.g. "/servers/:configId/vs/:sid/channels/:id"), never the raw URL. */
  routePattern: string;
  serverConfigId: number | null;
  /** Resolved from serverConfigId when the page is read; null if the connection is gone. */
  serverName: string | null;
  virtualServerId: number | null;
  /** The leaf id the change was about (channel, group, user, ...), as text. */
  targetId: string | null;
  /** The request body with secret fields reduced to the placeholder; null when there was none. */
  body: string | null;
  status: UiChangeStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  durationMs: number | null;
  loggedToTeamSpeak: boolean;
}

export interface UiChangeLogPage {
  entries: UiChangeLogEntry[];
  /** Number of rows that match the filters, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}

export interface UiChangeLogSettingsDto {
  enabled: boolean;
  retentionDays: number;
  maxRows: number;
  /** Store the web user's address with each change. On by default. */
  recordIp: boolean;
  /** Also write a line into the TeamSpeak server log for server-bound changes. Off by default. */
  writeToTsLog: boolean;
  /** Bounds and what is stored now, for the settings panel. */
  bounds: { retentionMin: number; retentionMax: number; maxRowsMin: number; maxRowsMax: number };
  entryCount: number;
  /** ISO 8601, or null when the log is empty. */
  oldestAt: string | null;
}
