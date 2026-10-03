import { Router, Request, Response } from 'express';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import { toSshAppError } from '../utils/ssh-query.js';
import { ftDownloadStream } from '../ts-client/file-transfer.js';
import { downloadLinks, initDownload, toTransferApiError } from '../utils/file-repository.js';

// Redeems the one-time links handed out by `POST .../files/:cid/download-links`.
//
// Mounted *before* the authentication middleware on purpose: a browser
// following a plain link cannot send an Authorization header, so the link
// itself is the credential - 256 random bits, good for a minute, and gone after
// one use. Who may create such a link, for which file, was decided when it was
// created; nothing else can be asked for through here.
export const fileDownloadRoutes: Router = Router();

fileDownloadRoutes.get('/:token', async (req: Request, res: Response, next) => {
  try {
    const link = downloadLinks.take(String(req.params.token));
    if (!link) throw new AppError(404, 'This download link has expired or was already used');

    // The link outlives the click that created it by up to a minute; the account
    // behind it should not.
    const user = await req.app.locals.prisma.user.findUnique({
      where: { id: link.userId },
      select: { enabled: true, role: true },
    });
    if (!user?.enabled || user.role !== 'admin') throw new AppError(403, 'Insufficient permissions');

    const scope = { app: req.app, configId: link.configId, sid: link.sid, cid: link.cid };
    const { ticket, host } = await initDownload(scope, link.path);

    // Always a download, never something the browser may render: a file in a
    // channel is whatever a user of the server put there, HTML and SVG included.
    res.attachment(link.name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(ticket.size));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    try {
      await ftDownloadStream(host, ticket.port, ticket.ftkey, ticket.size, res);
    } catch (err) {
      // Bytes are already on their way: the only honest way to say "this did
      // not work" is to cut the connection, so the browser reports a failed
      // download instead of saving a truncated file.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // The error answer is JSON; none of the download headers may leak into it
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Type');
      throw err;
    }
  } catch (err) {
    if (res.headersSent) return;
    const converted = toSshAppError(toTransferApiError(err));
    next(
      converted instanceof AppError || converted instanceof TSApiError
        ? converted
        : new AppError(502, 'The file transfer failed', (converted as Error)?.message),
    );
  }
});
