import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';

export const botRoutes: Router = Router();

/**
 * Bot Flows aren't mounted under /api/servers/:configId (see app.ts), so
 * they don't get the requireServerAccess middleware other per-server
 * resources do. Same check, applied manually once the target
 * serverConfigId is known (from the request body for create, or looked up
 * from the existing row for everything else).
 */
async function assertServerAccess(req: Request, prisma: any, serverConfigId: number): Promise<void> {
  if (req.user!.role === 'admin') return;
  const access = await prisma.userServerAccess.findUnique({
    where: { userId_serverConfigId: { userId: req.user!.id, serverConfigId } },
  });
  if (!access) throw new AppError(403, 'No access to this server');
}

botRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const bots = await prisma.botFlow.findMany({
      where: req.user!.role === 'admin' ? undefined : {
        serverConfig: { userAccess: { some: { userId: req.user!.id } } },
      },
      include: { _count: { select: { executions: true } } },
      orderBy: { id: 'asc' },
    });
    res.json(bots.map((b: any) => ({
      id: b.id, name: b.name, description: b.description,
      serverConfigId: b.serverConfigId, virtualServerId: b.virtualServerId,
      enabled: b.enabled, createdAt: b.createdAt, updatedAt: b.updatedAt,
      executionCount: b._count.executions,
    })));
  } catch (err) { next(err); }
});

botRoutes.get('/:botId', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const bot = await prisma.botFlow.findUnique({ where: { id: parseInt(String(req.params.botId)) } });
    if (!bot) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, bot.serverConfigId);
    res.json({
      ...bot,
      flowData: JSON.parse(bot.flowData),
    });
  } catch (err) { next(err); }
});

botRoutes.post('/', requireRole('admin', 'bot-operator'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const { name, description, serverConfigId, virtualServerId, flowData } = req.body;

    const parsedConfigId = parseInt(serverConfigId);
    if (!name || isNaN(parsedConfigId)) {
      return res.status(400).json({ error: 'Name and valid serverConfigId are required' });
    }
    await assertServerAccess(req, prisma, parsedConfigId);

    // Verify server config exists
    const serverConfig = await prisma.tsServerConfig.findUnique({ where: { id: parsedConfigId } });
    if (!serverConfig) {
      return res.status(400).json({ error: `Server config ${parsedConfigId} does not exist` });
    }

    const bot = await prisma.botFlow.create({
      data: {
        name, description,
        serverConfigId: parsedConfigId,
        virtualServerId: parseInt(virtualServerId) || 1,
        flowData: flowData ? JSON.stringify(flowData) : '{"nodes":[],"edges":[]}',
      },
    });
    res.status(201).json({ id: bot.id, name: bot.name });
  } catch (err) { next(err); }
});

botRoutes.put('/:botId', requireRole('admin', 'bot-operator'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const botId = parseInt(String(req.params.botId));
    const existing = await prisma.botFlow.findUnique({ where: { id: botId } });
    if (!existing) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, existing.serverConfigId);

    const data: any = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.flowData !== undefined) data.flowData = JSON.stringify(req.body.flowData);
    if (req.body.serverConfigId !== undefined) {
      data.serverConfigId = parseInt(req.body.serverConfigId);
      await assertServerAccess(req, prisma, data.serverConfigId); // moving it to a server they also need access to
    }
    if (req.body.virtualServerId !== undefined) data.virtualServerId = parseInt(req.body.virtualServerId);

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

botRoutes.delete('/:botId', requireRole('admin', 'bot-operator'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const botId = parseInt(String(req.params.botId));
    const existing = await prisma.botFlow.findUnique({ where: { id: botId } });
    if (!existing) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, existing.serverConfigId);

    // Disable in engine before deleting
    const botEngine = req.app.locals.botEngine;
    if (botEngine) await botEngine.disableFlow(botId);

    await prisma.botFlow.delete({ where: { id: botId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

botRoutes.post('/:botId/enable', requireRole('admin', 'bot-operator'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const botId = parseInt(String(req.params.botId));
    const existing = await prisma.botFlow.findUnique({ where: { id: botId } });
    if (!existing) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, existing.serverConfigId);

    await prisma.botFlow.update({ where: { id: botId }, data: { enabled: true } });

    // Enable in bot engine
    const botEngine = req.app.locals.botEngine;
    if (botEngine) await botEngine.enableFlow(botId);

    res.json({ enabled: true });
  } catch (err) { next(err); }
});

botRoutes.post('/:botId/disable', requireRole('admin', 'bot-operator'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const botId = parseInt(String(req.params.botId));
    const existing = await prisma.botFlow.findUnique({ where: { id: botId } });
    if (!existing) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, existing.serverConfigId);

    await prisma.botFlow.update({ where: { id: botId }, data: { enabled: false } });

    // Disable in bot engine
    const botEngine = req.app.locals.botEngine;
    if (botEngine) await botEngine.disableFlow(botId);

    res.json({ enabled: false });
  } catch (err) { next(err); }
});

botRoutes.get('/:botId/executions', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const flowId = parseInt(String(req.params.botId));
    const flow = await prisma.botFlow.findUnique({ where: { id: flowId } });
    if (!flow) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, flow.serverConfigId);

    const executions = await prisma.botExecution.findMany({
      where: { flowId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    res.json(executions);
  } catch (err) { next(err); }
});

botRoutes.get('/:botId/executions/:execId/logs', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const flowId = parseInt(String(req.params.botId));
    const flow = await prisma.botFlow.findUnique({ where: { id: flowId } });
    if (!flow) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, flow.serverConfigId);

    const logs = await prisma.botExecutionLog.findMany({
      where: { executionId: parseInt(String(req.params.execId)) },
      orderBy: { timestamp: 'asc' },
    });
    res.json(logs);
  } catch (err) { next(err); }
});
