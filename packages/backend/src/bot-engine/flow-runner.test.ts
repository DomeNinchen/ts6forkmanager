import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowRunner, markExecutionsInterrupted, FLOW_OFF_WHILE_WAITING } from './flow-runner.js';
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


// --- Executions cut off by a restart or a shutdown, and Delays that go on after one ---

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Execution rows and their logs, with the queries the runner and markExecutionsInterrupted make.
function fakeDb() {
  const executions: any[] = [];
  const logs: any[] = [];
  const matches = (e: any, where: any) => e.id === where.id && (typeof where.status === 'object' ? where.status.in.includes(e.status) : e.status === where.status);
  const prisma = {
    botExecution: {
      create: async ({ data }: any) => { executions.push({ id: executions.length + 1, ...data }); return executions[executions.length - 1]; },
      update: async ({ where, data }: any) => Object.assign(executions.find((e) => e.id === where.id), data),
      // Newest log row with a node, like the real select.
      findMany: async ({ where }: any) => executions.filter((e) => e.status === where.status).map((e) => ({
        id: e.id,
        createdChannels: e.createdChannels ?? null,
        flow: { serverConfigId: 1, virtualServerId: 1 },
        logs: logs.filter((l) => l.executionId === e.id && l.nodeId).slice(-1).map(({ nodeId, nodeName }) => ({ nodeId, nodeName })),
      })),
      updateMany: async ({ where, data }: any) => { for (const e of executions) if (matches(e, where)) Object.assign(e, data); },
    },
    botExecutionLog: { create: async ({ data }: any) => { logs.push(data); } },
  };
  return { prisma, executions, logs };
}

const node = (id: string, rest: any) => ({ id, position: { x: 0, y: 0 }, ...rest });
const trigger = node('t', { type: 'trigger', data: { triggerType: 'webhook', label: 'Hook' } });
const delayNode = (ms: number) => ({ type: 'delay', data: { nodeType: 'delay', label: 'Wait', delayMs: ms } });
const busyNode = (ms: number) => ({ type: 'action', data: { actionType: 'kick', label: 'Busy', reasonMsg: String(ms) } });
const logNode = (label: string, message = label) => ({ type: 'log', data: { nodeType: 'log', label, level: 'info', message } });
const afterNode = logNode('After');
/** trigger -> steps[0] -> steps[1] -> ... */
const chain = (...steps: any[]) => ({
  nodes: [trigger, ...steps.map((s, i) => node(`n${i}`, s))],
  edges: steps.map((_, i) => ({ id: `e${i}`, source: i ? `n${i - 1}` : 't', target: `n${i}` })),
});
const flowOf = (flowData: any, id = 1) => ({ id, name: 'f', serverConfigId: 1, virtualServerId: 1, flowData });

// A runner whose WebQuery action kick takes as many ms as its reason text says, and whose clientlist has one row.
// `loaded` is what the engine has loaded now, as the runner sees it when a Delay ends.
function rig() {
  const db = fakeDb();
  const loaded = new Map<number, any>();
  const client = {
    execute: async () => [],
    executePost: async (_sid: number, cmd: string, p: any) => { if (cmd === 'clientkick') await sleep(Number(p.reasonmsg)); return cmd === 'clientlist' ? [{ clid: '1' }] : []; },
  };
  const runner = new FlowRunner(db.prisma as any, { getBotClient: () => client } as any, { clients: new Set() } as any, (id) => loaded.get(id));
  // Every start is a flow of its own, so each one finds its own graph when its Delay ends.
  let nextFlowId = 1;
  const start = (flowData: any) => {
    const flow = flowOf(flowData, nextFlowId++);
    loaded.set(flow.id, flow);
    void runner.execute(flow, 't', 'webhook', {});
    return flow.id;
  };
  const ran = (id: number, label: string) => db.logs.filter((l) => l.executionId === id && l.nodeName === label && l.level === 'info').length;
  return { ...db, runner, loaded, start, ran };
}

