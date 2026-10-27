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
import type { WebQueryClient } from '../ts-client/webquery-client.js';
import {
  diffJson,
  snapshotRuleFor,
  takeSnapshot,
  type Snapshot,
  type SnapshotContext,
} from '../utils/change-log-snapshots.js';

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

function outcome(httpStatus: number, startedAt: number, errorMessage: string | null, loggedToTeamSpeak: boolean, changes: string | null): ChangeOutcome {
  const status = statusOf(httpStatus);
  return {
    status,
    httpStatus,
    errorMessage: status === 'ok' ? null : errorMessage,
    durationMs: Date.now() - startedAt,
    loggedToTeamSpeak,
    changes: status === 'ok' ? changes : null,
  };
}

/** The path segments below the area, decoded: what a snapshot rule finds its target by. */
function rawLeaf(url: string, area: string): string[] {
  const rest = url.split('?')[0].split('/').filter(Boolean).slice(1);
  const at = rest.indexOf(area, 2);
  return (at < 0 ? [] : rest.slice(at + 1)).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
}

type Before = { ctx: SnapshotContext; snap: Snapshot } | null;

/** Reads the target of a change before it runs (R6 stage 2). Never throws and never blocks longer than the snapshot timeout. */
async function readBefore(req: Request, prisma: PrismaClient, rule: NonNullable<ReturnType<typeof snapshotRuleFor>>, target: ChangeTarget): Promise<Before> {
  try {
    if (!(await getChangeLogSettings(prisma)).enabled) return null;
  } catch {
    return null;
  }
  let client: WebQueryClient | undefined;
  try {
    client = target.serverConfigId === null ? undefined : (req.app.locals.connectionPool as ConnectionPool | undefined)?.getClient(target.serverConfigId);
  } catch {
    client = undefined;
  }
  const ctx: SnapshotContext = {
    // Only read when there is a client; without one the rule is never asked (the snapshot is "unavailable").
    client: client as WebQueryClient,
    sid: target.virtualServerId ?? 0,
    leaf: rawLeaf(req.originalUrl, target.area),
    body: req.body && typeof req.body === 'object' ? req.body : {},
  };
  if (!client) return { ctx, snap: { ok: false, reason: 'no connection to this server' } };
  return { ctx, snap: await takeSnapshot(rule, ctx) };
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

  // Stage 2: the targets with a snapshot rule are read before they change. Only for an admin -
  // every such route is admin-only, so another role's attempt is turned away and costs the
  // TeamSpeak server no read. Everything else keeps its hot path untouched.
  const rule = req.user?.role === 'admin' ? snapshotRuleFor(req.method, target.routePattern) : undefined;
  const before: Promise<Before> = rule ? readBefore(req, prisma, rule, target) : Promise.resolve(null);
  const changesOf = async (httpStatus: number): Promise<string | null> => {
    if (!rule || httpStatus >= 400) return null;
    const b = await before;
    return b ? diffJson(rule, b.snap, b.ctx) : null;
  };

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
      await before;
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
          await finishChange(prisma, id, outcome(res.statusCode, startedAt, sentError, loggedToTeamSpeak, await changesOf(res.statusCode)));
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
      recordChange(prisma, { ...base, ...outcome(res.statusCode, startedAt, sentError, loggedToTeamSpeak, await changesOf(res.statusCode)) });
    })();
  });
  // A route with a snapshot rule waits for its read (at most the snapshot timeout); the rest goes on at once.
  if (rule) void before.then(() => next());
  else next();
}
