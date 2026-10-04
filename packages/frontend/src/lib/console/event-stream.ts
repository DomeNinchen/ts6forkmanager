import type { ConsoleErrorBody, ConsoleEvent, ConsoleEventCategory, ConsoleEventEnd, ConsoleEventStatus } from '@ts6/common';
import { authApi } from '@/api/auth.api';
import { useAuthStore } from '@/stores/auth.store';

// The live events of a virtual server arrive as a server-sent-events stream. The
// browser's own EventSource can not be used: it can not send the Authorization
// header the API wants, and the access token must not go into a URL. So this
// reads the stream with fetch and splits it into messages itself.

export interface EventStreamRequest {
  configId: number;
  sid: number;
  categories: ConsoleEventCategory[];
  /** With the `textchannel` category: the channel whose chat to hear. */
  textChannelId: number | null;
}

/** Why a stream is over for good (as opposed to a connection that is being retried). */
export type EventStreamFailure =
  | { kind: 'http'; status: number; body: Partial<ConsoleErrorBody> }
  | { kind: 'end'; end: ConsoleEventEnd }
  /** The connection kept breaking and was given up on. */
  | { kind: 'lost' };

export interface EventStreamHandlers {
  onStatus(status: ConsoleEventStatus): void;
  onEvent(event: ConsoleEvent): void;
  /** The connection broke and another try is on its way. */
  onRetrying(): void;
  /** Over for good. Not called when the caller closed the stream itself. */
  onClosed(failure: EventStreamFailure): void;
}

/** Splits the text of a server-sent-events stream into its messages: a message is the lines up to a blank one. */
export class SseParser {
  private buffer = '';

  constructor(private readonly onMessage: (event: string, data: string) => void) {}

  push(chunk: string): void {
    // Normalizing the whole buffer, not the chunk, keeps a CR LF that arrived in two pieces intact.
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, '\n');
    for (let end = this.buffer.indexOf('\n\n'); end !== -1; end = this.buffer.indexOf('\n\n')) {
      this.dispatch(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end + 2);
    }
  }

  private dispatch(block: string): void {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue; // a comment: the heartbeat
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) this.onMessage(event, data.join('\n'));
  }
}

/** The wait before the nth try after a connection broke, in ms. */
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15_000, 30_000];
/** Consecutive tries that fail before the stream is given up on. */
const MAX_FAILED_TRIES = 8;
/** A stream that stayed open this long was a working one: what broke it afterwards starts the count over. */
const STABLE_AFTER_MS = 20_000;
/** The backend pings every 15 s; a stream that has said nothing for this long is taken for dead. */
const SILENCE_LIMIT_MS = 45_000;
const WATCHDOG_INTERVAL_MS = 5000;
/** An access token that runs out within this is renewed before the stream is opened with it. */
const TOKEN_RENEW_MARGIN_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function expiresWithin(token: string, ms: number): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp !== 'number' || payload.exp * 1000 - Date.now() < ms;
  } catch {
    return false;
  }
}

/**
 * The access token to open a stream with. The API client renews an expired
 * token by itself when a request is answered with 401, so any authenticated
 * request will do to get that done before the stream is opened.
 */
async function currentToken(forceRenew: boolean): Promise<string | null> {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  if (forceRenew || expiresWithin(token, TOKEN_RENEW_MARGIN_MS)) await authApi.me().catch(() => undefined);
  return useAuthStore.getState().accessToken;
}

type Attempt = { type: 'retry'; stable: boolean } | { type: 'over'; failure: EventStreamFailure };

/**
 * Opens the stream and keeps it open: a connection that breaks, or a backend
 * that restarts, is retried with a growing pause. What no retry can fix - the
 * account may not listen, TeamSpeak refuses the SSH login, a bad request - ends
 * the stream with `onClosed`.
 */
export function openEventStream(request: EventStreamRequest, handlers: EventStreamHandlers): { close(): void } {
  const controller = new AbortController();
  let closed = false;

  const query = new URLSearchParams({ sid: String(request.sid), categories: request.categories.join(',') });
  if (request.textChannelId !== null) query.set('channel', String(request.textChannelId));
  const url = `/api/servers/${request.configId}/console/events?${query}`;

  async function attempt(renewToken: boolean): Promise<Attempt | 'renew'> {
    const token = await currentToken(renewToken);
    if (closed) return { type: 'retry', stable: false };
    if (!token) return { type: 'over', failure: { kind: 'http', status: 401, body: {} } };

    // One controller per try: the watchdog below can end a stream that went silent without ending the listening.
    const tryController = new AbortController();
    const abortTry = () => tryController.abort();
    controller.signal.addEventListener('abort', abortTry);
    let lastHeardAt = Date.now();
    // A connection can die without either side being told (a proxy that lost its upstream, a network that dropped
    // out); the backend pings every 15 s, so a stream that says nothing for much longer than that is gone.
    const watchdog = setInterval(() => {
      if (Date.now() - lastHeardAt > SILENCE_LIMIT_MS) tryController.abort();
    }, WATCHDOG_INTERVAL_MS);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          cache: 'no-store',
          signal: tryController.signal,
        });
      } catch {
        return { type: 'retry', stable: false };
      }

      if (!response.ok) {
        if (response.status === 401 && !renewToken) return 'renew';
        const body = (await response.json().catch(() => ({}))) as Partial<ConsoleErrorBody>;
        // A backend that is down or starting is worth another try; a refusal is not.
        if (response.status >= 500) return { type: 'retry', stable: false };
        return { type: 'over', failure: { kind: 'http', status: response.status, body } };
      }
      if (!response.body) return { type: 'retry', stable: false };

      const openedAt = Date.now();
      lastHeardAt = openedAt;
      let end: ConsoleEventEnd | null = null;
      const parser = new SseParser((event, data) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(data);
          if (event === 'status') handlers.onStatus(parsed as ConsoleEventStatus);
          else if (event === 'notify') handlers.onEvent(parsed as ConsoleEvent);
          else if (event === 'end') end = parsed as ConsoleEventEnd;
        } catch {
          // A message that is not JSON is not one of ours; skip it.
        }
      });

      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          lastHeardAt = Date.now();
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Broken off, gone silent, or closed by us.
      }
      if (closed) return { type: 'retry', stable: false };

      const stable = Date.now() - openedAt >= STABLE_AFTER_MS;
      const finished = end as ConsoleEventEnd | null;
      // The backend restarting, or the connection being edited, are over soon: try again.
      if (finished && finished.reason !== 'SERVER_SHUTDOWN' && finished.reason !== 'CONNECTION_CHANGED') {
        return { type: 'over', failure: { kind: 'end', end: finished } };
      }
      return { type: 'retry', stable };
    } finally {
      clearInterval(watchdog);
      controller.signal.removeEventListener('abort', abortTry);
    }
  }

  async function run() {
    let failedTries = 0;
    let renewToken = false;
    for (;;) {
      if (closed) return;
      const outcome = await attempt(renewToken);
      if (closed) return;
      if (outcome === 'renew') {
        renewToken = true;
        continue;
      }
      renewToken = false;
      if (outcome.type === 'over') {
        handlers.onClosed(outcome.failure);
        return;
      }
      failedTries = outcome.stable ? 1 : failedTries + 1;
      if (failedTries > MAX_FAILED_TRIES) {
        handlers.onClosed({ kind: 'lost' });
        return;
      }
      handlers.onRetrying();
      await sleep(RETRY_DELAYS[Math.min(failedTries, RETRY_DELAYS.length) - 1]);
    }
  }

  void run();
  return {
    close() {
      closed = true;
      controller.abort();
    },
  };
}
