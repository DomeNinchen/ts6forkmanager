import { Router, Request, Response } from 'express';
import {
  PREVIEW_MAX_BYTES,
  checkRepositoryPath,
  splitRepositoryPath,
  type FileTransferLimits,
  type RepositoryPathProblem,
} from '@ts6/common';
import { config } from '../config.js';
import { requireRole } from '../middleware/rbac.js';
import { allowSlowBody } from '../middleware/request-timeout.js';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import { sshExecute, toSshAppError } from '../utils/ssh-query.js';
import { ftDownloadBytes, ftUploadStream } from '../ts-client/file-transfer.js';
import { MAX_PREVIEW_PIXELS, sniffImage } from '../utils/image-sniff.js';
import { planFolderArchive } from '../utils/folder-archive.js';
import {
  TICKET_FRESH_MS,
  UPLOAD_SESSION_TTL_MS,
  asTransferError,
  cancelUpload,
  completeUpload,
  downloadLinks,
  initDownload,
  initUpload,
  listDirectory,
  statPath,
  tempUploadPath,
  uploadSessions,
  type RepositoryScope,
  type UploadSession,
} from '../utils/file-repository.js';

export const fileRoutes: Router = Router({ mergeParams: true });

// The Files page is admin-only, and so is everything behind it: browsing a
// channel's file repository, and above all moving bytes in and out of it, is
// not something the other roles get to do through the API either.
fileRoutes.use(requireRole('admin'));

const PROBLEM_TEXT: Record<RepositoryPathProblem, string> = {
  empty: 'it is empty',
  'not-absolute': 'it must start with "/"',
  'control-character': 'it contains control characters',
  backslash: 'it contains a backslash',
  'slash-in-name': 'a name contains "/"',
  'empty-segment': 'it contains an empty segment ("//" or a trailing "/")',
  'dot-segment': 'it contains a "." or ".." segment',
  'name-too-long': 'a file or folder name is longer than 255 bytes',
  'path-too-long': 'the path is too long',
};

/** A path from the request body or query, checked before it gets anywhere
 * near a ServerQuery command. */
function requirePath(value: unknown, label: string, allowRoot = false): string {
  if (typeof value !== 'string') throw new AppError(400, `${label} must be a string`);
  const problem = checkRepositoryPath(value, { allowRoot });
  if (problem) throw new AppError(400, `Invalid ${label}: ${PROBLEM_TEXT[problem]}`);
  return value;
}

function parseChannelId(value: unknown, label: string): number {
  const cid = Number(value);
  // cid 0 is the virtual server's own repository (icons, avatars), not a channel's
  if (!Number.isInteger(cid) || cid < 1) throw new AppError(400, `Invalid ${label}`);
  return cid;
}

function scopeOf(req: Request): RepositoryScope {
  return {
    app: req.app,
    configId: parseInt(String(req.params.configId), 10),
    sid: parseInt(String(req.params.sid), 10),
    cid: parseChannelId(req.params.cid, 'channel ID'),
  };
}

// The limits the app itself enforces - registered before "/:cid", which would
// otherwise swallow "limits" as a channel ID.
fileRoutes.get('/limits', (_req: Request, res: Response) => {
  const limits: FileTransferLimits = {
    maxUploadBytes: config.filesMaxUploadBytes,
    previewMaxBytes: PREVIEW_MAX_BYTES,
  };
  res.json(limits);
});

// List files in a channel directory
// Uses shared SSH connection because ft* commands are not supported via WebQuery HTTP
fileRoutes.get('/:cid', async (req: Request, res: Response, next) => {
  try {
    const path = requirePath(req.query.path ?? '/', 'path', true);
    res.json(await listDirectory(scopeOf(req), path, String(req.query.cpw || '')));
  } catch (err) {
    next(toSshAppError(err));
  }
});

// Create directory
fileRoutes.post('/:cid/mkdir', async (req: Request, res: Response, next) => {
  try {
    const result = await sshExecute(req, 'ftcreatedir', {
      cid: scopeOf(req).cid,
      cpw: '',
      dirname: requirePath(req.body?.dirname, 'directory name'),
    });
    res.json(result);
  } catch (err) { next(toSshAppError(err)); }
});

