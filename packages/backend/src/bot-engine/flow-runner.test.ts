import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowRunner, markExecutionsInterrupted } from './flow-runner.js';
import { ExecutionContext } from './context.js';

// A stand-in for the WebQuery connection with just the TeamSpeak behavior that matters
// here: channelcreate moves the query client into the new channel, and a temporary
// channel disappears the moment it is empty.
function fakeServer() {
  const where = new Map<string, string>([['q', '1'], ['u1', '5'], ['u2', '5']]);
  const channels = new Set(['1', '5']);
  let next = 100;
  const prune = () => { for (const c of [...channels]) if (+c >= 100 && ![...where.values()].includes(c)) channels.delete(c); };
  const client = {
    execute: async (_sid: number, cmd: string) => (cmd === 'whoami' ? [{ client_id: 'q', client_channel_id: where.get('q') }] : []),
    executePost: async (_sid: number, cmd: string, p: any) => {
      await new Promise((r) => setTimeout(r, 1));
      if (cmd === 'channelcreate') { const cid = String(next++); channels.add(cid); where.set('q', cid); prune(); return [{ cid }]; }
      if (cmd === 'clientmove') {
        if (!channels.has(p.cid)) throw new Error('invalid channelID');
        where.set(p.clid, p.cid); prune();
      }
      return [];
    },
  };
  return { client, where, channels };
}

const runner = new FlowRunner({} as any, {} as any, {} as any) as any;
const ctxFor = (clid: string) => new ExecutionContext({} as any, 1, 1, 1, 1, 'event', { clid });

async function supportFlow(srv: ReturnType<typeof fakeServer>, clid: string) {
  const ctx = ctxFor(clid);
  try {
    await runner.executeChannelCreate({ params: { channel_flag_temporary: '1' } }, ctx, srv.client);
    await runner.executeMove({ channelId: '{{temp.lastCreatedChannelId}}' }, ctx, srv.client);
  } finally {
    await runner.leaveCreatedChannels(ctx, srv.client);
  }
}

test('two support requests at once both get a room, and the query client goes home', async () => {
  const srv = fakeServer();
  await Promise.all([supportFlow(srv, 'u1'), supportFlow(srv, 'u2')]);
  assert.equal(srv.where.get('q'), '1');
  assert.notEqual(srv.where.get('u1'), srv.where.get('u2'));
  assert.ok(srv.channels.has(srv.where.get('u1')!) && +srv.where.get('u1')! >= 100);
  assert.ok(srv.channels.has(srv.where.get('u2')!) && +srv.where.get('u2')! >= 100);
  // Each room is deleted once its user leaves.
  await srv.client.executePost(1, 'clientmove', { clid: 'u1', cid: '5' });
  await srv.client.executePost(1, 'clientmove', { clid: 'u2', cid: '5' });
  assert.deepEqual([...srv.channels].sort(), ['1', '5']);
});

test('creating two channels in one execution does not wait on itself', async () => {
  const srv = fakeServer();
  const ctx = ctxFor('u1');
  await runner.executeChannelCreate({ params: {} }, ctx, srv.client);
  await runner.executeChannelCreate({ params: {} }, ctx, srv.client);
  await runner.leaveCreatedChannels(ctx, srv.client);
  assert.equal(srv.where.get('q'), '1');
  await new Promise((r) => setImmediate(r));
  assert.equal(runner.channelLocks.size, 0);
});

// --- Executions cut off by a restart or a shutdown ---

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Execution rows and their logs, with the queries markExecutionsInterrupted makes.
function fakeDb() {
  const executions: any[] = [];
  const logs: any[] = [];
  const prisma = {
    botExecution: {
      create: async ({ data }: any) => { executions.push({ id: executions.length + 1, ...data }); return executions[executions.length - 1]; },
      update: async ({ where, data }: any) => Object.assign(executions.find((e) => e.id === where.id), data),
      // Newest log row with a node, like the real select.
      findMany: async ({ where }: any) => executions.filter((e) => e.status === where.status).map((e) => ({
        id: e.id,
        logs: logs.filter((l) => l.executionId === e.id && l.nodeId).slice(-1).map(({ nodeId, nodeName }) => ({ nodeId, nodeName })),
      })),
      updateMany: async ({ where, data }: any) => { for (const e of executions) if (e.id === where.id && e.status === where.status) Object.assign(e, data); },
    },
    botExecutionLog: { create: async ({ data }: any) => { logs.push(data); } },
  };
  return { prisma, executions, logs };
}

