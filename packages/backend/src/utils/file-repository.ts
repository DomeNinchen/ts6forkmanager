import { randomBytes } from 'crypto';
import type { Application } from 'express';
import { joinRepositoryPath, normalizeFileDatetime, splitRepositoryPath, type ServerFileEntry } from '@ts6/common';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import { sshExecuteFor, toSshAppError } from './ssh-query.js';
import {
  FtInitError,
  allocateClientFtfid,
  parseFtTicket,
  resolveFileTransferHost,
  type FtTicket,
} from '../ts-client/file-transfer.js';
import { TicketStore } from './ticket-store.js';
import type { ArchivePlan } from './folder-archive.js';

// Everything the Files routes need to talk to one channel's file repository over
// the shared SSH ServerQuery connection: listing, asking for transfer tickets,
// and cleaning up.

/** One channel's file repository on one virtual server. */
export interface RepositoryScope {
  app: Application;
  configId: number;
  sid: number;
  cid: number;
}

/** An upload that the server has already agreed to (`ftinitupload` answered
 * with a ticket) and that is waiting for its bytes to arrive. The bytes go to
 * `tempPath`, not to `path` - see {@link completeUpload}. */
export interface UploadSession {
  userId: number;
  configId: number;
  sid: number;
  cid: number;
  /** Where the file is meant to end up. */
  path: string;
  /** Where the bytes are written first. */
  tempPath: string;
  size: number;
  /** Whether an existing file at `path` may be replaced. */
  overwrite: boolean;
  host: string;
  port: number;
  ftkey: string;
  /** When the server handed out the ticket (ms since the epoch) - see {@link TICKET_FRESH_MS}. */
  issuedAt: number;
  /** Fires when nobody ever sends the body, to remove the temp file; cleared once the body arrives. */
  cleanupTimer?: NodeJS.Timeout;
}

/**
 * A transfer ticket is only good for a few seconds: on a real TS6 server one
 * that waited 5 s was still honoured, one that waited 10 s was not, and the
 * transfer connection then simply closes without taking a byte. The body of an
 * upload usually follows the request that agreed it at once, but a reverse proxy
 * that collects the whole body before passing it on delivers it only after the
 * browser has sent every byte - far too late. A ticket older than this is
 * replaced by a fresh one when the body finally arrives.
 */
export const TICKET_FRESH_MS = 3000;

/** A download the admin has asked for and been given a link to. The transfer
 * ticket itself is requested from the server only when the link is opened, so
 * it is fresh at the moment the bytes start to flow. */
export interface DownloadLink {
  userId: number;
  configId: number;
  sid: number;
  cid: number;
  path: string;
  /** What the browser saves it as: the file's name, or `<folder>.zip`. */
  name: string;
  /**
   * `path` is a folder, to be streamed as a ZIP, and this is what is in it: walked
   * when the link was made, which is also what told the browser how large the
   * download is. Walking a folder costs a command per sub-folder (about 45 ms each
   * on a local test server), so the click that opens the link goes by this and does
   * not do it again; a file that changed within the minute the link lives for ends
   * the download, as one that changes while it streams does anyway.
   */
  archive?: ArchivePlan;
}

// The browser follows up a `POST .../uploads` with the file body straight away,
// but a reverse proxy that collects the whole body before passing it on delivers
// it only after the browser has sent every byte - for a large file on a slow line
// that takes a while. So an upload session lives as long as the longest request
// body is allowed to take (see middleware/request-timeout.ts); one nobody ever
// redeems is cleaned up when it runs out. Downloads are opened by a click that
// follows the link request immediately, so a minute covers a slow page.
export const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;
export const uploadSessions = new TicketStore<UploadSession>(UPLOAD_SESSION_TTL_MS);
export const downloadLinks = new TicketStore<DownloadLink>(60_000);

async function getServerHost(app: Application, configId: number): Promise<string> {
  const config = await app.locals.prisma.tsServerConfig.findUnique({
    where: { id: configId },
    select: { host: true },
  });
  if (!config) throw new AppError(404, 'Server config not found');
  return config.host;
}