// Make sure a whole tree of folders exists - what a folder upload needs before its
// files go up. ftcreatedir makes one level at a time (no parents), so each one is
// created parents first. On a real TS6 server it answers 2050 for a folder that is
// already there - fine, that is what was wanted - but with plain success, and no
// folder, when a FILE of that name is there (verified live), so every answer is
// checked against what is really at the path afterwards. Every folder gets its own
// answer, so the files of one that could not be made (a name the server cannot
// store, a file in the way) can be turned away while the rest of the upload goes
// on; the children of a folder that failed are not even tried.
const MAX_MKDIRS = 2000;

interface MkdirResult {
  dirname: string;
  ok: boolean;
  /** Whether this call made it, as opposed to finding it there. */
  created?: boolean;
  /** TeamSpeak's own status code, when it refused. */
  code?: number;
  error?: string;
}

fileRoutes.post('/:cid/mkdirs', async (req: Request, res: Response, next) => {
  try {
    const scope = scopeOf(req);
    const list = req.body?.dirnames;
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MKDIRS) {
      throw new AppError(400, `dirnames must be a list of 1 to ${MAX_MKDIRS} folders`);
    }
    // Parents before children, whatever order they came in
    const dirnames = [...new Set<string>(list.map((value) => requirePath(value, 'directory name')))]
      .sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0));

    const results: MkdirResult[] = [];
    const failed: string[] = [];
    for (const dirname of dirnames) {
      if (failed.some((bad) => dirname.startsWith(`${bad}/`))) {
        results.push({ dirname, ok: false, error: 'Its parent folder could not be created' });
        continue;
      }
      let code: number | undefined;
      let error: string;
      try {
        let created = true;
        try {
          await sshExecute(req, 'ftcreatedir', { cid: scope.cid, cpw: '', dirname });
        } catch (err) {
          // 2050: something of that name is there already - a folder is what was wanted
          if (!(err instanceof TSApiError) || err.code !== 2050) throw err;
          created = false;
        }
        const found = await statPath(scope, dirname);
        if (found.kind === 'directory') {
          results.push({ dirname, ok: true, created });
          continue;
        }
        code = found.kind === 'file' ? 2050 : undefined;
        error = found.kind === 'file' ? 'file already exists' : 'The folder was not created';
      } catch (err) {
        if (!(err instanceof TSApiError)) throw err; // not an answer of TeamSpeak's (SSH down ...): the whole request fails
        code = err.code;
        error = err.message;
      }
      failed.push(dirname);
      results.push({ dirname, ok: false, code, error });
    }
    res.json({ results });
  } catch (err) {
    next(asTransferError(err));
  }
});

// Delete file
fileRoutes.delete('/:cid/file', async (req: Request, res: Response, next) => {
  try {
    const result = await sshExecute(req, 'ftdeletefile', {
      cid: scopeOf(req).cid,
      cpw: '',
      name: requirePath(req.body?.name, 'file name'),
    });
    res.json(result);
  } catch (err) { next(toSshAppError(err)); }
});

// Move a file to another channel's file repository - ftrenamefile does this
// entirely server-side (no byte transfer through us) when tcid is given.
fileRoutes.post('/:cid/move', async (req: Request, res: Response, next) => {
  try {
    const name = requirePath(req.body?.name, 'file name');
    const result = await sshExecute(req, 'ftrenamefile', {
      cid: scopeOf(req).cid,
      cpw: '',
      tcid: parseChannelId(req.body?.targetCid, 'target channel ID'),
      tcpw: '',
      oldname: name,
      newname: name,
    });
    res.json(result);
  } catch (err) { next(toSshAppError(err)); }
});

