import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConsoleEvent, ConsoleEventCategory, ConsoleEventStatus } from '@ts6/common';
import { openEventStream, type EventStreamFailure } from './event-stream';
import { MAX_COLLECTED_EVENTS } from './events';

// The console's live event listening, as a hook: opens and closes the stream,
// says how it is doing, and keeps what arrives - handing it to the page in
// batches (a busy server would otherwise redraw the page for every single
// event) and holding on to the newest ones for saving as a file.

export type EventConnection = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed';

/** What the running stream was started with. */
export interface ActiveListening {
  sid: number;
  categories: ConsoleEventCategory[];
  textChannelId: number | null;
}

export interface EventListenerState {
  connection: EventConnection;
  status: ConsoleEventStatus | null;
  /** Why the stream ended, when it did so on its own. */
  failure: EventStreamFailure | null;
  active: ActiveListening | null;
  /** Events held for saving, and how many of the oldest did not fit. */
  collected: number;
  dropped: number;
}

const IDLE: EventListenerState = { connection: 'idle', status: null, failure: null, active: null, collected: 0, dropped: 0 };
const FLUSH_MS = 150;

interface Options {
  configId: number | null;
  /** The newest events since the last call, oldest first. */
  onBatch: (events: ConsoleEvent[], listening: ActiveListening) => void;
}

export function useEventListener({ configId, onBatch }: Options) {
  const [state, setState] = useState<EventListenerState>(IDLE);
  const handle = useRef<{ close(): void } | null>(null);
  const pending = useRef<ConsoleEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collected = useRef<ConsoleEvent[]>([]);
  const dropped = useRef(0);
  const listening = useRef<ActiveListening | null>(null);
  const categoriesUsed = useRef<Set<ConsoleEventCategory>>(new Set());

  // The newest callback without restarting the stream whenever the page redraws.
  const batchCallback = useRef(onBatch);
  batchCallback.current = onBatch;

  const flush = useCallback(() => {
    flushTimer.current = null;
    const batch = pending.current;
    pending.current = [];
    if (batch.length === 0 || !listening.current) return;

    collected.current.push(...batch);
    if (collected.current.length > MAX_COLLECTED_EVENTS) {
      const excess = collected.current.length - MAX_COLLECTED_EVENTS;
      collected.current.splice(0, excess);
      dropped.current += excess;
    }
    setState((current) => ({ ...current, collected: collected.current.length, dropped: dropped.current }));
    batchCallback.current(batch, listening.current);
  }, []);

  const closeStream = useCallback(() => {
    handle.current?.close();
    handle.current = null;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    // What had arrived but not been shown yet is shown rather than lost.
    flush();
  }, [flush]);

  const stop = useCallback(() => {
    closeStream();
    setState((current) => ({ ...current, connection: 'idle', status: null, failure: null, active: null }));
  }, [closeStream]);

  const start = useCallback(
    (request: ActiveListening) => {
      if (configId === null) return;
      closeStream();
      // Events of another virtual server do not belong in the same file.
      if (listening.current && listening.current.sid !== request.sid) {
        collected.current = [];
        dropped.current = 0;
        categoriesUsed.current = new Set();
      }
      listening.current = request;
      for (const category of request.categories) categoriesUsed.current.add(category);
      setState({ connection: 'connecting', status: null, failure: null, active: request, collected: collected.current.length, dropped: dropped.current });

      handle.current = openEventStream(
        { configId, sid: request.sid, categories: request.categories, textChannelId: request.textChannelId },
        {
          onStatus: (status) => setState((current) => ({ ...current, connection: status.state, status })),
          onEvent: (event) => {
            pending.current.push(event);
            if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
          },
          onRetrying: () => setState((current) => ({ ...current, connection: 'reconnecting' })),
          onClosed: (failure) => {
            handle.current = null;
            flush();
            setState((current) => ({ ...current, connection: 'closed', failure }));
          },
        },
      );
    },
    [configId, closeStream, flush],
  );

  const clearCollected = useCallback(() => {
    collected.current = [];
    dropped.current = 0;
    setState((current) => ({ ...current, collected: 0, dropped: 0 }));
  }, []);

  /** What was collected, oldest first, with what is needed to describe it in a file. */
  const snapshot = useCallback(
    () => ({
      events: [...collected.current],
      dropped: dropped.current,
      sid: listening.current?.sid ?? 0,
      categories: [...categoriesUsed.current],
    }),
    [],
  );

  // A different server connection, or leaving the page: nothing may keep listening.
  useEffect(() => {
    return () => {
      handle.current?.close();
      handle.current = null;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      collected.current = [];
      dropped.current = 0;
      listening.current = null;
      categoriesUsed.current = new Set();
      setState(IDLE);
    };
  }, [configId]);

  return { ...state, start, stop, clearCollected, snapshot };
}