// A runner whose only WebQuery action, kick, takes as many ms as its reason text says.
function shutdownRig() {
  const db = fakeDb();
  const client = { execute: async () => [], executePost: async (_sid: number, _cmd: string, p: any) => { await sleep(Number(p.reasonmsg)); return []; } };
  const runner = new FlowRunner(db.prisma as any, { getBotClient: () => client } as any, { clients: new Set() } as any);
  const start = (...steps: any[]) => {
    const nodes = [{ id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { triggerType: 'webhook', label: 'Hook' } },
      ...steps.map((s, i) => ({ id: `n${i}`, position: { x: 0, y: 0 }, ...s }))];
    const edges = steps.map((_, i) => ({ id: `e${i}`, source: i ? `n${i - 1}` : 't', target: `n${i}` }));
    void runner.execute({ id: 1, name: 'f', serverConfigId: 1, virtualServerId: 1, flowData: { nodes, edges } as any }, 't', 'webhook', {});
  };
  const ranAfter = (id: number) => db.logs.some((l) => l.executionId === id && l.nodeName === 'After');
  return { ...db, runner, start, ranAfter };
}
const delayNode = (ms: number) => ({ type: 'delay', data: { nodeType: 'delay', label: 'Wait', delayMs: ms } });
const busyNode = (ms: number) => ({ type: 'action', data: { actionType: 'kick', label: 'Busy', reasonMsg: String(ms) } });
const afterNode = { type: 'log', data: { nodeType: 'log', label: 'After', level: 'info', message: 'after' } };

test('rows left running are marked interrupted, naming the node started last', async () => {
  const { prisma, executions, logs } = fakeDb();
  executions.push({ id: 1, status: 'running' }, { id: 2, status: 'running' }, { id: 3, status: 'completed' });
  logs.push({ executionId: 1, nodeId: 't', nodeName: 'Hook' }, { executionId: 1, nodeId: 'n0', nodeName: 'Wait' }, { executionId: 1, nodeId: null });

  assert.equal(await markExecutionsInterrupted(prisma as any, 'Interrupted by a backend restart'), 2);
  assert.equal(executions[0].status, 'interrupted');
  assert.equal(executions[0].error, "Interrupted by a backend restart (last node started: 'Wait')");
  assert.ok(executions[0].endedAt instanceof Date);
  assert.equal(executions[1].error, 'Interrupted by a backend restart');
  assert.equal(executions[2].status, 'completed');
});

test('shutdown waits for an execution busy with a node, not for one waiting in a Delay', async () => {
  const { runner, executions, start, ranAfter } = shutdownRig();
  start(delayNode(500), afterNode);
  start(busyNode(100), afterNode);

  const t0 = Date.now();
  await runner.shutdown(2000);
  assert.ok(Date.now() - t0 < 400, `shutdown took ${Date.now() - t0} ms`);
  assert.equal(executions[1].status, 'completed');
  assert.ok(ranAfter(2));
  assert.equal(executions[0].status, 'interrupted');
  assert.equal(executions[0].error, "Interrupted by a backend shutdown (last node started: 'Wait')");

  // The Delay ends after the shutdown: its next node does not run, the row stays interrupted.
  await sleep(600);
  assert.equal(ranAfter(1), false);
  assert.equal(executions[0].status, 'interrupted');
});

test('an execution still busy when the grace period ends is marked interrupted and goes no further', async () => {
  const { runner, executions, start, ranAfter } = shutdownRig();
  start(busyNode(400), afterNode);

  const t0 = Date.now();
  await runner.shutdown(100);
  assert.ok(Date.now() - t0 < 300, `shutdown took ${Date.now() - t0} ms`);
  assert.equal(executions[0].status, 'interrupted');
  assert.equal(executions[0].error, "Interrupted by a backend shutdown (last node started: 'Busy')");

  await sleep(500);
  assert.equal(ranAfter(1), false);
  assert.equal(executions[0].status, 'interrupted');
});