/** Normalize `ftgetfilelist` rows. The server reports `type=0` for a directory
 * and `type=1` for a file (verified live), `datetime` in whatever unit its
 * build uses. */
export function parseFileListRows(rows: Record<string, string>[]): ServerFileEntry[] {
  return rows
    .filter((row) => row.name)
    .map((row) => ({
      name: row.name,
      size: row.type === '0' ? 0 : Number(row.size) || 0,
      modified: normalizeFileDatetime(row.datetime),
      isDirectory: row.type === '0',
    }));
}

export async function listDirectory(scope: RepositoryScope, path: string, channelPassword = ''): Promise<ServerFileEntry[]> {
  try {
    const rows = await sshExecuteFor(scope.app, scope.configId, scope.sid, 'ftgetfilelist', {
      cid: scope.cid,
      cpw: channelPassword,
      path,
    });
    return parseFileListRows(rows);
  } catch (err: any) {
    // 1281 = database_empty_result: an empty directory, not a failure
    if (err instanceof TSApiError && err.code === 1281) return [];
    throw err;
  }
}

export interface PathStat {
  /** `null` when nothing is there. */
  kind: 'file' | 'directory' | null;
  /** Bytes; 0 unless it is a file. */
  size: number;
}

/**
 * What is at `path`? One cheap `ftgetfileinfo` instead of listing the parent
 * directory. A real TS6 server answers 2051 for a path that does not exist and
 * 2048 ("invalid file name") for a directory, and returns the size for a file;
 * the TS3 manual shows a `type` field there instead, so that is honoured too.
 *
 * It also refuses a name the server cannot store with 2054 ("invalid file
 * path") - verified live for umlauts and CJK characters on a Linux TS6 server -
 * which surfaces here as an error, long before any bytes have been sent.
 */
export async function statPath(scope: RepositoryScope, path: string): Promise<PathStat> {
  try {
    const rows = await sshExecuteFor(scope.app, scope.configId, scope.sid, 'ftgetfileinfo', {
      cid: scope.cid,
      cpw: '',
      name: path,
    });
    const row = rows[0];
    if (row?.type === '0') return { kind: 'directory', size: 0 };
    return { kind: 'file', size: Number(row?.size) || 0 };
  } catch (err: any) {
    if (err instanceof TSApiError) {
      if (err.code === 2051) return { kind: null, size: 0 };
      if (err.code === 2048) return { kind: 'directory', size: 0 };
    }
    throw err;
  }
}

export interface InitiatedTransfer {
  ticket: FtTicket;
  host: string;
}

/** Ask for an upload ticket. The only thing ever uploaded directly is a temp file
 * under a fresh random name (see {@link tempUploadPath}), never an existing file,
 * because `ftinitupload` with `overwrite=1` empties an existing file right away,
 * before a single byte of the new one has arrived. `replaceTemp` is for asking
 * again for a temp file this app created itself, whose first ticket ran out. */
export async function initUpload(
  scope: RepositoryScope,
  path: string,
  size: number,
  replaceTemp = false,
): Promise<InitiatedTransfer> {
  const rows = await sshExecuteFor(scope.app, scope.configId, scope.sid, 'ftinitupload', {
    clientftfid: allocateClientFtfid(),
    name: path,
    cid: scope.cid,
    cpw: '',
    size,
    overwrite: replaceTemp ? 1 : 0,
    resume: 0,
  });
  const ticket = parseFtTicket(rows);
  if (ticket.seekpos !== 0) throw new FtInitError(0, 'The server asked to resume an upload that was not a resumed one');
  return { ticket, host: resolveFileTransferHost(ticket.ip, await getServerHost(scope.app, scope.configId)) };
}

export async function initDownload(scope: RepositoryScope, path: string): Promise<InitiatedTransfer> {
  const rows = await sshExecuteFor(scope.app, scope.configId, scope.sid, 'ftinitdownload', {
    clientftfid: allocateClientFtfid(),
    name: path,
    cid: scope.cid,
    cpw: '',
    seekpos: 0,
  });
  const ticket = parseFtTicket(rows);
  return { ticket, host: resolveFileTransferHost(ticket.ip, await getServerHost(scope.app, scope.configId)) };
}

