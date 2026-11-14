import express, { type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { recordRateLimitHit } from '../utils/connection-journal.js';
import { webhookSettings } from '../utils/webhook-settings.js';

// The engine answers 404 for an unknown path and for a wrong secret alike; that is a failed call.
const failed = (_req: Request, res: Response) => res.statusCode !== 404;

/**
 * Everything in front of the webhook handler: two per-address limits (failed calls strict,
 * valid ones generous, counted apart) and a JSON parser with the webhook's own size limit,
 * which refuses a too-large body with 413 from its Content-Length before reading it. Mounted
 * ahead of the app-wide parser, so that one never sees a webhook body.
 */
export function webhookIngress(): RequestHandler[] {
  const failedLimiter = rateLimit({
    windowMs: 60_000,
    limit: () => webhookSettings().failedPerMinute,
    skipSuccessfulRequests: true,
    requestWasSuccessful: failed,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many failed webhook calls, please try again later' },
    handler: (req, res, _next, options) => {
      recordRateLimitHit(req, 'webhook-limit');
      res.status(options.statusCode).send(options.message);
    },
  });
  const validLimiter = rateLimit({
    windowMs: 60_000,
    limit: () => webhookSettings().validPerMinute,
    skipFailedRequests: true,
    requestWasSuccessful: failed,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many webhook calls, please try again later' },
  });

  // express.json fixes its limit when it is made; a new one is made when the setting changes.
  let parser: RequestHandler | null = null;
  let parserLimitKb = 0;
  const json: RequestHandler = (req, res, next) => {
    const { bodyLimitKb } = webhookSettings();
    // body-parser would refuse this too, but only after reading (and dropping) the whole body;
    // answering at once and closing the connection keeps a large upload from tying it up.
    if (Number(req.headers['content-length']) > bodyLimitKb * 1024) {
      res.status(413).set('Connection', 'close').json({ error: 'Request body is too large' });
      return;
    }
    if (!parser || parserLimitKb !== bodyLimitKb) {
      parser = express.json({ limit: bodyLimitKb * 1024 });
      parserLimitKb = bodyLimitKb;
    }
    parser(req, res, next);
  };

  return [failedLimiter, validLimiter, json];
}
