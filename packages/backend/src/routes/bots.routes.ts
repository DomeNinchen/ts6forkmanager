import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { grantCovers, grantOf, type Grant } from '../utils/vs-access.js';

export const botRoutes: Router = Router();

/**
 * Bot Flows aren't mounted under /api/servers/:configId (see app.ts), so
 * they don't get the requireServerAccess middleware other per-server
 * resources do. Same check, applied manually once the target
 * serverConfigId is known (from the request body for create, or looked up
 * from the existing row for everything else). A flow runs on one virtual
 * server, so the grant has to cover that one too (utils/vs-access.ts).
 */
async function assertServerAccess(req: Request, prisma: any, serverConfigId: number, virtualServerId: number): Promise<void> {
  if (req.user!.role === 'admin') return;
  const grant = await grantOf(prisma, req.user!.id, serverConfigId);
  if (!grant) throw new AppError(403, 'No access to this server');
  if (!grantCovers(grant, virtualServerId)) throw new AppError(403, 'No access to this virtual server');
}

botRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const isAdmin = req.user!.role === 'admin';
    const all = await prisma.botFlow.findMany({
      where: isAdmin ? undefined : {
        serverConfig: { userAccess: { some: { userId: req.user!.id } } },
      },
      include: { _count: { select: { executions: { where: { status: { not: 'dropped' } } } } } },
      orderBy: { id: 'asc' },
    });
    const grants = new Map<number, Grant | null>();
    for (const id of new Set<number>(all.map((b: any) => b.serverConfigId))) {
      grants.set(id, isAdmin ? null : await grantOf(prisma, req.user!.id, id));
    }
    const bots = isAdmin ? all : all.filter((b: any) => grantCovers(grants.get(b.serverConfigId) ?? null, b.virtualServerId));
    // Triggers dropped at the concurrency limit, one row per flow, trigger type and minute (see BotEngine.recordDrop).
    const dropRows = await prisma.botExecution.findMany({
      where: { status: 'dropped', startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, flowId: { in: bots.map((b: any) => b.id) } },
      select: { flowId: true, triggerData: true },
    });
    const dropped = new Map<number, number>();
    for (const row of dropRows) {
      const count = Number(JSON.parse(row.triggerData || '{}').dropped) || 0;
      dropped.set(row.flowId, (dropped.get(row.flowId) || 0) + count);
    }
    res.json(bots.map((b: any) => ({
      id: b.id, name: b.name, description: b.description,
      serverConfigId: b.serverConfigId, virtualServerId: b.virtualServerId,
      enabled: b.enabled, createdAt: b.createdAt, updatedAt: b.updatedAt,
      executionCount: b._count.executions,
      droppedLast24h: dropped.get(b.id) || 0,
    })));
  } catch (err) { next(err); }
});

// The flow list above is what the Dashboard shows every role. A single flow's
// full definition (flowData: node settings, webhook paths, message texts), its
// executions and their logs are only read by the Bot Flows editor, which is open
// to admins and bot operators - not to viewers or music operators.
botRoutes.get('/:botId', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const bot = await prisma.botFlow.findUnique({ where: { id: parseInt(String(req.params.botId)) } });
    if (!bot) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, bot.serverConfigId, bot.virtualServerId);
    res.json({
      ...bot,
      flowData: JSON.parse(bot.flowData),
    });
  } catch (err) { next(err); }
});

botRoutes.post('/', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const { name, description, serverConfigId, virtualServerId, flowData } = req.body;

    const parsedConfigId = parseInt(serverConfigId);
    if (!name || isNaN(parsedConfigId)) {
      return res.status(400).json({ error: 'Name and valid serverConfigId are required' });
    }
    const parsedSid = parseInt(virtualServerId) || 1;
    await assertServerAccess(req, prisma, parsedConfigId, parsedSid);

    // Verify server config exists
    const serverConfig = await prisma.tsServerConfig.findUnique({ where: { id: parsedConfigId } });
    if (!serverConfig) {
      return res.status(400).json({ error: `Server config ${parsedConfigId} does not exist` });
    }

    const bot = await prisma.botFlow.create({
      data: {
        name, description,
        serverConfigId: parsedConfigId,
        virtualServerId: parsedSid,
        flowData: flowData ? JSON.stringify(flowData) : '{"nodes":[],"edges":[]}',
      },
    });
    res.status(201).json({ id: bot.id, name: bot.name });
  } catch (err) { next(err); }
});

