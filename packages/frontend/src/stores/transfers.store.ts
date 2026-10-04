import { create } from 'zustand';
import { toast } from 'sonner';
import { checkFileName, checkRepositoryPath, joinRepositoryPath, splitRepositoryPath } from '@ts6/common';
import i18n from '@/lib/i18n';
import { formatBytes } from '@/lib/utils';
import { filesApi } from '@/api/files.api';
import { fileErrorMessage, folderErrorMessage, isAlreadyExists, pathProblemMessage } from '@/lib/file-errors';
import { foldersNeeded, type PickedItem } from '@/lib/upload-tree';

// Uploads to a channel's file repository, kept outside any page so they keep
// running - and their progress keeps counting - while you look at another
// page of the app. Only a reload or closing the tab stops them, and the
// browser asks before doing that for as long as something is still going.

export type UploadStatus =
  /** Waiting for a free place in the line */
  | 'queued'
  /** Waiting for the folders it goes into to be made (a folder upload) */
  | 'folders'
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
  /** The folder the upload was started in - the one the file list was showing. */
  root: string;
  /** Directory the file goes into (with a folder upload, below `root`); a listing showing it is refreshed when the upload is done. */
  directory: string;
  /** Full path the file ends up at. */
  path: string;
  /** What the list calls it: the file's name, or its path below `root` when it comes from a folder. */
  name: string;
  /** A folder with nothing in it, which is made rather than uploaded. */
  folder?: boolean;
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
  /**
   * Starts uploading what the upload window collected. The `segments` of each
   * source are the names it is stored under, below `target.directory` - the
   * folders it sits in first, its own name last - and a source without a `file`
   * is a folder with nothing in it. Every folder it needs is made first.
   */
  enqueueUploads: (target: UploadTarget, sources: PickedItem[], maxUploadBytes?: number) => void;
  resolveConflict: (decision: ConflictDecision, applyToAll: boolean) => void;
  cancelUpload: (id: string) => void;
  clearFinished: () => void;
}

// The server only hands out a handful of transfer tickets at a time (around ten
// on a real TS6 server, shared with every other client using file transfer), so
// a long queue is worked through a couple of files at once, not all at once.
const MAX_PARALLEL_UPLOADS = 2;
// Folders are made this many to a request, parents before children
const FOLDERS_PER_REQUEST = 500;

