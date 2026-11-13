import { Router, Request, Response } from 'express';
import { requirePermission, requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { grantCovers, grantOf, type Grant } from '../utils/vs-access.js';
import { flowLogicKey, withStoredImport } from '../utils/flow-approval.js';
import {
  FLOW_TEST_MAX_FLOW_BYTES, FLOW_TEST_MAX_FORCED, flowToTemplate, flowTemplateUpdate, flowTemplateWarnings, parseFlowTemplate, templateToFlowData,
  type FlowTemplateFile, type FlowTemplateUpdate, type ImportedTemplateRef,
} from '@ts6/common';

export const botRoutes: Router = Router();

function isImported(flowData: string): boolean {
  try {
    return !!JSON.parse(flowData)?.imported;
  } catch {
    return false;
  }
}

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
      imported: isImported(b.flowData), approvedAt: b.approvedAt, approvedBy: b.approvedBy,
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
        // Only the import route marks a flow as imported.
        flowData: flowData ? JSON.stringify(withStoredImport(flowData, null)) : '{"nodes":[],"edges":[]}',
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
    // The import mark stays as stored; an approved imported flow whose behaviour a non-admin changes needs an
    // admin again, so a running one is switched off (his decision 5).
    let approvalRevoked = false;
    if (req.body.flowData !== undefined) {
      const stored = JSON.parse(existing.flowData);
      const next = withStoredImport(req.body.flowData ?? {}, stored);
      data.flowData = JSON.stringify(next);
      if (next.imported && existing.approvedAt && req.user!.role !== 'admin' && flowLogicKey(next) !== flowLogicKey(stored)) {
        Object.assign(data, { approvedAt: null, approvedBy: null, enabled: false });
        approvalRevoked = true;
      }
    }
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
    if (botEngine) await (approvalRevoked ? botEngine.disableFlow(botId) : botEngine.reloadFlow(botId));

    res.json({ id: bot.id, name: bot.name, ...(approvalRevoked ? { approvalRevoked: true } : {}) });
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

    // An imported flow is someone else's code: only an admin approves it, by switching it on (again after a
    // non-admin changed it). The approval lives in its own columns, never in flowData.
    const imported: ImportedTemplateRef | undefined = JSON.parse(existing.flowData)?.imported;
    const approve = !!imported && !existing.approvedAt;
    if (approve && req.user!.role !== 'admin') {
      throw new AppError(403, 'An imported flow must be approved by an admin: an admin has to enable it', undefined, 'APPROVAL_REQUIRED');
    }
    await prisma.botFlow.update({ where: { id: botId }, data: { enabled: true, ...(approve ? { approvedAt: new Date(), approvedBy: req.user!.username } : {}) } });

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

// Flow test: what the flow would do with a sample event, nothing changed (see BotEngine.testFlow).
// The editor sends its current, possibly unsaved graph as `flowData`; without it the stored one runs.
// Template export: the flow as a shareable file, secrets emptied, server ids
// turned into inputs. The client lets the user adjust name/version before saving.
botRoutes.get('/:botId/export', requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const bot = await prisma.botFlow.findUnique({ where: { id: parseInt(String(req.params.botId)) } });
    if (!bot) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, bot.serverConfigId, bot.virtualServerId);
    const flowData = JSON.parse(bot.flowData);
    const imported: ImportedTemplateRef | undefined = flowData?.imported;
    res.json(flowToTemplate(flowData, { id: imported?.id, version: imported?.version, name: bot.name, description: bot.description ?? undefined }));
  } catch (err) { next(err); }
});

/** The checked file and target server of an import request; null when a 400 with the file's errors was sent. */
async function readImportRequest(req: Request, res: Response): Promise<{ template: FlowTemplateFile; configId: number; sid: number } | null> {
  const { file, serverConfigId, virtualServerId } = req.body ?? {};
  if (typeof file !== 'string') throw new AppError(400, 'file must be the template file content');
  const check = parseFlowTemplate(file);
  if (!check.ok) { res.status(400).json({ error: 'The template file is not valid', details: check.errors }); return null; }
  const configId = parseInt(serverConfigId);
  if (isNaN(configId)) throw new AppError(400, 'A valid serverConfigId is required');
  if (!(await req.app.locals.prisma.tsServerConfig.findUnique({ where: { id: configId } }))) throw new AppError(400, `Server config ${configId} does not exist`);
  return { template: check.template, configId, sid: parseInt(virtualServerId) || 1 };
}