botRoutes.put('/:botId', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const botId = parseInt(String(req.params.botId));
    const existing = await prisma.botFlow.findUnique({ where: { id: botId } });
    if (!existing) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, existing.serverConfigId, existing.virtualServerId);

    const data: any = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.flowData !== undefined) data.flowData = JSON.stringify(req.body.flowData);
    if (req.body.serverConfigId !== undefined) data.serverConfigId = parseInt(req.body.serverConfigId);
    if (req.body.virtualServerId !== undefined) data.virtualServerId = parseInt(req.body.virtualServerId);
    if (data.serverConfigId !== undefined || data.virtualServerId !== undefined) {
      // Moving it: they need access to where it goes, too.
      await assertServerAccess(req, prisma, data.serverConfigId ?? existing.serverConfigId, data.virtualServerId ?? existing.virtualServerId);
    }

    const bot = await prisma.botFlow.update({
      where: { id: botId },
      data,
    });

    // Notify bot engine of flow update
    const botEngine = req.app.locals.botEngine;
    if (botEngine) await botEngine.reloadFlow(botId);

    res.json({ id: bot.id, name: bot.name });
  } catch (err) { next(err); }
});

botRoutes.delete('/:botId', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const botId = parseInt(String(req.params.botId));
    const existing = await prisma.botFlow.findUnique({ where: { id: botId } });
    if (!existing) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, existing.serverConfigId, existing.virtualServerId);

    // Disable in engine before deleting
    const botEngine = req.app.locals.botEngine;
    if (botEngine) await botEngine.disableFlow(botId);

    await prisma.botFlow.delete({ where: { id: botId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

botRoutes.post('/:botId/enable', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const botId = parseInt(String(req.params.botId));
    const existing = await prisma.botFlow.findUnique({ where: { id: botId } });
    if (!existing) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, existing.serverConfigId, existing.virtualServerId);

    await prisma.botFlow.update({ where: { id: botId }, data: { enabled: true } });

    // Enable in bot engine
    const botEngine = req.app.locals.botEngine;
    if (botEngine) await botEngine.enableFlow(botId);

    res.json({ enabled: true });
  } catch (err) { next(err); }
});

botRoutes.post('/:botId/disable', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const botId = parseInt(String(req.params.botId));
    const existing = await prisma.botFlow.findUnique({ where: { id: botId } });
    if (!existing) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, existing.serverConfigId, existing.virtualServerId);

    await prisma.botFlow.update({ where: { id: botId }, data: { enabled: false } });

    // Disable in bot engine
    const botEngine = req.app.locals.botEngine;
    if (botEngine) await botEngine.disableFlow(botId);

    res.json({ enabled: false });
  } catch (err) { next(err); }
});

botRoutes.get('/:botId/executions', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const flowId = parseInt(String(req.params.botId));
    const flow = await prisma.botFlow.findUnique({ where: { id: flowId } });
    if (!flow) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, flow.serverConfigId, flow.virtualServerId);

    const executions = await prisma.botExecution.findMany({
      where: { flowId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      // A waiting execution's variables (stored WebQuery results, HTTP answers) can be large; the list shows none of them.
      omit: { state: true, createdChannels: true },
    });
    res.json(executions);
  } catch (err) { next(err); }
});

botRoutes.get('/:botId/executions/:execId/logs', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const flowId = parseInt(String(req.params.botId));
    const flow = await prisma.botFlow.findUnique({ where: { id: flowId } });
    if (!flow) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, flow.serverConfigId, flow.virtualServerId);

    const logs = await prisma.botExecutionLog.findMany({
      // flowId too: the access check above is for this flow, so another flow's execution must not be readable through it.
      where: { executionId: parseInt(String(req.params.execId)), execution: { flowId } },
      orderBy: { timestamp: 'asc' },
    });
    res.json(logs);
  } catch (err) { next(err); }
});