// Upload, step 1: agree on the file. Everything that can be refused - a name the
// server will not take, a file that is already there, a missing permission -
// comes back as a normal error answer *before* the browser has sent a single
// byte of the file. Step 2 is the PUT below.
//
// The bytes are not written to the target name but to a temp file next to it,
// which is renamed into place once everything has arrived. Writing straight to
// the target is not an option: `ftinitupload` empties an existing file the
// moment it hands out the ticket, so an upload that breaks off would destroy
// the file it was meant to replace.
fileRoutes.post('/:cid/uploads', async (req: Request, res: Response, next) => {
  try {
    const scope = scopeOf(req);
    const path = requirePath(req.body?.path, 'path');
    const size = req.body?.size;
    if (!Number.isSafeInteger(size) || size < 0) throw new AppError(400, 'size must be a whole number of bytes');
    if (size > config.filesMaxUploadBytes) {
      throw new AppError(
        413,
        'The file is larger than the maximum upload size',
        `${size} bytes, the limit is ${config.filesMaxUploadBytes} bytes (FILES_MAX_UPLOAD_MB)`,
      );
    }
    const overwrite = req.body?.overwrite === true;

    const target = await statPath(scope, path);
    if (target.kind === 'directory') throw new AppError(409, 'A folder with this name already exists');
    // Reported the way TeamSpeak itself reports it, so the frontend has one code to ask about
    if (target.kind === 'file' && !overwrite) throw new TSApiError(2050, 'file already exists');

    const tempPath = tempUploadPath(path);
    const { ticket, host } = await initUpload(scope, tempPath, size);
    const session: UploadSession = {
      userId: req.user!.id,
      configId: scope.configId,
      sid: scope.sid,
      cid: scope.cid,
      path,
      tempPath,
      size,
      overwrite,
      host,
      port: ticket.port,
      ftkey: ticket.ftkey,
      issuedAt: Date.now(),
    };
    const uploadId = uploadSessions.issue(session);

    // Nobody may ever send the bytes (browser closed, connection dropped), yet the
    // server has already created the - empty - temp file. Clear it away once the
    // session has run out; `drop` only finds a session nobody redeemed.
    session.cleanupTimer = setTimeout(() => {
      if (uploadSessions.drop(uploadId)) void cancelUpload(scope, tempPath);
    }, UPLOAD_SESSION_TTL_MS + 2000);
    session.cleanupTimer.unref();

    res.status(201).json({ uploadId });
  } catch (err) {
    next(asTransferError(err));
  }
});

// Upload, step 2: the file's bytes, as the raw request body. They go straight
// through to the server's transfer port without being held in memory or on
// disk, so the file size is limited by the agreed upload limit and nothing else.
fileRoutes.put('/:cid/uploads/:uploadId', async (req: Request, res: Response, next) => {
  let scope: RepositoryScope;
  try {
    scope = scopeOf(req);
  } catch (err) {
    return next(err);
  }

  // Look before redeeming: a request that merely names somebody else's session
  // must not use it up.
  const token = String(req.params.uploadId);
  const pending = uploadSessions.peek(token);
  if (
    !pending ||
    pending.userId !== req.user!.id ||
    pending.configId !== scope.configId ||
    pending.sid !== scope.sid ||
    pending.cid !== scope.cid
  ) {
    // The body is not going to be read, so do not keep the connection around for reuse
    res.setHeader('Connection', 'close');
    return next(new AppError(404, 'This upload has expired or does not exist - start it again'));
  }
  const session = uploadSessions.take(token)!;
  clearTimeout(session.cleanupTimer);

  if (req.headers['content-length'] !== String(session.size)) {
    await cancelUpload(scope, session.tempPath);
    res.setHeader('Connection', 'close');
    return next(new AppError(400, `The request body must be exactly ${session.size} bytes, as announced`));
  }

  // The caller and the session are both vouched for: a slow line may take its time
  allowSlowBody(req);

  try {
    let { host, port, ftkey } = session;
    if (Date.now() - session.issuedAt > TICKET_FRESH_MS) {
      // The body arrived too late for the ticket it was agreed with (a proxy that
      // collects it first): ask for another one for the same temp file
      const fresh = await initUpload(scope, session.tempPath, session.size, true);
      ({ host } = fresh);
      ({ port, ftkey } = fresh.ticket);
    }
    await ftUploadStream(host, port, ftkey, req, session.size);
    await completeUpload(scope, session);
    res.status(201).json({ path: session.path, size: session.size });
  } catch (err) {
    console.warn(`[Files] Upload of ${session.path} to channel ${scope.cid} failed: ${(err as Error)?.message}`);
    // Whatever arrived before the failure sits in the temp file, not under the real name
    await cancelUpload(scope, session.tempPath);
    // Nobody left to tell if the browser cancelled the upload
    if (res.headersSent || res.destroyed || !res.writable) return;
    // Let the browser finish sending so it can read our answer
    req.resume();
    next(asTransferError(err));
  }
});

