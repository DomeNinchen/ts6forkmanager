import { Request, Response, NextFunction } from 'express';

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

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error(`[Error] ${err.name}: ${err.message}`);

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
