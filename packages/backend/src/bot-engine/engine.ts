import type { PrismaClient } from '../generated/prisma/client.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { EventBridge } from './event-bridge.js';
import { FlowRunner, FLOW_OFF_WHILE_WAITING } from './flow-runner.js';
import type { Express, Request, Response } from 'express';
import type { WebSocketServer } from 'ws';
import cron, { type ScheduledTask } from 'node-cron';
import type {
  FlowDefinition, FlowNode,
  EventTriggerData, CronTriggerData, WebhookTriggerData, CommandTriggerData,
  AnimatedChannelActionData, TriggerNodeData, FlowTestReport,
} from '@ts6/common';
import { FLOW_TEST_MAX_FRAMES } from '@ts6/common';
import { AnimationManager } from './animation-manager.js';
import { normalizeFlowData } from './normalize-flow.js';
import { eventFilterMismatch, matchCommand, supportQueueMismatch, webhookEventData, webhookSecretMatches } from './trigger-match.js';
import { onSupportCaseTaken } from '../utils/support-queue.js';
import { AppError } from '../middleware/error-handler.js';
import { animationConfig, animationFrames } from './animation-manager.js';
import { instanceAudience, sendToAudience } from '../utils/ws-audience.js';
import { BOT_LOG_DEFAULTS, getBotLogSettings } from '../utils/bot-log-settings.js';

interface LoadedFlow {
  id: number;
  name: string;
  serverConfigId: number;
  virtualServerId: number;
  flowData: FlowDefinition;
  triggerNodes: FlowNode[];
}

interface CronEntry {
  flowId: number;
  nodeId: string;
  task: ScheduledTask;
}

interface WebhookEntry {
  flowId: number;
  nodeId: string;
  path: string;
  method: string;
  secret?: string;
}

/** Dropped triggers of one flow and trigger type inside this window share one 'dropped' execution row. */
const DROP_WINDOW_MS = 60_000;

/** How long a shutdown waits for executions busy with a node; well inside Docker's 10 s before it kills the process. */
const SHUTDOWN_GRACE_MS = 5_000;

interface DropWindow {
  count: number;
  executionId: Promise<number | null>;
  timer: NodeJS.Timeout;
}

export class BotEngine {
  private flows: Map<number, LoadedFlow> = new Map();
  private eventBridge: EventBridge;
  private flowRunner: FlowRunner;
  private animationManager: AnimationManager;
  private cronJobs: CronEntry[] = [];
  private webhookEntries: WebhookEntry[] = [];
  private executionCounts: Map<number, number> = new Map();
  private dropWindows: Map<string, DropWindow> = new Map();
  private maxConcurrentPerFlow: number = BOT_LOG_DEFAULTS.maxConcurrentPerFlow;
  private running: boolean = false;

  constructor(
    private prisma: PrismaClient,
    private connectionPool: ConnectionPool,
    private wss: WebSocketServer,
    private app: Express,
  ) {
    this.eventBridge = new EventBridge(prisma);
    this.flowRunner = new FlowRunner(prisma, connectionPool, wss, (flowId) => this.flows.get(flowId));
    this.animationManager = new AnimationManager();
  }

  setVoiceBotManager(manager: any): void {
    this.flowRunner.setVoiceBotManager(manager);
  }

  getEventBridge(): EventBridge {
    return this.eventBridge;
  }

  /**
   * Reconnect SSH (base event registration + command listeners) for a server
   * config using its current DB credentials. connectServer()/
   * connectCommandListener() no-op while a connection already exists, so
   * editing SSH credentials on an already-connected server had no effect
   * until that connection eventually died on its own - this forces it.
   */
  async refreshServerConnections(configId: number): Promise<void> {
    await this.eventBridge.disconnectAllForConfig(configId);
    this.setupSshConnections();
  }