test('rows left running are marked interrupted, naming the node started last', async () => {
  const { prisma, executions, logs } = fakeDb();
  executions.push({ id: 1, status: 'running' }, { id: 2, status: 'running' }, { id: 3, status: 'completed' }, { id: 4, status: 'waiting' });
  logs.push({ executionId: 1, nodeId: 't', nodeName: 'Hook' }, { executionId: 1, nodeId: 'n0', nodeName: 'Wait' }, { executionId: 1, nodeId: null });

  assert.equal(await markExecutionsInterrupted(prisma as any, 'Interrupted by a backend restart', {} as any), 2);
  assert.equal(executions[0].status, 'interrupted');
  assert.equal(executions[0].error, "Interrupted by a backend restart (last node started: 'Wait')");
  assert.ok(executions[0].endedAt instanceof Date);
  assert.equal(executions[1].error, 'Interrupted by a backend restart');
  assert.equal(executions[2].status, 'completed');
  // Waiting ones go on after the restart instead.
  assert.equal(executions[3].status, 'waiting');
});

test('a cut-off execution\'s query client is moved out of the channel it created, if it still sits there', async () => {
  const { prisma, executions } = fakeDb();
  executions.push(
    { id: 1, status: 'running', createdChannels: JSON.stringify([{ cid: '100', home: '1', clid: '7' }]) },
    { id: 2, status: 'running', createdChannels: JSON.stringify([{ cid: '101', home: '1', clid: '8' }]) },
  );
  const moves: any[] = [];
  // Client 7 still sits in 100; client 8 has left 101 already.
  const client = {
    execute: async (_sid: number, _cmd: string, p: any) => [{ cid: p.clid === '7' ? '100' : '5' }],
    executePost: async (_sid: number, cmd: string, p: any) => { moves.push({ cmd, ...p }); return []; },
  };
  await markExecutionsInterrupted(prisma as any, 'Interrupted by a backend restart', { getBotClient: () => client } as any);
  assert.deepEqual(moves, [{ cmd: 'clientmove', clid: '7', cid: '1' }]);
});

test('shutdown waits for an execution busy with a node, not for one waiting in a Delay', async () => {
  const { runner, executions, start, ran } = rig();
  start(chain(delayNode(500), afterNode));
  start(chain(busyNode(100), afterNode));

  const t0 = Date.now();
  await runner.shutdown(2000);
  assert.ok(Date.now() - t0 < 400, `shutdown took ${Date.now() - t0} ms`);
  assert.equal(executions[1].status, 'completed');
  assert.equal(ran(2, 'After'), 1);
  // The Delay has nothing behind it: it stays waiting, for the next start to go on with.
  assert.equal(executions[0].status, 'waiting');

  // Its timer still ends in this process: the next node does not run, the row stays waiting.
  await sleep(600);
  assert.equal(ran(1, 'After'), 0);
  assert.equal(executions[0].status, 'waiting');
});

test('an execution still busy when the grace period ends is marked interrupted and goes no further', async () => {
  const { runner, executions, start, ran } = rig();
  start(chain(busyNode(400), afterNode));

  const t0 = Date.now();
  await runner.shutdown(100);
  assert.ok(Date.now() - t0 < 300, `shutdown took ${Date.now() - t0} ms`);
  assert.equal(executions[0].status, 'interrupted');
  assert.equal(executions[0].error, "Interrupted by a backend shutdown (last node started: 'Busy')");

  await sleep(500);
  assert.equal(ran(1, 'After'), 0);
  assert.equal(executions[0].status, 'interrupted');
});

