import type { Request, Response } from 'express';
import type {
  ConsoleErrorBody,
  ConsoleEvent,
  ConsoleEventCategory,
  ConsoleEventEnd,
  ConsoleEventStatus,
  ConsoleSettings,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { finishAudit, pruneAuditIfDue, recordAudit, startAudit, type AuditStart } from './audit.js';
import { EventSessionError, type EventAttachment, type EventSessionManager, type EventSubscriber } from './event-sessions.js';

const HEARTBEAT_MS = 15_000;
/** How often the account behind a stream is checked to still be an admin. */
const RECHECK_MS = 60_000;
/** What may sit unsent in a stream before it is cut: a browser that stopped reading would otherwise make the backend buffer without limit. */
const MAX_BACKLOG_BYTES = 1_000_000;

export interface EventStreamContext {
  req: Request;
  res: Response;
  prisma: PrismaClient;
  manager: EventSessionManager;
  user: { id: number; username: string };
  configId: number;
  serverName: string;
  sid: number;
  categories: ConsoleEventCategory[];
  /** Only with the `textchannel` category. */
  textChannelId: number | null;
  settings: ConsoleSettings;
}

export type EventStreamOutcome = { ok: true } | { ok: false; httpStatus: number; body: ConsoleErrorBody };

const REFUSAL_STATUS: Record<EventSessionError['code'], number> = {
  TEXT_CHANNEL_IN_USE: 409,
  TOO_MANY_LISTENERS: 429,
  TOO_MANY_STREAMS: 429,
  RATE_LIMITED: 429,
};

/**
 * Opens a server-sent-events stream of what happens on a virtual server and
 * keeps it until the browser goes away.
 *
 * Listening is recorded in the audit trail like a command is: a row before
 * anything is asked of TeamSpeak (and no stream if it can not be written), and
 * a row when the admin stops, so that the trail says who could see what, and
 * for how long. Events themselves are not stored - they are only relayed.
 *
 * What the stream sends: `status` (see ConsoleEventStatus) when it opens and
 * whenever the listener changes, `notify` (ConsoleEvent) for every event the
 * admin asked for, `end` (ConsoleEventEnd) as the last thing when the backend
 * ends it, and a `: ping` comment now and then to keep proxies from closing it.
 * The data of every message is one line of JSON, so nothing in an event - a
 * chat message with line breaks, say - can end a message early.
 */
export async function openEventStream(ctx: EventStreamContext): Promise<EventStreamOutcome> {
  const { req, res, prisma, manager, user, configId, serverName, sid, categories, textChannelId, settings } = ctx;

  const events = categories.join(',');
  const target = textChannelId !== null ? ` id=${textChannelId}` : '';
  const auditBase: Pick<AuditStart, 'userId' | 'username' | 'serverConfigId' | 'serverName' | 'virtualServerId' | 'danger' | 'mutating'> = {
    userId: user.id,
    username: user.username,
    serverConfigId: configId,
    serverName,
    virtualServerId: sid,
    danger: false,
    mutating: false,
  };

  const startRow = await startAudit(prisma, {
    ...auditBase,
    command: `servernotifyregister event=${events}${target}`,
    commandName: 'servernotifyregister',
  });
  void pruneAuditIfDue(prisma, settings.auditRetentionDays);
  const startedAt = Date.now();

  let startDone = false;
  let startSucceeded = false;
  const finishStart = (status: 'ok' | 'error', errorCode: number | null, errorMessage: string | null) => {
    if (startDone) return;
    startDone = true;
    startSucceeded = status === 'ok';
    void finishAudit(prisma, startRow, { status, errorCode, errorMessage, durationMs: Date.now() - startedAt, loggedToTeamSpeak: false });
  };

  let closed = false;
  let attachment: EventAttachment | null = null;
  const timers: NodeJS.Timeout[] = [];

  const writable = (): boolean => !closed && !res.destroyed && !res.writableEnded;

  const write = (event: string, data: unknown): void => {
    if (!writable()) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // The socket's 'close' still runs the cleanup below, once.
    if (res.writableLength > MAX_BACKLOG_BYTES) res.destroy();
  };

  const finish = (end: ConsoleEventEnd): void => {
    if (!writable()) return;
    write('end', end);
    res.end();
  };

  const subscriber: EventSubscriber = {
    userId: user.id,
    categories: new Set(categories),
    textChannelId,
    onStatus: (status: ConsoleEventStatus) => {
      write('status', status);
      if (status.state === 'live') {
        if (status.registered.length > 0) finishStart('ok', null, null);
        else if (status.refused.length > 0) finishStart('error', status.refused[0].code, status.refused[0].message);
      }
    },
    onEvent: (event: ConsoleEvent) => write('notify', event),
    onEnd: (end: ConsoleEventEnd) => {
      finishStart('error', null, end.message ?? end.reason);
      finish(end);
    },
  };

  try {
    attachment = manager.attach(configId, sid, subscriber);
  } catch (err) {
    finishStart('error', null, err instanceof Error ? err.message : String(err));
    if (err instanceof EventSessionError) {
      return {
        ok: false,
        httpStatus: REFUSAL_STATUS[err.code],
        body: { code: err.code, error: err.message, channelId: err.channelId, retryAfterMs: err.retryAfterMs },
      };
    }
    throw err;
  }

  // From here on the response is a stream. Nothing below awaits before it is open, so that no
  // status the listener reports can reach `write` while the headers are still to be sent.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    // nginx would hold the stream back to fill a buffer; this tells it not to.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const timer of timers) clearInterval(timer);
    attachment?.detach();
    finishStart('error', null, 'The stream was closed before the listener was ready');
    if (startSucceeded) {
      void recordAudit(prisma, {
        ...auditBase,
        command: `servernotifyunregister event=${events}${target}`,
        commandName: 'servernotifyunregister',
        status: 'ok',
        errorCode: null,
        errorMessage: null,
        // For a stop, how long the admin was listening.
        durationMs: Date.now() - startedAt,
        loggedToTeamSpeak: false,
      });
    }
  };
  res.on('close', cleanup);

  timers.push(
    setInterval(() => {
      if (writable()) res.write(': ping\n\n');
    }, HEARTBEAT_MS),
    setInterval(() => {
      void prisma.user
        .findUnique({ where: { id: user.id }, select: { enabled: true, role: true } })
        .then((row: { enabled: boolean; role: string } | null) => {
          if (!row || !row.enabled || row.role !== 'admin') finish({ reason: 'UNAUTHORIZED' });
        })
        // A database that hiccups is not a reason to cut a stream; the next check tries again.
        .catch(() => undefined);
    }, RECHECK_MS),
  );

  write('status', attachment.status);
  return { ok: true };
}