  /**
   * Stops everything the engine runs for one server connection - its flows, cron
   * jobs, webhooks, animations and every SSH session (event listeners and command
   * listeners) - without touching the database. For a connection that was deleted
   * or disabled; works from what is in memory, so it is safe after the rows are gone.
   */
  async stopServer(configId: number): Promise<void> {
    for (const flow of [...this.flows.values()]) {
      if (flow.serverConfigId === configId) await this.disableFlow(flow.id);
    }
    // Also catches sessions opened by something other than a loaded flow (e.g. on-demand command execution).
    await this.eventBridge.disconnectAllForConfig(configId);
  }

  /** Starts, from the database, every flow that is enabled for a connection - after the connection was enabled again. */
  async startServer(configId: number): Promise<void> {
    const server = await this.prisma.tsServerConfig.findUnique({ where: { id: configId }, select: { enabled: true } });
    if (!server?.enabled) return;
    const flows = await this.prisma.botFlow.findMany({ where: { serverConfigId: configId, enabled: true }, select: { id: true } });
    for (const { id } of flows) await this.enableFlow(id);
  }

  async reloadServer(configId: number): Promise<void> {
    await this.stopServer(configId);
    await this.startServer(configId);
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Always register event listener (even if no flows yet — flows can be enabled later)
    this.eventBridge.on('tsEvent', this.onTsEvent.bind(this));
    // Support queue events come from the queue job and the web take, not from SSH.
    onSupportCaseTaken(this.onSupportCaseTaken.bind(this));

    this.maxConcurrentPerFlow = (await getBotLogSettings(this.prisma)).maxConcurrentPerFlow;
    await this.loadFlows();

    if (this.flows.size === 0) {
      console.log('[BotEngine] No enabled flows found, engine idle (will activate when flows are enabled)');
      this.running = true;
      return;
    }

    // Setup SSH connections for all unique server+vserver pairs (non-blocking)
    this.setupSshConnections();

    // Setup cron jobs
    this.setupCronJobs();

    // Build webhook registry
    this.buildWebhookRegistry();

    // Start animations for all loaded flows
    for (const flow of this.flows.values()) {
      this.startAnimationsForFlow(flow.id, flow.serverConfigId, flow.virtualServerId);
    }

    this.running = true;

    const sshCount = this.eventBridge.getConnectedKeys().length;
    console.log(`[BotEngine] Started with ${this.flows.size} flow(s), ${sshCount} SSH connection(s), ${this.cronJobs.length} cron job(s), ${this.webhookEntries.length} webhook(s)`);

    this.broadcast('bot:engine:started', { flowCount: this.flows.size });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.animationManager.stopAll();
    this.teardownCronJobs();
    this.webhookEntries = [];
    this.eventBridge.removeAllListeners('tsEvent');
    this.flows.clear();
    await Promise.all([...this.dropWindows.keys()].map(key => this.closeDropWindow(key)));
  }

  setMaxConcurrentPerFlow(limit: number): void {
    this.maxConcurrentPerFlow = limit;
  }

