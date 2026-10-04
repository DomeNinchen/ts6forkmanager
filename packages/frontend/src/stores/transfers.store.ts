import { create } from 'zustand';
import { toast } from 'sonner';
import { checkFileName, joinRepositoryPath } from '@ts6/common';
import i18n from '@/lib/i18n';
import { formatBytes } from '@/lib/utils';
import { filesApi } from '@/api/files.api';
import { fileErrorMessage, hasNonAscii, isAlreadyExists, pathProblemMessage } from '@/lib/file-errors';

// Uploads to a channel's file repository, kept outside any page so they keep
// running - and their progress keeps counting - while you look at another
// page of the app. Only a reload or closing the tab stops them, and the
// browser asks before doing that for as long as something is still going.

export type UploadStatus =
  | 'queued'
  | 'preparing'
  /** Waiting for the answer to "that file already exists - overwrite it?" */
  | 'conflict'
  | 'uploading'
  | 'done'
  | 'skipped'
  | 'error'
  | 'canceled';

export interface UploadItem {
  id: string;
  batchId: string;
  configId: number;
  sid: number;
  cid: number;
  /** Directory the file goes into; the listing showing it is refreshed when the upload is done. */
  directory: string;
  /** Full path the file ends up at. */
  path: string;
  name: string;
  size: number;
  /** Bytes the browser has handed over so far. */
  loaded: number;
  status: UploadStatus;
  error?: string;
}

export interface UploadTarget {
  configId: number;
  sid: number;
  cid: number;
  directory: string;
}

export type ConflictDecision = 'overwrite' | 'skip';

interface TransfersState {
  uploads: UploadItem[];
  /** The upload waiting for an overwrite-or-skip answer, if any. */
  conflictId: string | null;
  enqueueUploads: (target: UploadTarget, files: File[], maxUploadBytes?: number) => void;
  resolveConflict: (decision: ConflictDecision, applyToAll: boolean) => void;
  cancelUpload: (id: string) => void;
  clearFinished: () => void;
}

// The server only hands out a handful of transfer tickets at a time (around ten
// on a real TS6 server, shared with every other client using file transfer), so
// a long queue is worked through a couple of files at once, not all at once.
const MAX_PARALLEL_UPLOADS = 2;

const FINISHED: UploadStatus[] = ['done', 'skipped', 'error', 'canceled'];
const isFinished = (status: UploadStatus) => FINISHED.includes(status);

// Things that cannot live in the store's state: the File objects themselves,
// the means to cancel a request in flight, and the question being asked.
const pendingFiles = new Map<string, File>();
const controllers = new Map<string, AbortController>();
let answerConflict: ((decision: ConflictDecision, applyToAll: boolean) => void) | null = null;
let rememberedDecision: ConflictDecision | null = null;
let conflictQueue: Promise<unknown> = Promise.resolve();
let nextId = 1;
// Not crypto.randomUUID(): that only exists on secure (https/localhost) pages,
// and this app is just as often served over plain http on a LAN.
const newId = () => `upload-${nextId++}`;

interface Batch {
  remaining: number;
  done: number;
  skipped: number;
  failed: number;
  canceled: number;
}
const batches = new Map<string, Batch>();