// Download, step 1: check the file is there and hand out a link for it. The link
// is a one-time ticket the browser can simply open, which lets it stream the file
// straight to disk itself - a request that has to carry an Authorization header
// could only ever be collected in memory by a script first.
//
// A folder gets a link too: opening it streams the folder as a ZIP. The folder is
// walked here already, so one that cannot become a ZIP (too many files, more than
// 4 GiB) is refused now, with a message, rather than failing in the browser's
// download list.
fileRoutes.post('/:cid/download-links', async (req: Request, res: Response, next) => {
  try {
    const scope = scopeOf(req);
    const path = requirePath(req.body?.path, 'path');
    const stat = await statPath(scope, path);
    if (stat.kind === null) throw new AppError(404, 'File not found');

    const { name: baseName } = splitRepositoryPath(path);
    const archive = stat.kind === 'directory';
    const plan = archive ? await planFolderArchive(scope, path) : null;
    const name = archive ? `${baseName}.zip` : baseName;
    const token = downloadLinks.issue({
      userId: req.user!.id,
      configId: scope.configId,
      sid: scope.sid,
      cid: scope.cid,
      path,
      name,
      archive: plan ?? undefined,
    });
    res.status(201).json({
      url: `/api/file-downloads/${token}`,
      name,
      size: plan ? plan.bytes : stat.size,
      ...(plan ? { files: plan.files, folders: plan.folders } : {}),
    });
  } catch (err) {
    next(asTransferError(err));
  }
});

// Preview: the image itself, for the Files page's preview dialog. A small file is
// read into memory, recognised by its own bytes (see utils/image-sniff.ts) and
// handed over as the image type found there - or refused. Nothing that is not one
// of the five browser image formats ever leaves this route, so an SVG or HTML file
// a channel member put there is never served inline, whatever it is called.
//
// Each preview reads a whole file over the file-transfer port. One person flicking
// through pictures needs a couple at a time at most; the cap keeps a flood of
// requests from using up the TeamSpeak server's small pool of transfer tickets.
const MAX_CONCURRENT_PREVIEWS = 4;
let previewsRunning = 0;

fileRoutes.get('/:cid/preview', async (req: Request, res: Response, next) => {
  let holdsSlot = false;
  try {
    const scope = scopeOf(req);
    const path = requirePath(req.query.path, 'path');

    const stat = await statPath(scope, path);
    if (stat.kind === null) throw new AppError(404, 'File not found');
    if (stat.kind === 'directory') throw new AppError(400, 'A folder cannot be previewed');
    if (stat.size === 0) throw new AppError(415, 'The file is empty');
    const tooLarge = (bytes: number) =>
      new AppError(413, 'The file is too large to preview', `${bytes} bytes, the limit is ${PREVIEW_MAX_BYTES} bytes`);
    if (stat.size > PREVIEW_MAX_BYTES) throw tooLarge(stat.size);

    // Whatever was refused above never took a slot
    if (previewsRunning >= MAX_CONCURRENT_PREVIEWS) throw new AppError(429, 'Too many previews at once, try again in a moment');
    previewsRunning++;
    holdsSlot = true;

    const { ticket, host } = await initDownload(scope, path);
    // The size above was read a moment ago; the file may have been replaced since
    if (ticket.size === 0 || ticket.size > PREVIEW_MAX_BYTES) throw tooLarge(ticket.size);
    const data = await ftDownloadBytes(host, ticket.port, ticket.ftkey, ticket.size);

    const image = sniffImage(data);
    if (!image) throw new AppError(415, 'This file is not an image the preview can show');
    if (image.width * image.height > MAX_PREVIEW_PIXELS) {
      throw new AppError(
        413,
        'The picture is too large to preview',
        `${image.width} x ${image.height} pixels, the limit is ${MAX_PREVIEW_PIXELS / 1_000_000} megapixels`,
      );
    }

    res.setHeader('Content-Type', image.type);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Even a picture is somebody else's file: should a browser ever be pointed at
    // this URL itself, nothing in it may run or load anything
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(data);
  } catch (err) {
    next(asTransferError(err));
  } finally {
    if (holdsSlot) previewsRunning--;
  }
});
