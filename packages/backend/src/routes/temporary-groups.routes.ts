import { Router, Request, Response } from 'express';
import {
  TEMP_GROUP_NOTICE_DEFAULTS,
  TEMP_GROUP_OPEN_STATES,
  noticeSettingsProblem,
  tempGroupDurationProblem,
  tempGroupExpiry,
  tempGroupExtendedExpiry,
  type TempGroupNoticeSettings,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { requirePermission, requireRole } from '../middleware/rbac.js';
import { getNoticeSettings, setNoticeSettings } from '../utils/temporary-group-notices.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import { targetIds } from '../utils/protected-groups.js';
import { applyRevokeResult, removeMembership, toTempGroupEntry } from '../utils/temporary-groups.js';

// Temporary server group memberships (R13): the same right as giving a group for good.
export const temporaryGroupRoutes: Router = Router({ mergeParams: true });

const HISTORY_MAX = 500;
const NOT_ASSIGNABLE = 'Clients cannot be put into this group (a default, query or template group, or it no longer exists)';
const OPEN = [...TEMP_GROUP_OPEN_STATES];

function scope(req: Request) {
  return {
    prisma: req.app.locals.prisma as PrismaClient,
    pool: req.app.locals.connectionPool as ConnectionPool,
    serverConfigId: parseInt(String(req.params.configId)),
    sid: parseInt(String(req.params.sid)),
  };
}

/** A deadline from the body: `durationMs` from now, or an absolute `expiresAt`. Both end within the allowed span. */
function expiryFrom(body: any, now: number): number {
  if (body?.durationMs !== undefined) {
    const problem = tempGroupDurationProblem(body.durationMs);
    if (problem) throw new AppError(400, problem);
    return tempGroupExpiry(now, body.durationMs);
  }
  const at = typeof body?.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
  if (Number.isNaN(at)) throw new AppError(400, 'Give durationMs or expiresAt (ISO 8601)');
  const problem = tempGroupDurationProblem(at - now);
  if (problem) throw new AppError(400, problem);
  return at;
}

/** The open row of this connection and virtual server, or 404. */
async function openRow(req: Request) {
  const { prisma, serverConfigId, sid } = scope(req);
  const [id] = targetIds([req.params.id], 'id');
  const row = await prisma.temporaryServerGroup.findFirst({ where: { id, serverConfigId, sid } });
  if (!row) throw new AppError(404, 'Temporary membership not found');
  if (!OPEN.includes(row.state as (typeof OPEN)[number])) throw new AppError(409, 'This membership has already ended', undefined, 'TEMP_GROUP_ENDED');
  return row;
}

// How clients hear about their deadline on this virtual server (stage 3). Admin only (his decision): the
// texts go out to clients in the name of the connection. Declared before '/:id' so it is not taken for an id.
temporaryGroupRoutes.get('/notice-settings', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    res.json({ settings: await getNoticeSettings(prisma, serverConfigId, sid), defaults: TEMP_GROUP_NOTICE_DEFAULTS });
  } catch (err) { next(err); }
});

temporaryGroupRoutes.put('/notice-settings', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const keys = Object.keys(TEMP_GROUP_NOTICE_DEFAULTS) as (keyof TempGroupNoticeSettings)[];
    const settings = Object.fromEntries(keys.map((k) => [k, req.body?.[k]])) as unknown as TempGroupNoticeSettings;
    const problem = noticeSettingsProblem(settings);
    if (problem) throw new AppError(400, problem);
    settings.warnBeforeMs = [...settings.warnBeforeMs].sort((a, b) => b - a);
    await setNoticeSettings(prisma, serverConfigId, sid, settings);
    res.json({ settings });
  } catch (err) { next(err); }
});

// ?scope=open (default) lists what is running, soonest first; ?scope=history what has ended, newest first.
temporaryGroupRoutes.get('/', requirePermission('groups.members'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const history = req.query.scope === 'history';
    const rows = await prisma.temporaryServerGroup.findMany({
      where: { serverConfigId, sid, state: history ? { notIn: OPEN } : { in: OPEN } },
      orderBy: history ? { endedAt: 'desc' } : { expiresAt: 'asc' },
      ...(history ? { take: HISTORY_MAX } : {}),
    });
    res.json(rows.map(toTempGroupEntry));
  } catch (err) { next(err); }
});