test('only a Delay with nothing behind it waits as resumable; it goes on once and ends normally', async () => {
  const { executions, start, ran } = rig();
  // 1: nothing behind the Delay.
  start(chain(delayNode(150), afterNode));
  // 2: a sibling branch of the trigger still waits behind the Delay.
  start({ nodes: [trigger, node('n0', delayNode(150)), node('n1', afterNode), node('n2', logNode('Sibling'))],
    edges: [{ id: 'a', source: 't', target: 'n0' }, { id: 'b', source: 'n0', target: 'n1' }, { id: 'c', source: 't', target: 'n2' }] });
  // 3: the Delay is in a loop body (clientlist gives one row).
  start({ nodes: [trigger, node('w', { type: 'action', data: { actionType: 'webquery', label: 'List', command: 'clientlist', params: {}, storeAs: 'rows' } }),
    node('l', { type: 'loop', data: { nodeType: 'loop', label: 'Each', arrayVariable: 'rows', itemVariable: 'r' } }), node('n0', delayNode(150)), node('n1', afterNode)],
  edges: [{ id: 'a', source: 't', target: 'w' }, { id: 'b', source: 'w', target: 'l' }, { id: 'c', source: 'l', sourceHandle: 'body', target: 'n0' }, { id: 'd', source: 'l', sourceHandle: 'after', target: 'n1' }] });

  await sleep(60);
  assert.equal(executions[0].status, 'waiting');
  assert.equal(executions[0].resumeNodeId, 'n0');
  assert.ok(executions[0].resumeAt instanceof Date);
  assert.equal(JSON.parse(executions[0].state).nodeVisits, 2);
  assert.equal(executions[1].status, 'running');
  assert.equal(executions[2].status, 'running');

  await sleep(300);
  assert.deepEqual(executions.map((e) => e.status), ['completed', 'completed', 'completed']);
  assert.equal(executions[0].state, null);
  assert.deepEqual([ran(1, 'After'), ran(2, 'After'), ran(2, 'Sibling'), ran(3, 'After')], [1, 1, 1, 1]);
});

test('a waiting execution goes on after a restart, with its variables, exactly once', async () => {
  const { runner, executions, logs, loaded } = rig();
  const flow = flowOf(chain(delayNode(1000), logNode('After', 'code={{temp.code}} x={{event.x}}')));
  loaded.set(1, flow);
  executions.push({
    id: 1, status: 'waiting', triggeredBy: 'webhook', triggerData: JSON.stringify({ x: '1' }), resumeNodeId: 'n0',
    resumeAt: new Date(Date.now() + 100), state: JSON.stringify({ temp: [['code', '42']], nodeVisits: 2 }),
  });

  const t0 = Date.now();
  await runner.resume(flow, executions[0]);
  assert.ok(Date.now() - t0 >= 90, 'waited out the rest of the Delay');
  assert.equal(executions[0].status, 'completed');
  assert.deepEqual(logs.filter((l) => l.nodeName === 'After' && l.level === 'info').map((l) => l.message), ['code=42 x=1']);
});

test('a waiting execution found too late after a restart is interrupted, its next node never runs', async () => {
  const { runner, executions, ran, loaded } = rig();
  const flow = flowOf(chain(delayNode(1000), afterNode));
  loaded.set(1, flow);
  executions.push({ id: 1, status: 'waiting', triggeredBy: 'webhook', triggerData: '{}', resumeNodeId: 'n0',
    resumeAt: new Date(Date.now() - 10 * 60_000), state: JSON.stringify({ temp: [], nodeVisits: 2 }) });

  await runner.resume(flow, executions[0]);
  assert.equal(executions[0].status, 'interrupted');
  assert.match(executions[0].error, /10 min ago/);
  assert.equal(ran(1, 'After'), 0);
});

test('when the Delay ends: a flow switched off cancels, a missing Delay node interrupts, an edit is followed', async () => {
  const { executions, start, ran, loaded } = rig();
  const off = start(chain(delayNode(100), afterNode));
  const nodeGone = start(chain(delayNode(100), afterNode));
  const edited = start(chain(delayNode(100), afterNode));
  await sleep(30);
  loaded.delete(off);
  loaded.set(nodeGone, flowOf({ nodes: [trigger, node('x', afterNode)], edges: [{ id: 'e', source: 't', target: 'x' }] }, nodeGone));
  loaded.set(edited, flowOf(chain(delayNode(100), logNode('Edited')), edited));
  await sleep(150);

  assert.deepEqual(executions.map((e) => e.status), ['cancelled', 'interrupted', 'completed']);
  assert.equal(executions[0].error, FLOW_OFF_WHILE_WAITING);
  assert.match(executions[1].error, /Delay node is gone/);
  assert.deepEqual([ran(1, 'After'), ran(2, 'After'), ran(3, 'After'), ran(3, 'Edited')], [0, 0, 0, 1]);
});