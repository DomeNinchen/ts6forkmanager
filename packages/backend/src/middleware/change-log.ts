import type { Request, Response, NextFunction } from 'express';
import type { UiChangeMethod, UiChangeStatus } from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { classifyChange, type ChangeTarget } from './change-log-policy.js';
import { clientIpOf } from '../utils/connection-journal.js';
import { getChangeLogSettings } from '../utils/change-log-settings.js';
import {
  finishChange,
  maskChangeBody,
  recordChange,
  startChange,
  type ChangeBase,
  type ChangeOutcome,
} from '../utils/change-log.js';
import { buildLogMessage, writeTeamSpeakLog } from '../console/ts-log.js';

/**
 * 403 is a change the role check turned away. Everything else from 4xx up failed - including a
 * 401 from a handler that checked a password itself (switching off 2FA with the wrong one).
 */
function statusOf(httpStatus: number): Exclude<UiChangeStatus, 'pending'> {
  if (httpStatus === 403) return 'denied';
  return httpStatus < 400 ? 'ok' : 'error';
}

/** Best effort: a second line in the TeamSpeak server log for a server-bound change, when the admin asked for it. */
async function writeTsLog(req: Request, base: ChangeBase): Promise<boolean> {
  if (base.serverConfigId === null) return false;
  try {
    const pool = req.app.locals.connectionPool as ConnectionPool | undefined;
    const client = pool?.getClient(base.serverConfigId);
    if (!client) return false;
    return await writeTeamSpeakLog(client, base.virtualServerId ?? 1, buildLogMessage(base.username, `${base.method} ${base.routePattern}`));
  } catch {
    return false;
  }
}

function outcome(httpStatus: number, startedAt: number, errorMessage: string | null, loggedToTeamSpeak: boolean): ChangeOutcome {
  const status = statusOf(httpStatus);
  return {
    status,
    httpStatus,
    errorMessage: status === 'ok' ? null : errorMessage,
    durationMs: Date.now() - startedAt,
    loggedToTeamSpeak,
  };
}

/**
 * Records every change a web user makes through the interface (R6). Mounted right after the
 * global login check, so it covers every writing request without touching the ~200 handlers,
 * and once more in front of the /api/auth router, whose routes sign the caller in themselves
 * (see app.ts). Security-critical areas are written before they run and refused if that write
 * fails (fail-closed); everything else is recorded after the response, off the hot path, the
 * way the connection journal writes.
 */
export function changeLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  // A request that passes both mounts (an unknown /api/auth path falling through) is recorded once.
  if (res.locals.changeLogSeen) return next();
  const decision = classifyChange(req.method, req.originalUrl);
  if (decision.kind !== 'log') return next();
  const prisma = req.app.locals.prisma as PrismaClient | undefined;
  if (!prisma) return next();
  res.locals.changeLogSeen = true;

  const target: ChangeTarget = decision.target;
  const startedAt = Date.now();
  const maskedBody = maskChangeBody(req.body);

  // Remember the error the handler (or the error handler) sends, so a failed change says why -
  // with TeamSpeak's own reason and code where there is one ("TeamSpeak API Error: invalid channelID (768)").
  let sentError: string | null = null;
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const b = body as { error?: unknown; details?: unknown; code?: unknown } | null;
    if (b && typeof b === 'object' && typeof b.error === 'string') {
      sentError = `${b.error}${typeof b.details === 'string' && b.details ? `: ${b.details}` : ''}${b.code !== undefined ? ` (${String(b.code)})` : ''}`;
    }
    return originalJson(body);
  };

  const baseOf = (user: NonNullable<Request['user']>, ip: string | null): ChangeBase => ({
    createdAt: new Date(startedAt),
    userId: user.id ?? null,
    username: user.username,
    role: user.role,
    ip,
    method: req.method as UiChangeMethod,
    area: target.area,
    routePattern: target.routePattern,
    serverConfigId: target.serverConfigId,
    virtualServerId: target.virtualServerId,
    targetId: target.targetId,
    body: maskedBody,
  });

  if (target.critical) {
    // Every critical area sits behind the global login check, so the caller is known here.
    const user = req.user;
    if (!user) return next();
    // Fail-closed: write the pending row first, and do not run the change if it cannot be written.
    void (async () => {
      let settings;
      try {
        settings = await getChangeLogSettings(prisma);
      } catch {
        // Settings unreadable: not a reason to hold the change back; the row write below decides.
        settings = null;
      }
      if (settings && !settings.enabled) return next();
      const base = baseOf(user, settings?.recordIp === false ? null : clientIpOf(req));
      let id: number;
      try {
        id = await startChange(prisma, base);
      } catch (err) {
        return next(err); // AppError(500): the change is refused.
      }
      res.on('finish', () => {
        void (async () => {
          const loggedToTeamSpeak = settings?.writeToTsLog && res.statusCode < 400 ? await writeTsLog(req, base) : false;
          await finishChange(prisma, id, outcome(res.statusCode, startedAt, sentError, loggedToTeamSpeak));
        })();
      });
      next();
    })();
    return;
  }

  // Everything else: nothing on the hot path, the row is written once the response is out. The
  // caller is read then too - the /api/auth routes only sign them in inside their router.
  res.on('finish', () => {
    const user = req.user;
    if (!user) return;
    void (async () => {
      let settings;
      try {
        settings = await getChangeLogSettings(prisma);
      } catch {
        return;
      }
      if (!settings.enabled) return;
      const base = baseOf(user, settings.recordIp ? clientIpOf(req) : null);
      const loggedToTeamSpeak = settings.writeToTsLog && res.statusCode < 400 ? await writeTsLog(req, base) : false;
      recordChange(prisma, { ...base, ...outcome(res.statusCode, startedAt, sentError, loggedToTeamSpeak) });
    })();
  });
  next();
}