const FINISHED: UploadStatus[] = ['done', 'skipped', 'error', 'canceled'];
const isFinished = (status: UploadStatus) => FINISHED.includes(status);
/** Not started yet, so cancelling it only has to take it out of the line. */
const isWaiting = (status: UploadStatus) => status === 'queued' || status === 'folders';

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
  /** Folders with nothing in them that were made. */
  folders: number;
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
      if (status === 'done') {
        if (item.folder) batch.folders++;
        else batch.done++;
      } else if (status === 'skipped') batch.skipped++;
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

  /**
   * Makes the folders of a folder upload, parents before children, and then lets
   * what was waiting for them go on. A folder that cannot be made - a name the
   * server cannot store, a file of that name in the way - takes everything in it
   * with it: those files fail with the reason, the rest of the upload carries on.
   */
  const makeFolders = async (batchId: string, target: UploadTarget, folders: string[][]) => {
    const paths = folders.map((names) => joinRepositoryPath(target.directory, names.join('/')));
    const made = new Set<string>();
    const failed = new Map<string, string>();

    /**
     * Why a folder cannot be used: it, or one above it, could not be made. The
     * topmost one that failed is the cause - those below it were only skipped.
     */
    const blockedBy = (path: string) => {
      let reason: string | undefined;
      for (let dir = path; dir.length > target.directory.length; dir = splitRepositoryPath(dir).directory) {
        reason = failed.get(dir) ?? reason;
      }
      return reason;
    };

    try {
      for (let from = 0; from < paths.length; from += FOLDERS_PER_REQUEST) {
        // Nothing is made below a folder that failed; the server would only refuse it as well
        const chunk = paths.slice(from, from + FOLDERS_PER_REQUEST).filter((path) => !blockedBy(path));
        if (chunk.length === 0) continue;
        const results = await filesApi.ensureDirectories(target.configId, target.sid, target.cid, chunk);
        for (const result of results) {
          if (result.ok) made.add(result.dirname);
          else failed.set(result.dirname, folderErrorMessage(result, i18n.t));
        }
      }
    } catch (err) {
      // The request itself failed (server unreachable, not allowed to ...): what it had not reported on is unknown
      const reason = fileErrorMessage(err, i18n.t);
      for (const path of paths) {
        if (!made.has(path) && !failed.has(path)) failed.set(path, reason);
      }
    }

    const waiting = get().uploads.filter((item) => item.batchId === batchId && item.status === 'folders');
    const go = new Set<string>();
    for (const item of waiting) {
      const reason = blockedBy(item.folder ? item.path : item.directory);
      if (reason) settle(item.id, 'error', { error: reason });
      else if (item.folder) settle(item.id, 'done');
      else go.add(item.id);
    }
    // Anything cancelled while the folders were being made has settled already and stays so
    set((state) => ({
      uploads: state.uploads.map((item) => (go.has(item.id) && item.status === 'folders' ? { ...item, status: 'queued' } : item)),
    }));
    pump();
  };

  return {
    uploads: [],
    conflictId: null,

    enqueueUploads: (target, sources, maxUploadBytes) => {
      const batchId = `batch-${nextId++}`;
      const items: UploadItem[] = sources.map(({ file, segments }) => {
        const id = newId();
        const name = segments.join('/');
        const path = joinRepositoryPath(target.directory, name);
        // A name the server would refuse anyway is turned away here, where it costs nothing
        const problem = segments.map((segment) => checkFileName(segment)).find((found) => found !== null) ?? checkRepositoryPath(path);
        let status: UploadStatus = 'queued';
        let error: string | undefined;
        if (problem) {
          status = 'error';
          error = pathProblemMessage(problem, i18n.t);
        } else if (file && maxUploadBytes !== undefined && file.size > maxUploadBytes) {
          status = 'error';
          error = i18n.t('pages.files.errors.tooLargeFor', { size: formatBytes(maxUploadBytes) });
        } else {
          if (file) pendingFiles.set(id, file);
          // A file of a folder (or a folder) waits until its folders exist
          if (segments.length > 1 || !file) status = 'folders';
        }
        return {
          id,
          batchId,
          ...target,
          root: target.directory,
          directory: splitRepositoryPath(path).directory,
          path,
          name,
          folder: file ? undefined : true,
          size: file?.size ?? 0,
          loaded: 0,
          status,
          error,
        };
      });

      batches.set(batchId, { remaining: items.length, done: 0, folders: 0, skipped: 0, failed: 0, canceled: 0 });
      set((state) => ({ uploads: [...state.uploads, ...items] }));
      // Whatever was turned away above is finished before it started
      for (const item of items) {
        if (item.status === 'error') settle(item.id, 'error', { error: item.error });
      }

      // Only for what is still going to be uploaded: a folder whose every file was turned away is not made
      const folders = foldersNeeded(sources.filter((_, index) => items[index].status !== 'error'));
      if (folders.length > 0) {
        makeFolders(batchId, target, folders).catch((err) => {
          // Not expected - but whatever is still waiting for its folders must not wait for ever
          const reason = fileErrorMessage(err, i18n.t);
          for (const item of get().uploads) {
            if (item.batchId === batchId && item.status === 'folders') settle(item.id, 'error', { error: reason });
          }
        });
      }
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
      if (isWaiting(item.status)) {
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

function announce(batch: Batch) {
  const t = i18n.t.bind(i18n);
  const parts: string[] = [];
  if (batch.done) parts.push(t('pages.files.transfers.summaryUploaded', { count: batch.done }));
  if (batch.folders) parts.push(t('pages.files.transfers.summaryFolders', { count: batch.folders }));
  if (batch.skipped) parts.push(t('pages.files.transfers.summarySkipped', { count: batch.skipped }));
  if (batch.failed) parts.push(t('pages.files.transfers.summaryFailed', { count: batch.failed }));
  if (batch.canceled) parts.push(t('pages.files.transfers.summaryCanceled', { count: batch.canceled }));
  const message = parts.join(', ');
  if (batch.failed) toast.error(message);
  else if (batch.done || batch.folders) toast.success(message);
  else toast.info(message);
}

// Closing or reloading the tab would cut every running upload off mid-file
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    const busy = useTransfers.getState().uploads.some((item) => !isFinished(item.status));
    if (busy) event.preventDefault();
  });
}
