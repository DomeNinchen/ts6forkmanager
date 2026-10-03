// Query console API types - shared between the backend (produces them) and the
// frontend (consumes them).

import type { DangerReason } from '../serverquery/classification.js';
import type { QueryParseError, QueryParseWarning } from '../serverquery/syntax.js';

export interface ConsoleExecuteRequest {
  /** Virtual server the command runs on; 0 means the instance itself, without a virtual server. */
  sid: number;
  /** The command line exactly as typed, in ServerQuery syntax. */
  line: string;
  /** Only for a dangerous command: its name again, typed out by the admin as the confirmation. */
  confirm?: string;
}

/** TeamSpeak's own verdict on a command - the `error id=... msg=...` line of ServerQuery. */
export interface ConsoleStatus {
  code: number;
  message: string;
  /** WebQuery sometimes adds a longer explanation next to the short message. */
  extraMessage?: string;
}

export interface ConsoleExecuteResponse {
  command: string;
  sid: number;
  ok: boolean;
  status: ConsoleStatus;
  /** TeamSpeak answered 1281 ("empty result set"), which is a normal outcome for a list command. */
  emptyResult: boolean;
  records: Record<string, string>[];
  /** How many records TeamSpeak returned; larger than records.length when the reply was cut short. */
  recordCount: number;
  truncated: boolean;
  durationMs: number;
  warnings: QueryParseWarning[];
  /** Whether this command also left a line in the TeamSpeak server log. */
  loggedToTeamSpeak: boolean;
}

export type ConsoleErrorCode =
  | 'INVALID_REQUEST'
  | 'PARSE_ERROR'
  | 'CONFIRMATION_REQUIRED'
  | 'RATE_LIMITED'
  | 'NO_CONNECTION';

/** Body of every 4xx answer the console endpoints give for something the admin can act on. */
export interface ConsoleErrorBody {
  code: ConsoleErrorCode;
  error: string;
  parseError?: QueryParseError;
  /** CONFIRMATION_REQUIRED: the command that needs confirming and why. */
  command?: string;
  reason?: DangerReason;
  /** RATE_LIMITED: how long until the console may send again. */
  retryAfterMs?: number;
}

/** 'pending' stays if the backend went down before TeamSpeak's answer came back. */
export type ConsoleAuditStatus = 'pending' | 'ok' | 'error';

export interface ConsoleAuditEntry {
  id: number;
  createdAt: string;
  userId: number | null;
  username: string;
  serverConfigId: number;
  serverName: string;
  virtualServerId: number;
  /** The command in ServerQuery syntax with every secret value replaced by ***. */
  command: string;
  commandName: string;
  danger: boolean;
  mutating: boolean;
  status: ConsoleAuditStatus;
  errorCode: number | null;
  errorMessage: string | null;
  durationMs: number | null;
  loggedToTeamSpeak: boolean;
}

export interface ConsoleAuditPage {
  items: ConsoleAuditEntry[];
  /** Pass as `before` to get the next, older page; null when there is none. */
  nextBefore: number | null;
}

export interface ConsoleSettings {
  /** How long audit entries are kept, in days. */
  auditRetentionDays: number;
  /** Hold console commands back when they would eat into TeamSpeak's query flood limit. */
  floodGuardEnabled: boolean;
}