/** A name for the file an upload is written to while it is on its way: same
 * directory as the target (so the final rename stays inside one channel's
 * repository), random (so it never collides with anything), and short and plain
 * ASCII whatever the target is called. */
export function tempUploadPath(targetPath: string): string {
  const { directory } = splitRepositoryPath(targetPath);
  return joinRepositoryPath(directory, `.ts6m-upload-${randomBytes(6).toString('hex')}.part`);
}

/** Delete a path, ignoring any failure. A missing file is not one worth even a log line. */
export async function deleteQuietly(scope: RepositoryScope, path: string): Promise<void> {
  try {
    await sshExecuteFor(scope.app, scope.configId, scope.sid, 'ftdeletefile', { cid: scope.cid, cpw: '', name: path });
  } catch (err: any) {
    if (err instanceof TSApiError && err.code === 2051) return;
    console.warn(`[Files] Could not clean up ${path} in channel ${scope.cid}: ${err.message}`);
  }
}

/**
 * Throw away an upload that is not going to finish. The server creates the temp
 * file the moment it hands out the ticket, and keeps whatever bytes arrived even
 * when the transfer breaks off (1 MiB of a 5 MiB upload stayed behind as a
 * normal-looking file on a real TS6 server), so the file has to be deleted.
 *
 * The ticket itself is left to expire on its own: `ftstop` addresses a transfer
 * by an id the server reuses, so stopping "our" ticket after the fact could end
 * somebody else's transfer.
 */
export function cancelUpload(scope: RepositoryScope, tempPath: string): Promise<void> {
  return deleteQuietly(scope, tempPath);
}

/**
 * The bytes are in: check they are all there, then put the file under its real
 * name. The rename replaces an existing file in one step (verified live), so a
 * file being overwritten is only ever replaced by a complete one - an upload
 * that fails anywhere before this point leaves the old file exactly as it was.
 *
 * Throws, leaving the temp file for the caller to clean up, when anything is off.
 */
export async function completeUpload(scope: RepositoryScope, session: UploadSession): Promise<void> {
  const stored = await statPath(scope, session.tempPath);
  if (stored.kind !== 'file' || stored.size !== session.size) {
    throw new AppError(502, 'The server did not store the whole file', `${stored.size} of ${session.size} bytes arrived`);
  }

  // Someone may have put a file there since the upload was agreed to
  if (!session.overwrite && (await statPath(scope, session.path)).kind !== null) {
    throw new TSApiError(2050, 'file already exists');
  }

  await sshExecuteFor(scope.app, scope.configId, scope.sid, 'ftrenamefile', {
    cid: scope.cid,
    cpw: '',
    oldname: session.tempPath,
    newname: session.path,
  });
}

/** Turn a refused transfer into the API error the frontend expects: TeamSpeak's
 * own status code travels as `code`, the way every other TS error does. */
export function toTransferApiError(err: unknown): unknown {
  if (err instanceof FtInitError) {
    return err.status > 0 ? new TSApiError(err.status, err.message) : new AppError(502, err.message);
  }
  return err;
}

// What a socket reports when the transfer port cannot be reached at all
const UNREACHABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND']);

/**
 * Any failure of a file transfer as an error that reaches the client with its own
 * message. The API's own errors and TeamSpeak's (including "SSH is not configured")
 * pass through; anything else - a dropped connection, a short transfer - becomes a
 * failed transfer instead of the opaque "Internal server error" a bare Error would
 * turn into.
 *
 * The query connection and the transfer port are separate: the first can work
 * while the second (30033 by default) is closed to this app by a firewall or a
 * missing port mapping, which is worth saying in so many words.
 */
export function asTransferError(err: unknown): unknown {
  const converted = toSshAppError(toTransferApiError(err));
  if (converted instanceof AppError || converted instanceof TSApiError) return converted;
  const failure = converted as NodeJS.ErrnoException;
  if (UNREACHABLE.has(failure?.code ?? '')) {
    return new AppError(
      502,
      "The app could not reach the TeamSpeak server's file-transfer port (30033 by default) - is it open to this app?",
      failure.message,
    );
  }
  return new AppError(502, 'The file transfer failed', failure?.message);
}