  async enableFlow(flowId: number): Promise<void> {
    console.log(`[BotEngine] Enabling flow ${flowId}...`);
    const dbFlow = await this.prisma.botFlow.findUnique({ where: { id: flowId }, include: { serverConfig: { select: { enabled: true } } } });
    if (!dbFlow || !dbFlow.enabled) {
      console.log(`[BotEngine] Flow ${flowId} not found or not enabled in DB`);
      return;
    }
    if (!dbFlow.serverConfig.enabled) {
      // It starts by itself when the connection is enabled (see startServer); until then there is no query client for it to act with.
      console.log(`[BotEngine] Flow ${flowId} ('${dbFlow.name}') waits: its server connection is disabled`);
      return;
    }

    try {
      const raw = JSON.parse(dbFlow.flowData);
      const flowData = normalizeFlowData(raw);
      const triggerNodes = flowData.nodes.filter(n => n.type === 'trigger');

      const hasAnimations = flowData.nodes.some(n => n.type === 'action' && (n.data as any).actionType === 'animatedChannel');
      console.log(`[BotEngine] Flow ${flowId} ('${dbFlow.name}'): ${triggerNodes.length} trigger(s), ${flowData.nodes.length} node(s), ${flowData.edges.length} edge(s)${hasAnimations ? ', has animations' : ''}`);

      if (triggerNodes.length === 0 && !hasAnimations) {
        console.warn(`[BotEngine] Flow ${flowId} has no trigger nodes and no animations — nothing to activate`);
      }

      for (const t of triggerNodes) {
        const td = t.data as any;
        console.log(`[BotEngine]   Trigger: type=${td.triggerType}, ${td.triggerType === 'event' ? `event=${td.eventName}` : td.triggerType === 'cron' ? `cron=${td.cronExpression}` : td.triggerType === 'command' ? `cmd=${td.commandPrefix}${td.commandName}` : td.triggerType === 'support' ? `support=${td.supportEvent} queue=${td.queueId || 'any'}` : `webhook=${td.webhookPath}`}`);
      }

      this.flows.set(flowId, {
        id: dbFlow.id,
        name: dbFlow.name,
        serverConfigId: dbFlow.serverConfigId,
        virtualServerId: dbFlow.virtualServerId,
        flowData,
        triggerNodes,
      });

      // Ensure SSH connection exists for event/command triggers
      const hasEventTrigger = triggerNodes.some(t => {
        const td = t.data as any;
        return td.triggerType === 'event' || td.triggerType === 'command';
      });

      if (hasEventTrigger) {
        console.log(`[BotEngine] Flow needs SSH — connecting to server ${dbFlow.serverConfigId}, sid=${dbFlow.virtualServerId}...`);
        if (!this.eventBridge.isConnected(dbFlow.serverConfigId, dbFlow.virtualServerId)) {
          // Non-blocking: SSH connects in background, events will flow once connected
          this.eventBridge.connectServer(dbFlow.serverConfigId, dbFlow.virtualServerId).catch(err => {
            console.error(`[BotEngine] SSH connection failed for ${dbFlow.serverConfigId}:${dbFlow.virtualServerId}: ${err.message}`);
          });
        } else {
          console.log(`[BotEngine] SSH already connected for ${dbFlow.serverConfigId}:${dbFlow.virtualServerId}`);
        }
        // NEW: start/stop per-channel command listeners for this pair
        this.syncCommandListenersForPair(dbFlow.serverConfigId, dbFlow.virtualServerId);
      }

      // Setup cron jobs for this flow
      this.setupCronJobsForFlow(flowId);

      // Add webhook entries for this flow
      this.buildWebhookRegistryForFlow(flowId);

      // Start animations for any animatedChannel action nodes
      this.startAnimationsForFlow(flowId, dbFlow.serverConfigId, dbFlow.virtualServerId);

      console.log(`[BotEngine] Flow ${flowId} ('${dbFlow.name}') enabled successfully`);
    } catch (err: any) {
      console.error(`[BotEngine] Failed to enable flow ${flowId}: ${err.message}`);
    }
  }

  async disableFlow(flowId: number): Promise<void> {
    this.animationManager.stopAnimation(flowId);
    this.teardownCronJobs(flowId);
    this.webhookEntries = this.webhookEntries.filter(w => w.flowId !== flowId);
    this.flows.delete(flowId);
    // executionCounts stays: executions already running finish after a disable and still
    // count against the limit when the flow is enabled again; the entry goes once they are done.

    // Check if any remaining flows use the same SSH connections
    await this.cleanupUnusedSshConnections();

    console.log(`[BotEngine] Flow ${flowId} disabled`);
  }

  async reloadFlow(flowId: number): Promise<void> {
    const flow = this.flows.get(flowId);
    if (flow) {
      // Flow was active — disable then re-enable
      await this.disableFlow(flowId);
      const dbFlow = await this.prisma.botFlow.findUnique({ where: { id: flowId } });
      if (dbFlow?.enabled) {
        await this.enableFlow(flowId);
      }
    }
  }

