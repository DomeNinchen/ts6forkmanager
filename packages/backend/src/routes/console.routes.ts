import { Router, Request, Response } from 'express';
import type { ConsoleAuditStatus, ConsoleErrorBody } from '@ts6/common';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { listAudit } from '../console/audit.js';
import { executeConsoleCommand } from '../console/execute.js';
import { getConsoleSettings } from '../utils/console-settings.js';

/**
 * The admin query console: run any ServerQuery command over the server's normal
 * WebQuery connection, and read back the audit trail of what was run.
 *
 * Admin only, and unlike the bot-flow "webquery" action it deliberately does not
 * use bot-engine/command-whitelist.ts - that list keeps automation away from
 * destructive commands, while here an admin is expected to be able to run them.
 * The safety net is different: dangerous commands need a typed confirmation
 * (console/execute.ts), secrets are kept out of the audit trail, and every
 * command sent is recorded with the user who sent it.
 */
export const consoleRoutes: Router = Router({ mergeParams: true });

consoleRoutes.use(requireRole('admin'));

function sendError(res: Response, httpStatus: number, body: ConsoleErrorBody): void {
  if (body.retryAfterMs !== undefined) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(body.retryAfterMs / 1000))));
  }
  res.status(httpStatus).json(body);
}

consoleRoutes.post('/execute', async (req: Request, res: Response, next) => {
  try {
    const configId = parseInt(String(req.params.configId));
    const { sid, line, confirm } = (req.body ?? {}) as { sid?: unknown; line?: unknown; confirm?: unknown };

    if (!Number.isInteger(sid) || (sid as number) < 0) {
      return sendError(res, 400, { code: 'INVALID_REQUEST', error: 'sid must be a whole number, 0 or higher' });
    }
    if (typeof line !== 'string') {
      return sendError(res, 400, { code: 'INVALID_REQUEST', error: 'line must be a string' });
    }
    if (confirm !== undefined && typeof confirm !== 'string') {
      return sendError(res, 400, { code: 'INVALID_REQUEST', error: 'confirm must be a string' });
    }

    const prisma = req.app.locals.prisma;
    const pool: ConnectionPool = req.app.locals.connectionPool;
    if (!pool.hasClient(configId)) {
      return sendError(res, 404, { code: 'NO_CONNECTION', error: 'This server has no active WebQuery connection' });
    }
    const server = await prisma.tsServerConfig.findUnique({ where: { id: configId }, select: { name: true } });
    if (!server) throw new AppError(404, 'Server not found');

    const outcome = await executeConsoleCommand({
      prisma,
      pool,
      user: { id: req.user!.id, username: req.user!.username },
      configId,
      serverName: server.name,
      sid: sid as number,
      line,
      confirm,
      settings: await getConsoleSettings(prisma),
    });

    if (!outcome.ok) return sendError(res, outcome.httpStatus, outcome.body);
    res.json(outcome.response);
  } catch (err) { next(err); }
});

const AUDIT_STATUSES: readonly ConsoleAuditStatus[] = ['pending', 'ok', 'error'];

// The audit trail, newest first. Not scoped to the server in the URL unless asked to be:
// it is an admin's overview of everything the console did, on every server.
consoleRoutes.get('/log', async (req: Request, res: Response, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50')) || 50));
    const beforeRaw = req.query.before !== undefined ? parseInt(String(req.query.before)) : undefined;
    const status = String(req.query.status ?? '');
    const search = String(req.query.search ?? '').trim();

    res.json(await listAudit(req.app.locals.prisma, {
      limit,
      before: beforeRaw !== undefined && Number.isInteger(beforeRaw) ? beforeRaw : undefined,
      serverConfigId: req.query.thisServer === '1' ? parseInt(String(req.params.configId)) : undefined,
      status: (AUDIT_STATUSES as readonly string[]).includes(status) ? (status as ConsoleAuditStatus) : undefined,
      dangerOnly: req.query.dangerOnly === '1',
      search: search || undefined,
    }));
  } catch (err) { next(err); }
});
