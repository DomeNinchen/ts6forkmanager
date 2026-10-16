import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: string,
    /** Machine-readable reason a client can branch on (e.g. a BotFailureKind) */
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Something asked for a server connection's WebQuery client while the pool has
 * none for it (the connection is disabled, was deleted, or has no API key - a
 * connection without query access). A 409 with a readable message rather than
 * the anonymous 500 a plain Error turns into.
 */
export class ConnectionUnavailableError extends AppError {
  constructor(public readonly configId: number) {
    super(409, 'The query connection for this server is not active (the server connection is disabled, or it has no WebQuery API key)', undefined, 'CONNECTION_UNAVAILABLE');
    this.name = 'ConnectionUnavailableError';
  }
}

export class TSApiError extends Error {
  constructor(
    public code: number,
    message: string,
    /** The permission TeamSpeak names as the one that was missing, when it says so
     * (WebQuery adds `failed_permission` to a 2568 "insufficient client permissions"). */
    public failedPermission?: string,
  ) {
    super(message);
    this.name = 'TSApiError';
  }
}

/** Short answers for the request bodies express.json() turns away; its own messages quote the parser. */
const BODY_ERROR_MESSAGES: Record<string, string> = {
  'entity.parse.failed': 'Request body is not valid JSON',
  'entity.too.large': 'Request body is too large',
};

/**
 * The 4xx status of an error express.json() raised for a body it cannot take (malformed JSON,
 * over the size limit, an unsupported charset, ...) - the client's mistake, not a server fault.
 * body-parser marks every one of them with a string `type` and a 4xx `status`.
 */
function bodyErrorStatus(err: Error): number | undefined {
  const { type, status } = err as Error & { type?: unknown; status?: unknown };
  return typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

export function errorHandler(err: Error, _req: Request, res: Response, next: NextFunction) {
  // The answer has started already: only Express's own handler can still end it (it closes the connection)
  if (res.headersSent) return next(err);

  const bodyStatus = bodyErrorStatus(err);
  if (bodyStatus) {
    // Logged without the parser's message: that one quotes the body, which can be a password
    const type = (err as Error & { type: string }).type;
    console.error(`[Error] Unreadable request body: ${type} (${bodyStatus})`);
    res.status(bodyStatus).json({ error: BODY_ERROR_MESSAGES[type] ?? 'Invalid request body' });
    return;
  }

  console.error(`[Error] ${err.name}: ${err.message}`);

  // An upload the client got wrong (too large, wrong field, too many files) - multer's messages are fixed texts
  if (err instanceof multer.MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message, code: err.code });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  if (err instanceof TSApiError) {
    res.status(502).json({
      error: 'TeamSpeak API Error',
      code: err.code,
      details: err.message,
      ...(err.failedPermission ? { failedPermission: err.failedPermission } : {}),
    });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
}