// Before an import: flows on this server that came from an earlier version of the same
// template, each compared with the file (old version -> new, local flow -> new). Changes nothing.
botRoutes.post('/import/preview', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const request = await readImportRequest(req, res);
    if (!request) return;
    const { template, configId, sid } = request;
    const flows = await prisma.botFlow.findMany({ where: { serverConfigId: configId, virtualServerId: sid }, orderBy: { id: 'asc' } });
    const stored = await prisma.importedTemplate.findMany({ where: { templateId: template.id } });
    const updates: FlowTemplateUpdate[] = [];
    for (const flow of flows) {
      let flowData: any;
      try { flowData = JSON.parse(flow.flowData); } catch { continue; }
      const ref: ImportedTemplateRef | undefined = flowData?.imported;
      if (ref?.id !== template.id) continue;
      const row = stored.find((s: { version: string }) => s.version === ref.version);
      const previous = row ? parseFlowTemplate(row.file) : null;
      updates.push(flowTemplateUpdate(template, { id: flow.id, name: flow.name, enabled: flow.enabled, flowData }, previous?.ok ? previous.template : null));
    }
    res.json({ updates });
  } catch (err) { next(err); }
});

// Template import: always a NEW flow, always disabled (an update too: the installed flow stays as it is).
// Admin only (app.ts lists no permission for it).
botRoutes.post('/import', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const { values = {}, name } = req.body ?? {};
    if (typeof values !== 'object' || values === null || Array.isArray(values) || Object.values(values).some((v) => typeof v !== 'string')) {
      throw new AppError(400, 'values must map input keys to texts');
    }
    const request = await readImportRequest(req, res);
    if (!request) return;
    const { template, configId: parsedConfigId, sid: parsedSid } = request;

    const { flowData, missing, invalid } = templateToFlowData(template, values);
    if (missing.length) return res.status(400).json({ error: 'Required inputs are empty', details: missing });
    if (invalid.length) return res.status(400).json({ error: 'These inputs need the id of a server object', details: invalid });
    const flowName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : template.name;
    const bot = await prisma.botFlow.create({
      data: {
        name: flowName,
        description: template.description ?? null,
        serverConfigId: parsedConfigId,
        virtualServerId: parsedSid,
        enabled: false,
        flowData: JSON.stringify(flowData),
      },
    });
    // Kept so the next version of this template can be compared with it.
    const kept = { name: template.name, file: JSON.stringify(template), importedBy: req.user?.username ?? null, importedAt: new Date() };
    await prisma.importedTemplate.upsert({
      where: { templateId_version: { templateId: template.id, version: template.version } },
      create: { templateId: template.id, version: template.version, ...kept },
      update: kept,
    });
    res.status(201).json({ id: bot.id, name: bot.name, secrets: template.secrets, warnings: flowTemplateWarnings(flowData.nodes, template.inputs.flatMap((i) => i.targets)) });
  } catch (err) { next(err); }
});

botRoutes.post('/:botId/test',requirePermission('bots.manage'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const flow = await prisma.botFlow.findUnique({ where: { id: parseInt(String(req.params.botId)) } });
    if (!flow) throw new AppError(404, 'Bot flow not found');
    await assertServerAccess(req, prisma, flow.serverConfigId, flow.virtualServerId);
    const engine = req.app.locals.botEngine;
    if (!engine) throw new AppError(503, 'Bot engine not running');

    const { flowData, triggerNodeId, event = {}, forceBranches = {} } = req.body ?? {};
    const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (flowData !== undefined) {
      if (!isObject(flowData) || !Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) throw new AppError(400, 'flowData needs nodes and edges');
      if (Buffer.byteLength(JSON.stringify(flowData)) > FLOW_TEST_MAX_FLOW_BYTES) throw new AppError(413, 'flowData is too large to test');
    }
    if (!isObject(event) || Object.values(event).some((v) => typeof v !== 'string')) throw new AppError(400, 'event must be an object of strings');
    if (!isObject(forceBranches) || Object.values(forceBranches).some((v) => typeof v !== 'boolean') || Object.keys(forceBranches).length > FLOW_TEST_MAX_FORCED) {
      throw new AppError(400, `forceBranches must map at most ${FLOW_TEST_MAX_FORCED} condition node ids to true or false`);
    }

    res.json(await engine.testFlow(flow, flowData ?? JSON.parse(flow.flowData), triggerNodeId, event, forceBranches));
  } catch (err) { next(err); }
});