  handleWebhookRequest(req: Request, res: Response): void {
    // Express 5 / path-to-regexp v8's named wildcard (*path) yields an array
    // of matched segments, not a single string like the old :path(*) did.
    const pathParam = req.params.path;
    const webhookPath = Array.isArray(pathParam) ? pathParam.join('/') : String(pathParam || '');
    const method = req.method.toUpperCase();
    const providedSecret = String(req.headers['x-webhook-secret'] || req.query.secret || '');

    const matching = this.webhookEntries.filter(w =>
      w.path === webhookPath && (w.method === method || w.method === 'ANY')
    );

    // H6: Return same 404 for not-found and invalid-secret (prevent enumeration)
    if (matching.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    let triggered = 0;
    let dropped = 0;
    for (const wh of matching) {
      // H6: mandatory secret (none configured never matches), compared in constant time
      if (!webhookSecretMatches(wh.secret ?? '', providedSecret)) continue;

      const flow = this.flows.get(wh.flowId);
      if (!flow) continue;

      const webhookData = webhookEventData(webhookPath, method, req.body, req.query as Record<string, unknown>);

      if (this.executeFlow(flow, wh.nodeId, 'webhook', webhookData)) triggered++;
      else dropped++;
    }

    // Same response regardless of reason (not found / wrong secret)
    if (triggered === 0 && dropped === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // Only reached with a valid secret, so a 429 tells nothing to someone guessing paths.
    if (triggered === 0) {
      res.status(429).set('Retry-After', '5').json({ triggered, dropped });
      return;
    }

    res.json({ triggered, dropped });
  }

  getFlow(flowId: number): LoadedFlow | undefined {
    return this.flows.get(flowId);
  }

  /**
   * A flow test (FlowRunner.test) of one trigger with sample data, on the given (possibly unsaved,
   * possibly disabled) flow. The sample goes through the same trigger checks and enrichment a live
   * event gets; one this trigger would ignore is reported as 'notTriggered' and runs nothing.
   * For a webhook trigger the sample's `body` and `query` are JSON text, `method` the HTTP method.
   * `triggerNodeId` may be left out when the flow has one trigger.
   */
  async testFlow(
    flow: { id: number; name: string; serverConfigId: number; virtualServerId: number },
    rawFlowData: unknown, triggerNodeId: string | undefined, sample: Record<string, string>,
    /** Condition node id -> the branch it takes in this test, whatever its expression says. */
    forceBranches: Record<string, boolean> = {},
  ): Promise<FlowTestReport> {
    let flowData: FlowDefinition;
    try {
      flowData = normalizeFlowData(rawFlowData);
    } catch {
      throw new AppError(400, 'The flow could not be read');
    }
    const triggers = flowData.nodes.filter((n) => n.type === 'trigger');
    const trigger = triggerNodeId !== undefined ? triggers.find((n) => n.id === triggerNodeId) : triggers.length === 1 ? triggers[0] : undefined;
    if (!trigger) throw new AppError(400, triggers.length ? 'Choose one of the flow\'s triggers (triggerNodeId)' : 'The flow has no trigger');

    const td = trigger.data as TriggerNodeData;
    // Shown with every answer: they run on their own timer, whichever trigger is tested.
    const animations = flowData.nodes
      .filter((n) => n.type === 'action' && (n.data as any).actionType === 'animatedChannel')
      .map((n) => {
        const config = animationConfig(n.data as AnimatedChannelActionData);
        return { nodeId: n.id, label: n.data.label ?? '', channelId: config.channelId, intervalSeconds: config.intervalSeconds, frames: animationFrames(config).slice(0, FLOW_TEST_MAX_FRAMES) };
      });
    const filters = td.triggerType === 'event'
      ? Object.entries(td.filters || {}).map(([key, expected]) => ({ key, expected, actual: sample[key] ?? null, ok: sample[key] === expected }))
      : undefined;
    const notTriggered = (mismatch: FlowTestReport['mismatch']): FlowTestReport => ({
      status: 'notTriggered', triggerNodeId: trigger.id, triggerType: td.triggerType, mismatch, filters, eventData: sample, steps: [], variables: [], temp: [], reads: 0, animations,
    });
    let data = sample;
    if (td.triggerType === 'event') {
      const mismatch = eventFilterMismatch(td, sample);
      if (mismatch) return notTriggered(mismatch);
    } else if (td.triggerType === 'command') {
      // The test stands in for the chat a channel-bound command listens to.
      const match = matchCommand(td, td.channelId ? { __cmd_listener_channel_id: String(td.channelId), ...sample } : sample);
      if ('mismatch' in match) return notTriggered(match.mismatch);
      data = match.data;
    } else if (td.triggerType === 'webhook') {
      const method = (sample.method || (td.method as string) || 'POST').toUpperCase();
      let body: unknown, query: Record<string, unknown>;
      try {
        body = JSON.parse(sample.body || '{}');
        query = JSON.parse(sample.query || '{}');
      } catch {
        throw new AppError(400, 'The sample body and query must be JSON');
      }
      data = webhookEventData(td.webhookPath, method === 'ANY' ? 'POST' : method, body, query);
    } else if (td.triggerType === 'support') {
      const mismatch = supportQueueMismatch(td, sample);
      if (mismatch) return notTriggered(mismatch);
    } else {
      data = {};
    }
    const { id, name, serverConfigId, virtualServerId } = flow;
    const report = await this.flowRunner.test({ id, name, serverConfigId, virtualServerId, flowData }, trigger.id, td.triggerType, data, (td as any).timezone, new Map(Object.entries(forceBranches)));
    return { ...report, filters, animations };
  }

  async destroy(): Promise<void> {
    await this.stop();
    await this.flowRunner.shutdown(SHUTDOWN_GRACE_MS);
    await this.eventBridge.destroy();
    this.broadcast('bot:engine:stopped', {});
  }

  // --- Private Methods ---

  private async loadFlows(): Promise<void> {
    // A disabled connection has no query client to act with, so its flows stay idle until it is enabled again (see startServer).
    const dbFlows = await this.prisma.botFlow.findMany({ where: { enabled: true, serverConfig: { enabled: true } } });

    for (const dbFlow of dbFlows) {
      try {
        const raw = JSON.parse(dbFlow.flowData);
        const flowData = normalizeFlowData(raw);
        const triggerNodes = flowData.nodes.filter(n => n.type === 'trigger');
        const hasAnimations = flowData.nodes.some(n => n.type === 'action' && (n.data as any).actionType === 'animatedChannel');

        if (triggerNodes.length === 0 && !hasAnimations) {
          console.warn(`[BotEngine] Flow ${dbFlow.id} ('${dbFlow.name}') has no trigger nodes and no animations, skipping`);
          continue;
        }

        this.flows.set(dbFlow.id, {
          id: dbFlow.id,
          name: dbFlow.name,
          serverConfigId: dbFlow.serverConfigId,
          virtualServerId: dbFlow.virtualServerId,
          flowData,
          triggerNodes,
        });
      } catch (err: any) {
        console.error(`[BotEngine] Failed to parse flow ${dbFlow.id}: ${err.message}`);
      }
    }
  }

  private setupSshConnections(): void {
    const serverPairs = new Set<string>();
    for (const flow of this.flows.values()) {
      serverPairs.add(`${flow.serverConfigId}:${flow.virtualServerId}`);
    }

    for (const pair of serverPairs) {
      const [configId, sid] = pair.split(':').map(Number);
      // Non-blocking: don't await SSH connections during startup
      this.eventBridge.connectServer(configId, sid).catch(err => {
        console.error(`[BotEngine] SSH connection failed for ${pair}: ${err.message}`);
      });
      this.syncCommandListenersForPair(configId, sid);
    }
  }

  private async cleanupUnusedSshConnections(): Promise<void> {
    const neededPairs = new Set<string>();
    for (const flow of this.flows.values()) {
      neededPairs.add(`${flow.serverConfigId}:${flow.virtualServerId}`);
    }

    // 1) cleanup unused ssh connections
    for (const key of this.eventBridge.getConnectedKeys()) {
      if (!neededPairs.has(key)) {
        const [configId, sid] = key.split(':').map(Number);
        await this.eventBridge.disconnectServer(configId, sid);
      }
    }

    // 2) sync command listeners per pair
    for (const pair of neededPairs) {
      const [configId, sid] = pair.split(':').map(Number);
      this.syncCommandListenersForPair(configId, sid);
    }

    // 3) delete command listener for unused pairs
    for (const cmdKey of this.eventBridge.getCommandListenerKeys()) {
      // expected: `${configId}:${sid}:cmd:${channelId}`
      const m = cmdKey.match(/^(\d+):(\d+):cmd:(\d+)$/);
      if (!m) continue;

      const configId = Number(m[1]);
      const sid = Number(m[2]);
      const channelId = Number(m[3]);

      const pairKey = `${configId}:${sid}`;
      if (!neededPairs.has(pairKey)) {
        await this.eventBridge.disconnectCommandListener(configId, sid, channelId);
      }
    }
  }

  private onTsEvent(configId: number, sid: number, eventName: string, data: Record<string, string>): void {
    console.log(`[BotEngine] TS Event received: ${eventName} from ${configId}:${sid}`, JSON.stringify(data).substring(0, 200));
    for (const flow of this.flows.values()) {
      if (flow.serverConfigId !== configId || flow.virtualServerId !== sid) continue;

      for (const triggerNode of flow.triggerNodes) {
        const triggerData = triggerNode.data as any;

        // Event trigger
        if (triggerData.triggerType === 'event') {
          const eventTrigger = triggerData as EventTriggerData;
          if (eventTrigger.eventName !== eventName) {
            continue;
          }

          if (eventFilterMismatch(eventTrigger, data)) continue;

          this.executeFlow(flow, triggerNode.id, 'event', data);
        }

        // Command trigger (special case of text message)
        if (triggerData.triggerType === 'command' && eventName === 'notifytextmessage') {
          const match = matchCommand(triggerData as CommandTriggerData, data);
          if ('data' in match) this.executeFlow(flow, triggerNode.id, 'command', match.data);
        }
      }
    }
  }


  private onSupportCaseTaken(configId: number, sid: number, data: Record<string, string>): void {
    for (const flow of this.flows.values()) {
      if (flow.serverConfigId !== configId || flow.virtualServerId !== sid) continue;
      for (const triggerNode of flow.triggerNodes) {
        const td = triggerNode.data as TriggerNodeData;
        if (td.triggerType === 'support' && !supportQueueMismatch(td, data)) this.executeFlow(flow, triggerNode.id, 'support', data);
      }
    }
  }

  private getNeededCommandChannelIds(configId: number, sid: number): number[] {
    const ids = new Set<number>();

    for (const flow of this.flows.values()) {
      if (flow.serverConfigId !== configId || flow.virtualServerId !== sid) continue;

      for (const t of flow.triggerNodes) {
        const td: any = t.data;
        if (td?.triggerType === 'command' && td.channelId) {
          const n = parseInt(String(td.channelId), 10);
          if (Number.isFinite(n) && n > 0) ids.add(n);
        }
      }
    }
    return Array.from(ids);
  }

  private syncCommandListenersForPair(configId: number, sid: number): void {
    const needed = new Set(this.getNeededCommandChannelIds(configId, sid));
    const existing = new Set(this.eventBridge.getCommandListenerChannelIds(configId, sid));

    for (const cid of needed) {
      if (!existing.has(cid)) {
        this.eventBridge.connectCommandListener(configId, sid, cid).catch(err => {
          console.error(`[BotEngine] CMD listener connect failed for ${configId}:${sid}:${cid}: ${err.message}`);
        });
      }
    }

    for (const cid of existing) {
      if (!needed.has(cid)) {
        this.eventBridge.disconnectCommandListener(configId, sid, cid).catch(() => { });
      }
    }
  }


  /** Starts one execution; false when the flow already runs its limit and the trigger was dropped. */
  private executeFlow(flow: LoadedFlow, triggerNodeId: string, triggerType: string, eventData: Record<string, string>): boolean {
    const current = this.executionCounts.get(flow.id) || 0;
    if (current >= this.maxConcurrentPerFlow) {
      this.recordDrop(flow, triggerType, current);
      return false;
    }
    console.log(`[BotEngine] Executing flow ${flow.id} ('${flow.name}') triggered by ${triggerType}`);

    // Extract timezone from the trigger node (if cron trigger has one)
    const triggerNode = flow.flowData.nodes.find(n => n.id === triggerNodeId);
    const triggerData = triggerNode?.data as any;
    const timezone = triggerData?.timezone as string | undefined;

    this.track(flow.id, () => this.flowRunner.execute(flow, triggerNodeId, triggerType, eventData, timezone));
    return true;
  }

  /** Counts an execution against its flow's limit while it runs. */
  private track(flowId: number, run: () => Promise<void>): void {
    this.executionCounts.set(flowId, (this.executionCounts.get(flowId) || 0) + 1);
    run()
      .catch(err => {
        console.error(`[BotEngine] Flow ${flowId} execution error: ${err.message}`);
      })
      .finally(() => {
        const count = (this.executionCounts.get(flowId) || 1) - 1;
        if (count > 0) this.executionCounts.set(flowId, count);
        else this.executionCounts.delete(flowId);
      });
  }

  /**
   * Goes on with the executions the previous process left waiting in a Delay. They count against
   * their flow's limit again, as they did before the restart, but are never dropped by it. Run
   * once at startup, after start() and once the music bots are wired in.
   */
  async resumeWaitingExecutions(): Promise<void> {
    const rows = await this.prisma.botExecution.findMany({
      where: { status: 'waiting' },
      select: { id: true, flowId: true, triggeredBy: true, triggerData: true, resumeNodeId: true, resumeAt: true, state: true },
    });
    for (const row of rows) {
      const flow = this.flows.get(row.flowId);
      if (!flow) {
        await this.prisma.botExecution.update({ where: { id: row.id }, data: { status: 'cancelled', endedAt: new Date(), error: FLOW_OFF_WHILE_WAITING, state: null } });
        continue;
      }
      this.track(flow.id, () => this.flowRunner.resume(flow, row));
    }
    if (rows.length) console.log(`[BotEngine] ${rows.length} execution(s) found waiting in a Delay after the restart`);
  }

  /**
   * Leaves a trace of a dropped trigger in the flow's execution history. Under
   * overload a row per dropped trigger would add to the very load that caused
   * it, so all drops of one flow and trigger type within a minute share one
   * 'dropped' row: written at the first drop, its count updated when the
   * minute is over.
   */
  private recordDrop(flow: LoadedFlow, triggerType: string, running: number): void {
    console.warn(`[BotEngine] Flow ${flow.id} ('${flow.name}') dropped a ${triggerType} trigger: ${running} of ${this.maxConcurrentPerFlow} concurrent executions already running`);

    const key = `${flow.id}:${triggerType}`;
    const open = this.dropWindows.get(key);
    if (open) {
      open.count++;
      return;
    }
    const executionId = this.prisma.botExecution.create({
      data: {
        flowId: flow.id,
        triggeredBy: triggerType,
        triggerData: JSON.stringify({ dropped: 1 }),
        status: 'dropped',
        endedAt: new Date(),
        error: `Concurrency limit reached (${this.maxConcurrentPerFlow} executions running)`,
      },
    }).then(row => row.id, err => {
      console.error(`[BotEngine] Could not record dropped trigger of flow ${flow.id}: ${err.message}`);
      return null;
    });
    const timer = setTimeout(() => { void this.closeDropWindow(key); }, DROP_WINDOW_MS);
    timer.unref();
    this.dropWindows.set(key, { count: 1, executionId, timer });
  }

  private async closeDropWindow(key: string): Promise<void> {
    const window = this.dropWindows.get(key);
    if (!window) return;
    this.dropWindows.delete(key);
    clearTimeout(window.timer);
    const id = await window.executionId;
    if (id === null || window.count === 1) return;
    await this.prisma.botExecution.update({
      where: { id },
      data: { triggerData: JSON.stringify({ dropped: window.count }), endedAt: new Date() },
    }).catch(err => console.error(`[BotEngine] Could not update dropped count of execution ${id}: ${err.message}`));
  }

  private setupCronJobs(): void {
    for (const flow of this.flows.values()) {
      this.setupCronJobsForFlow(flow.id);
    }
  }

  private setupCronJobsForFlow(flowId: number): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    for (const triggerNode of flow.triggerNodes) {
      const triggerData = triggerNode.data as any;
      if (triggerData.triggerType !== 'cron') continue;

      const cronData = triggerData as CronTriggerData;
      if (!cron.validate(cronData.cronExpression)) {
        console.error(`[BotEngine] Invalid cron expression '${cronData.cronExpression}' in flow ${flowId}`);
        continue;
      }

      const task = cron.schedule(cronData.cronExpression, () => {
        this.executeFlow(flow, triggerNode.id, 'cron', {});
      }, {
        timezone: cronData.timezone || 'UTC',
      });

      this.cronJobs.push({ flowId, nodeId: triggerNode.id, task });
    }
  }

  private buildWebhookRegistry(): void {
    for (const flow of this.flows.values()) {
      this.buildWebhookRegistryForFlow(flow.id);
    }
  }

  private buildWebhookRegistryForFlow(flowId: number): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    for (const triggerNode of flow.triggerNodes) {
      const triggerData = triggerNode.data as any;
      if (triggerData.triggerType !== 'webhook') continue;

      const whData = triggerData as WebhookTriggerData;
      this.webhookEntries.push({
        flowId,
        nodeId: triggerNode.id,
        path: whData.webhookPath,
        method: whData.method || 'POST',
        secret: whData.secret || undefined,
      });
    }
  }

