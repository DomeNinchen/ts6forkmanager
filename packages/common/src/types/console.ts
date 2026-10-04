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
  | 'NO_CONNECTION'
  // The live event stream
  | 'SSH_NOT_CONFIGURED'
  | 'TEXT_CHANNEL_IN_USE'
  | 'TOO_MANY_LISTENERS'
  | 'TOO_MANY_STREAMS';

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
  /** TEXT_CHANNEL_IN_USE: the channel whose chat another admin is already listening to. */
  channelId?: number;
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

export const CONSOLE_SETTINGS_DEFAULTS: ConsoleSettings = {
  auditRetentionDays: 90,
  floodGuardEnabled: true,
};

/** What the retention setting may be, in days. */
export const CONSOLE_AUDIT_RETENTION_BOUNDS = { min: 1, max: 3650 } as const;

// --- Live events ---------------------------------------------------------
//
// An admin can listen to what happens on a virtual server (`servernotifyregister`).
// WebQuery can not do that, so the backend keeps one SSH ServerQuery session per
// server connection and virtual server, shared by every admin listening there,
// and relays what arrives over a server-sent-events stream. This is what the
// stream says.

/** The categories `servernotifyregister` knows, in the order the console lists them. */
export const CONSOLE_EVENT_CATEGORIES = ['server', 'channel', 'textserver', 'textchannel', 'textprivate', 'bans'] as const;
export type ConsoleEventCategory = (typeof CONSOLE_EVENT_CATEGORIES)[number];

export function isConsoleEventCategory(value: string): value is ConsoleEventCategory {
  return (CONSOLE_EVENT_CATEGORIES as readonly string[]).includes(value);
}

/** Whether the listener behind a stream is up. A listener that is gone for good ends the stream instead (see ConsoleEventEnd). */
export type ConsoleEventConnectionState = 'connecting' | 'live' | 'reconnecting';

/** A category TeamSpeak would not register, typically for a missing permission. */
export interface ConsoleEventRefusal {
  category: ConsoleEventCategory;
  code: number;
  message: string;
}

/** The `status` message: sent when a stream opens and whenever something about its listener changes. */
export interface ConsoleEventStatus {
  state: ConsoleEventConnectionState;
  /** The categories this stream asked for that TeamSpeak has registered. */
  registered: ConsoleEventCategory[];
  refused: ConsoleEventRefusal[];
  /** The channel the listener sits in - TeamSpeak delivers the chat of the channel the listener is in, which is what `textchannel` hears. */
  textChannelId: number | null;
}

/** The `notify` message: one `notify...` line from TeamSpeak. */
export interface ConsoleEvent {
  /** When the backend received it, ISO 8601. */
  at: string;
  /** `notifycliententerview`, `notifytextmessage`, ... */
  name: string;
  /** The registered categories that deliver it; empty for an event this app does not know. */
  categories: ConsoleEventCategory[];
  /** The fields of the line, unescaped. */
  data: Record<string, string>;
}

/** Why the backend ended a stream; a stream that ends on its own is a lost connection, not one of these. */
export type ConsoleEventEndReason =
  | 'UNAUTHORIZED' // the account was disabled or is no longer an admin
  | 'CONNECTION_CHANGED' // the server connection was edited or deleted
  | 'SERVER_SHUTDOWN'
  | 'SLOW_CONSUMER' // the browser did not keep up reading
  | 'SESSION_FAILED'; // the listener could not be set up, or was lost for good - see `failure`

export type ConsoleEventFailure = 'SSH_CONNECT_FAILED' | 'SSH_AUTH_FAILED' | 'VIRTUAL_SERVER_UNAVAILABLE';

/** The `end` message: the last thing a stream says. */
export interface ConsoleEventEnd {
  reason: ConsoleEventEndReason;
  failure?: ConsoleEventFailure;
  message?: string;
}