export const useTransfers = create<TransfersState>()((set, get) => {
  const patch = (id: string, fields: Partial<UploadItem>) =>
    set((state) => ({ uploads: state.uploads.map((item) => (item.id === id ? { ...item, ...fields } : item)) }));

  /** One upload reached its end: record it for the summary toast and move on. */
  const settle = (id: string, status: 'done' | 'skipped' | 'error' | 'canceled', fields: Partial<UploadItem> = {}) => {
    patch(id, { status, ...fields });
    const item = get().uploads.find((candidate) => candidate.id === id);
    if (!item) return;

    const batch = batches.get(item.batchId);
    if (batch) {
      if (status === 'done') batch.done++;
      else if (status === 'skipped') batch.skipped++;
      else if (status === 'error') batch.failed++;
      else batch.canceled++;
      batch.remaining--;
      if (batch.remaining <= 0) {
        batches.delete(item.batchId);
        announce(batch);
        // "Apply to all" covers the batch it was given for, not whatever is uploaded next
        if (batches.size === 0) rememberedDecision = null;
      }
    }
  };

  /** Ask once per conflict, one dialog at a time, unless the answer was already given for everything. */
  const askOverwrite = (id: string): Promise<ConflictDecision> => {
    const answer = conflictQueue.then(async (): Promise<ConflictDecision> => {
      // Called off while it waited its turn behind another question
      if (controllers.get(id)?.signal.aborted) return 'skip';
      if (rememberedDecision) return rememberedDecision;
      set({ conflictId: id });
      return new Promise<ConflictDecision>((resolve) => {
        answerConflict = (decision, applyToAll) => {
          if (applyToAll) rememberedDecision = decision;
          resolve(decision);
        };
      });
    });
    conflictQueue = answer.catch(() => undefined);
    return answer;
  };

  const run = async (id: string) => {
    const item = get().uploads.find((candidate) => candidate.id === id);
    const file = pendingFiles.get(id);
    if (!item || !file) return;

    const controller = new AbortController();
    controllers.set(id, controller);
    // Before the first await, so the queue never starts the same upload twice
    patch(id, { status: 'preparing' });

    try {
      let overwrite = false;
      let uploadId: string;
      for (;;) {
        try {
          ({ uploadId } = await filesApi.prepareUpload(
            item.configId, item.sid, item.cid, item.path, file.size, overwrite, controller.signal,
          ));
          break;
        } catch (err) {
          if (!isAlreadyExists(err) || overwrite) throw err;
          // Shown as waiting from the start, even when another question has to be answered first
          patch(id, { status: 'conflict' });
          const decision = await askOverwrite(id);
          if (controller.signal.aborted) throw err;
          if (decision === 'skip') {
            settle(id, 'skipped');
            return;
          }
          overwrite = true;
          patch(id, { status: 'preparing' });
        }
      }

      patch(id, { status: 'uploading', loaded: 0 });
      let lastUpdate = 0;
      await filesApi.sendUpload(
        item.configId, item.sid, item.cid, uploadId, file,
        (loaded) => {
          // Progress events come many times a second; the screen does not need all of them
          const now = Date.now();
          if (now - lastUpdate < 120 && loaded < file.size) return;
          lastUpdate = now;
          patch(id, { loaded });
        },
        controller.signal,
      );
      settle(id, 'done', { loaded: file.size });
    } catch (err) {
      if (controller.signal.aborted) settle(id, 'canceled');
      else settle(id, 'error', { error: fileErrorMessage(err, i18n.t, item.name) });
    } finally {
      controllers.delete(id);
      pendingFiles.delete(id);
      pump();
    }
  };

  const pump = () => {
    const uploads = get().uploads;
    let running = uploads.filter((item) => item.status === 'preparing' || item.status === 'conflict' || item.status === 'uploading').length;
    for (const item of uploads) {
      if (running >= MAX_PARALLEL_UPLOADS) break;
      if (item.status === 'queued') {
        running++;
        void run(item.id);
      }
    }
  };

  return {
    uploads: [],
    conflictId: null,

    enqueueUploads: (target, files, maxUploadBytes) => {
      const batchId = `batch-${nextId++}`;
      const nonAsciiNames: string[] = [];
      const items: UploadItem[] = files.map((file) => {
        const id = newId();
        // A name the server would refuse anyway is turned away here, where it costs nothing
        const problem = checkFileName(file.name);
        let status: UploadStatus = 'queued';
        let error: string | undefined;
        if (problem) {
          status = 'error';
          error = pathProblemMessage(problem, i18n.t);
        } else if (maxUploadBytes !== undefined && file.size > maxUploadBytes) {
          status = 'error';
          error = i18n.t('pages.files.errors.tooLargeFor', { size: formatBytes(maxUploadBytes) });
        } else {
          pendingFiles.set(id, file);
          if (hasNonAscii(file.name)) nonAsciiNames.push(file.name);
        }
        return {
          id,
          batchId,
          ...target,
          path: joinRepositoryPath(target.directory, file.name),
          name: file.name,
          size: file.size,
          loaded: 0,
          status,
          error,
        };
      });

      batches.set(batchId, { remaining: items.length, done: 0, skipped: 0, failed: 0, canceled: 0 });
      set((state) => ({ uploads: [...state.uploads, ...items] }));
      // Whatever was turned away above is finished before it started
      for (const item of items) {
        if (item.status === 'error') settle(item.id, 'error', { error: item.error });
      }
      if (nonAsciiNames.length > 0) warnNonAscii(nonAsciiNames);
      pump();
    },

    resolveConflict: (decision, applyToAll) => {
      const answer = answerConflict;
      answerConflict = null;
      set({ conflictId: null });
      answer?.(decision, applyToAll);
    },

    cancelUpload: (id) => {
      const item = get().uploads.find((candidate) => candidate.id === id);
      if (!item || isFinished(item.status)) return;
      if (item.status === 'queued') {
        pendingFiles.delete(id);
        settle(id, 'canceled');
        return;
      }
      controllers.get(id)?.abort();
      // An upload waiting on the dialog has to be let go of, or the queue behind it never moves
      if (get().conflictId === id) get().resolveConflict('skip', false);
    },

    clearFinished: () => set((state) => ({ uploads: state.uploads.filter((item) => !isFinished(item.status)) })),
  };
});

// A TeamSpeak client can fail to download a file whose name has umlauts or other
// non-ASCII characters ("file not found") even where the server accepted the upload
// - reproduced with the official client alone - so say so before the file goes up.
// Only a hint: the upload still runs.
const NON_ASCII_NAMES_SHOWN = 3;
const NON_ASCII_NAME_LENGTH = 48;

function warnNonAscii(names: string[]) {
  const t = i18n.t.bind(i18n);
  const shown = names
    .slice(0, NON_ASCII_NAMES_SHOWN)
    .map((name) => (name.length > NON_ASCII_NAME_LENGTH ? `${name.slice(0, NON_ASCII_NAME_LENGTH - 1)}…` : name))
    .join(', ');
  toast.warning(t('pages.files.nonAsciiWarning.title'), {
    description: t('pages.files.nonAsciiWarning.description', {
      count: names.length,
      names: names.length > NON_ASCII_NAMES_SHOWN ? `${shown}, …` : shown,
    }),
    duration: 12000,
  });
}

function announce(batch: Batch) {
  const t = i18n.t.bind(i18n);
  const parts: string[] = [];
  if (batch.done) parts.push(t('pages.files.transfers.summaryUploaded', { count: batch.done }));
  if (batch.skipped) parts.push(t('pages.files.transfers.summarySkipped', { count: batch.skipped }));
  if (batch.failed) parts.push(t('pages.files.transfers.summaryFailed', { count: batch.failed }));
  if (batch.canceled) parts.push(t('pages.files.transfers.summaryCanceled', { count: batch.canceled }));
  const message = parts.join(', ');
  if (batch.failed) toast.error(message);
  else if (batch.done) toast.success(message);
  else toast.info(message);
}

// Closing or reloading the tab would cut every running upload off mid-file
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    const busy = useTransfers.getState().uploads.some((item) => !isFinished(item.status));
    if (busy) event.preventDefault();
  });
}