  private teardownCronJobs(flowId?: number): void {
    const toRemove = flowId !== undefined
      ? this.cronJobs.filter(j => j.flowId === flowId)
      : this.cronJobs;

    for (const entry of toRemove) {
      entry.task.stop();
    }

    this.cronJobs = flowId !== undefined
      ? this.cronJobs.filter(j => j.flowId !== flowId)
      : [];
  }

  private startAnimationsForFlow(flowId: number, serverConfigId: number, virtualServerId: number): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    const animNodes = flow.flowData.nodes.filter(
      n => n.type === 'action' && (n.data as any).actionType === 'animatedChannel'
    );

    if (animNodes.length === 0) return;

    this.animationManager.stopAnimation(flowId);
    for (const node of animNodes) {
      const config = animationConfig(node.data as AnimatedChannelActionData);
      // Looked up per frame, not captured here: the connection can be edited while the animation runs.
      // The bot identity, like every other flow action, so the renames show up under its name in TeamSpeak's logs.
      this.animationManager.startAnimation(flowId, node.id, virtualServerId, config, () => this.connectionPool.getBotClient(serverConfigId));
    }
  }

  /** The engine starting and stopping concerns the whole instance (all flows, all servers): admins only. */
  private broadcast(type: string, payload: any): void {
    sendToAudience(this.wss, type, payload, instanceAudience);
  }
}
