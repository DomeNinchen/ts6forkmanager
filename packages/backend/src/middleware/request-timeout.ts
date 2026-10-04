import type { Request, Response, NextFunction } from 'express';

// Node's own `server.requestTimeout` drops any request that takes longer than
// five minutes to arrive in full. That is the right defence against connections
// that dribble a body forever, but it is also where a large file upload from a
// slow line would be cut off midway. Raising it for the whole server would hand
// the same hour to every anonymous request, so the server-wide timeout is turned
// off (see index.ts) and applied here instead, per request: five minutes for
// everything, and only a route that has already authenticated the caller can ask
// for more with {@link allowSlowBody}.

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const SLOW_BODY_TIMEOUT_MS = 60 * 60 * 1000;

const timers = new WeakMap<Request, NodeJS.Timeout>();

function arm(req: Request, ms: number): void {
  clearTimeout(timers.get(req));
  const timer = setTimeout(() => {
    // Only a request still waiting for its body is cut off - a response that takes
    // long (a download, a stream) is a different matter and never was covered
    if (!req.complete) req.destroy();
  }, ms);
  timer.unref();
  timers.set(req, timer);
}

export function requestTimeout(req: Request, res: Response, next: NextFunction): void {
  arm(req, DEFAULT_REQUEST_TIMEOUT_MS);
  res.once('close', () => clearTimeout(timers.get(req)));
  next();
}

/** Give this request - whose caller the route has already authenticated - up to
 * an hour to deliver its body instead of five minutes. */
export function allowSlowBody(req: Request): void {
  arm(req, SLOW_BODY_TIMEOUT_MS);
}
