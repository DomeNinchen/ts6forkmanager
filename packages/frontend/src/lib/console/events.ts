import type { TFunction } from 'i18next';
import { CONSOLE_EVENT_CATEGORIES, formatQueryLine, isSecretKey, MASKED_VALUE, type ConsoleEvent, type ConsoleEventCategory } from '@ts6/common';
import type { EventStreamFailure } from './event-stream';

// What the console does with the live events it is sent: a one-line summary for
// the transcript, the sentence for when listening ends, and the files the
// collected events can be saved as. Nothing here is stored anywhere - the
// events live in the page until it is closed.

/** Events kept in the page for saving. A busy server sends many; this is the newest of them. */
export const MAX_COLLECTED_EVENTS = 10_000;

/** An event as ServerQuery prints it, with every secret value hidden. */
export function eventToLine(event: ConsoleEvent): string {
  return formatQueryLine({ command: event.name, options: [], blocks: [event.data] }, { maskKey: isSecretKey });
}

export interface EventSummary {
  /** i18n key under pages.console.events.summary */
  key: string;
  values: Record<string, string>;
}

const FIELDS = ['client_nickname', 'clid', 'cid', 'cpid', 'cfid', 'ctid', 'invokername', 'channel_name', 'msg', 'banid', 'name'] as const;

/** Which sentence describes an event, and the fields to fill it with. */
export function summarizeEvent(event: ConsoleEvent): EventSummary {
  const values: Record<string, string> = { name: event.name };
  for (const field of FIELDS) values[field] = event.data[field] ?? '';
  // A name that is missing reads better as the id it stands for.
  if (!values.client_nickname) values.client_nickname = `#${values.clid}`;
  if (!values.invokername) values.invokername = '?';

  const key = (() => {
    switch (event.name) {
      case 'notifycliententerview':
        return 'clientEnter';
      case 'notifyclientleftview':
        return 'clientLeft';
      case 'notifyclientmoved':
        return 'clientMoved';
      case 'notifyserveredited':
        return 'serverEdited';
      case 'notifychannelcreated':
        return 'channelCreated';
      case 'notifychanneledited':
        return 'channelEdited';
      case 'notifychanneldescriptionchanged':
        return 'channelDescription';
      case 'notifychannelpasswordchanged':
        return 'channelPassword';
      case 'notifychannelmoved':
        return 'channelMoved';
      case 'notifychanneldeleted':
        return 'channelDeleted';
      case 'notifytextmessage':
        return { '1': 'textPrivate', '2': 'textChannel', '3': 'textServer' }[event.data.targetmode ?? ''] ?? 'unknown';
      case 'notifybanupdate':
        // TeamSpeak 6 reports both a new ban and a removed one as an update; `op` tells them apart.
        return event.data.op === 'add' ? 'banAdded' : 'banRemoved';
      default:
        return 'unknown';
    }
  })();
  return { key, values };
}

/** Which category labels an event: the first of those that deliver it, or none for one the app does not know. */
export function primaryCategory(event: ConsoleEvent): ConsoleEventCategory | null {
  return event.categories[0] ?? null;
}

/** What to tell the admin when listening ended on its own. */
export function describeFailure(t: TFunction, failure: EventStreamFailure): string {
  if (failure.kind === 'lost') return t('pages.console.events.failure.lost');

  if (failure.kind === 'end') {
    const { reason, failure: code, message } = failure.end;
    if (reason === 'UNAUTHORIZED') return t('pages.console.events.failure.UNAUTHORIZED');
    return t(`pages.console.events.failure.${code ?? 'SESSION_FAILED'}`, { message: message ?? '' });
  }

  const { status, body } = failure;
  switch (body.code) {
    case 'SSH_NOT_CONFIGURED':
      return t('pages.console.events.noSsh');
    case 'TEXT_CHANNEL_IN_USE':
      return t('pages.console.events.failure.TEXT_CHANNEL_IN_USE', { channel: body.channelId ?? '?' });
    case 'TOO_MANY_STREAMS':
    case 'TOO_MANY_LISTENERS':
      return t(`pages.console.events.failure.${body.code}`);
    case 'RATE_LIMITED':
      return t('pages.console.events.failure.RATE_LIMITED', { seconds: Math.max(1, Math.ceil((body.retryAfterMs ?? 1000) / 1000)) });
  }
  if (status === 401) return t('pages.console.events.failure.UNAUTHORIZED');
  if (status === 403) return t('pages.console.events.failure.FORBIDDEN');
  return body.error || t('pages.console.events.failure.generic');
}

const selectionKey = (userId: number) => `ts6-console-events-${userId}`;

/** The categories this admin listened to last time, so that the boxes are as they left them. */
export function loadEventSelection(userId: number): ConsoleEventCategory[] {
  try {
    const stored = JSON.parse(localStorage.getItem(selectionKey(userId)) ?? 'null');
    if (Array.isArray(stored)) return CONSOLE_EVENT_CATEGORIES.filter((category) => stored.includes(category));
  } catch {
    // Blocked or garbled storage: start from the default.
  }
  return ['server', 'channel'];
}

export function saveEventSelection(userId: number, selection: ConsoleEventCategory[]): void {
  try {
    localStorage.setItem(selectionKey(userId), JSON.stringify(selection));
  } catch {
    // Storage full or blocked: the boxes simply are not remembered.
  }
}

export interface EventExportContext {
  serverName: string;
  sid: number;
  virtualServerName: string;
  categories: ConsoleEventCategory[];
  /** How many of the oldest events no longer fit and were dropped. */
  dropped: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `20261004-101213`, for a file name. */
export function fileStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function exportFileName(context: EventExportContext, extension: 'txt' | 'json'): string {
  const server = context.serverName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'server';
  return `ts6-events-${server}-vs${context.sid}-${fileStamp()}.${extension}`;
}

/** One line per event: the time TeamSpeak's event reached the backend, then the event the way ServerQuery prints it. */
export function buildTextExport(events: ConsoleEvent[], context: EventExportContext): string {
  const header = [
    '# TS6 Manager - events from the query console',
    `# Server: ${context.serverName}`,
    `# Virtual server: ${context.virtualServerName} (${context.sid})`,
    `# Listening to: ${context.categories.join(', ')}`,
    `# Saved: ${new Date().toISOString()}`,
    `# Events: ${events.length}${context.dropped > 0 ? ` (the ${context.dropped} oldest did not fit and were dropped)` : ''}`,
    `# Secret values are written as ${MASKED_VALUE}`,
    '',
  ];
  return [...header, ...events.map((event) => `${event.at} ${eventToLine(event)}`), ''].join('\n');
}

export function buildJsonExport(events: ConsoleEvent[], context: EventExportContext): string {
  return JSON.stringify(
    {
      format: 'ts6-console-events',
      version: 1,
      savedAt: new Date().toISOString(),
      server: context.serverName,
      virtualServer: { id: context.sid, name: context.virtualServerName },
      categories: context.categories,
      dropped: context.dropped,
      events: events.map((event) => ({
        at: event.at,
        name: event.name,
        categories: event.categories,
        data: Object.fromEntries(
          Object.entries(event.data).map(([key, value]) => [key, value !== '' && isSecretKey(key) ? MASKED_VALUE : value]),
        ),
      })),
    },
    null,
    2,
  );
}

/** Hands the browser a file to save. */
export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later: some browsers start the download only after the click handler has returned.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