// Gives the group until a deadline. A client that is already in the group is refused unless the caller
// confirms with setDeadline: then the existing membership gets the deadline and ends with it.
temporaryGroupRoutes.post('/', requirePermission('groups.members'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, pool, serverConfigId, sid } = scope(req);
    const [sgid] = targetIds([req.body?.sgid], 'sgid');
    const [cldbid] = targetIds([req.body?.cldbid], 'cldbid');
    const expiresAt = new Date(expiryFrom(req.body, Date.now()));
    const setDeadline = req.body?.setDeadline === true;

    const existing = await prisma.temporaryServerGroup.findFirst({ where: { serverConfigId, sid, sgid, cldbid, state: { in: OPEN } } });
    if (existing) throw new AppError(409, 'This client already has a deadline for this group; change that one instead', undefined, 'TEMP_GROUP_EXISTS');

    const client = pool.getClient(serverConfigId);
    // Only a regular group that is not the default one can hold members. Checked first: servergroupsbyclientid
    // lists the default group for every client without a group, which would read as "already a member".
    const [serverInfo] = await client.execute(sid, 'serverinfo');
    const target = (await client.execute(sid, 'servergrouplist') as Array<{ sgid: string; type: string }>).find((g) => Number(g.sgid) === sgid);
    if (!target || Number(target.type) !== 1 || Number(serverInfo?.virtualserver_default_server_group) === sgid) {
      throw new AppError(400, NOT_ASSIGNABLE, undefined, 'GROUP_NOT_ASSIGNABLE');
    }
    let info: any;
    try {
      [info] = await client.execute(sid, 'clientdbinfo', { cldbid });
    } catch (err) {
      if (err instanceof TSApiError && err.code === 512) throw new AppError(404, 'No client with this database id', undefined, 'CLIENT_NOT_FOUND');
      throw err;
    }
    const groups: Array<{ sgid: string }> = await client.execute(sid, 'servergroupsbyclientid', { cldbid });
    const isMember = groups.some((g) => Number(g.sgid) === sgid);
    if (isMember && !setDeadline) {
      throw new AppError(409, 'The client is already a permanent member of this group. Set a deadline on that membership instead, it then ends with it.', undefined, 'ALREADY_MEMBER');
    }

    // The row comes first: a crash right after it leaves a row whose removal finds nothing to remove,
    // never a membership nobody remembers to end.
    const row = await prisma.temporaryServerGroup.create({
      data: {
        serverConfigId, sid, sgid, cldbid,
        clientUid: String(info.client_unique_identifier),
        clientNickname: String(info.client_nickname ?? ''),
        expiresAt, nextAttemptAt: expiresAt,
        grantedByUserId: req.user?.id ?? null, grantedBy: req.user?.username ?? 'unknown',
        via: 'main', wasMember: isMember,
      },
    });
    if (!isMember) {
      try {
        await client.execute(sid, 'servergroupaddclient', { sgid, cldbid });
      } catch (err) {
        await prisma.temporaryServerGroup.delete({ where: { id: row.id } });
        // 2561: someone added the client between the check and the add - the same as a member.
        if (err instanceof TSApiError && err.code === 2561) {
          throw new AppError(409, 'The client is already a permanent member of this group. Set a deadline on that membership instead, it then ends with it.', undefined, 'ALREADY_MEMBER');
        }
        // Measured: 2564 for the default group and the query groups, 2560 for a template or deleted group
        // (here only if the group changed since the check above).
        if (err instanceof TSApiError && (err.code === 2564 || err.code === 2560)) {
          throw new AppError(400, NOT_ASSIGNABLE, undefined, 'GROUP_NOT_ASSIGNABLE');
        }
        throw err;
      }
    }
    res.status(201).json(toTempGroupEntry(row));
  } catch (err) { next(err); }
});

// Moves the deadline: { extendByMs } adds to it (from the current expiry while that lies ahead,
// otherwise from now), { expiresAt } or { durationMs } sets it anew - also earlier.
temporaryGroupRoutes.put('/:id', requirePermission('groups.members'), async (req: Request, res: Response, next) => {
  try {
    const { prisma } = scope(req);
    const row = await openRow(req);
    const now = Date.now();
    let expiry: number;
    if (req.body?.extendByMs !== undefined) {
      const problem = tempGroupDurationProblem(req.body.extendByMs);
      if (problem) throw new AppError(400, problem);
      expiry = tempGroupExtendedExpiry(row.expiresAt.getTime(), now, req.body.extendByMs);
      const total = tempGroupDurationProblem(expiry - now);
      if (total) throw new AppError(400, total);
    } else {
      expiry = expiryFrom(req.body, now);
    }
    const expiresAt = new Date(expiry);
    const { count } = await prisma.temporaryServerGroup.updateMany({
      where: { id: row.id, state: { in: OPEN } },
      // A new deadline starts the warnings over; one still waiting for the client was about the old one.
      data: { expiresAt, nextAttemptAt: expiresAt, state: 'active', error: null, attempts: 0, deadlineSetAt: new Date(), warnedBeforeMin: null, pendingNotice: null },
    });
    if (count === 0) throw new AppError(409, 'This membership has already ended', undefined, 'TEMP_GROUP_ENDED');
    res.json(toTempGroupEntry((await prisma.temporaryServerGroup.findUniqueOrThrow({ where: { id: row.id } }))));
  } catch (err) { next(err); }
});

// Drops the deadline: the membership stays in TeamSpeak, the row goes to the history.
temporaryGroupRoutes.post('/:id/permanent', requirePermission('groups.members'), async (req: Request, res: Response, next) => {
  try {
    const { prisma } = scope(req);
    const row = await openRow(req);
    const { count } = await prisma.temporaryServerGroup.updateMany({
      where: { id: row.id, state: { in: OPEN } },
      data: { state: 'permanent', error: null, nextAttemptAt: null, endedAt: new Date(), pendingNotice: null },
    });
    if (count === 0) throw new AppError(409, 'This membership has already ended', undefined, 'TEMP_GROUP_ENDED');
    res.json(toTempGroupEntry((await prisma.temporaryServerGroup.findUniqueOrThrow({ where: { id: row.id } }))));
  } catch (err) { next(err); }
});

// Takes the group away now, the same way the job does when the time is up (a failure is kept and retried).
temporaryGroupRoutes.post('/:id/revoke', requirePermission('groups.members'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, pool } = scope(req);
    const row = await openRow(req);
    const updated = await applyRevokeResult(prisma, row, await removeMembership(pool, row));
    if (!updated) throw new AppError(409, 'This membership has already ended', undefined, 'TEMP_GROUP_ENDED');
    res.json(toTempGroupEntry(updated));
  } catch (err) { next(err); }
});
