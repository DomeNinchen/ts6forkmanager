import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import axios from 'axios';
import { isReadOnlyCommand, MASKED_VALUE, FLOW_TEST_MAX_READS, FLOW_TEST_SIMULATED_ID, type FlowDefinition, type FlowNode, type FlowTestReport } from '@ts6/common';
import { FlowRunner } from './flow-runner.js';
import { BotEngine } from './engine.js';
import { animationConfig, animationFrames } from './animation-manager.js';

// The flow test's promise: a test run of a flow changes nothing - no TeamSpeak write, no
// database row, no music bot command, no HTTP request - whatever actions the flow holds.
// Everything it would touch is recorded here, and the same flow run for real is the
// positive control that the recording sees writes at all.

/** One node per action type executeAction knows; a new action type fails the coverage test until it is added here. */
const ACTIONS: Record<string, Record<string, unknown>> = {
  kick: { reasonId: 5, reasonMsg: 'bye {{event.client_nickname}}' },
  ban: { duration: 60, reason: 'ban' },
  move: { channelId: '5' },
  message: { targetMode: 1, message: 'hi {{event.client_nickname}}' },
  poke: { message: 'poke' },
  channelCreate: { params: { channel_name: 'room {{event.clid}}' } },
  groupAddClient: { groupId: '7' },
  groupRemoveClient: { groupId: '7' },
  webquery: { command: 'clientkick clid=3', storeAs: 'wq' },
  webhook: { url: 'https://93.184.215.14/hook', method: 'POST', body: '{"who":"{{event.clid}}"}', headers: { Authorization: 'Bearer abc' }, storeAs: 'hook' },
  channelEdit: { channelId: '{{temp.lastCreatedChannelId}}', params: { channel_name: 'x' } },
  channelDelete: { channelId: '50', force: true },
  httpRequest: { url: 'https://93.184.215.14/api', method: 'GET', storeAs: 'api' },
  afkMover: { afkChannelId: '9', idleThresholdSeconds: 1 },
  idleKicker: { idleThresholdSeconds: 1 },
  pokeGroup: { groupId: '8', message: 'p' },
  rankCheck: { ranks: '[{"hours":1,"groupId":"9"}]' },
  tempChannelCleanup: { parentChannelId: '40' },
  voicePlay: { botId: '1', songId: '1' },
  voiceStop: { botId: '1' },
  voiceJoinChannel: { botId: '1', channelId: '5', channelPassword: 'pw' },
  voiceLeaveChannel: { botId: '1' },
  voiceVolume: { botId: '1', volume: '30' },
  voicePauseResume: { botId: '1', action: 'pause' },
  voiceSkip: { botId: '1' },
  voiceSeek: { botId: '1', position: '10' },
  generateCode: { length: 5, storeAs: 'code' },
  countOnlineInGroups: { groupIds: '8', storeAs: 'online' },
  listMembership: { listName: 'ignore', operation: 'add', value: '{{event.clid}}' },
  voiceTts: { text: 'hi' },
  supportEnqueue: { queueId: '1' },
  animatedChannel: { channelId: '5', text: 'x' },
};

/** Every action hangs off the trigger with an error branch, so one that fails does not stop the others. */
function everyActionFlow(): FlowDefinition {
  const nodes: FlowNode[] = [{ id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { triggerType: 'event', label: 'T', eventName: 'notifycliententerview' } } as any];
  const edges: any[] = [];
  nodes.push({ id: 'v', type: 'variable', position: { x: 0, y: 0 }, data: { nodeType: 'variable', label: 'V', operation: 'increment', variableName: 'joins', value: '1' } } as any);
  edges.push({ id: 'e-v', source: 't', target: 'v' });
  nodes.push({ id: 'err', type: 'log', position: { x: 0, y: 0 }, data: { nodeType: 'log', label: 'Err', level: 'warn', message: '{{temp.lastError}}' } } as any);
  for (const [actionType, config] of Object.entries(ACTIONS)) {
    nodes.push({ id: actionType, type: 'action', position: { x: 0, y: 0 }, data: { actionType, label: actionType, ...config } } as any);
    edges.push({ id: `e-${actionType}`, source: 't', target: actionType });
    edges.push({ id: `x-${actionType}`, source: actionType, target: 'err', sourceHandle: 'error' });
  }
  return { nodes, edges };
}

const EVENT = { clid: '3', client_database_id: '30', client_nickname: 'Max' };

function rig() {
  const sent: { command: string; params: any }[] = [];
  const answer = (command: string): any[] => {
    switch (command) {
      case 'whoami': return [{ client_id: '1', client_channel_id: '1' }];
      case 'clientlist': return [{ clid: '3', cid: '1', client_type: '0', client_idle_time: '99999999', client_servergroups: '8', client_database_id: '30', client_nickname: 'Max', client_created: '1', client_unique_identifier: 'u3' }];
      case 'servergroupclientlist': return [{ cldbid: '30' }];
      case 'channellist': return [{ cid: '50', pid: '40', total_clients: '0' }];
      case 'clientinfo': return [{ connection_connected_time: '999999999' }];
      case 'channelcreate': return [{ cid: '60' }];
      default: return [];
    }
  };
  const client = {
    execute: async (_sid: number, command: string, params?: any) => { sent.push({ command, params }); return answer(command); },
    executePost: async (_sid: number, command: string, params?: any) => { sent.push({ command, params }); return answer(command); },
  };

  const dbWrites: string[] = [];
  const variables: any[] = [{ id: 1, flowId: 1, name: 'joins', value: '3', scope: 'flow' }];
  const write = (what: string) => async ({ data }: any = {}) => { dbWrites.push(what); return { id: 1, ...data }; };
  const prisma = {
    botExecution: { create: write('botExecution.create'), update: write('botExecution.update'), updateMany: write('botExecution.updateMany') },
    botExecutionLog: { create: write('botExecutionLog.create') },
    botVariable: {
      findFirst: async ({ where }: any) => variables.find((v) => v.name === where.name) ?? null,
      findMany: async () => variables,
      create: write('botVariable.create'),
      update: write('botVariable.update'),
    },
    musicBot: { update: write('musicBot.update') },
    song: { findUnique: async () => ({ id: 1, title: 's', filePath: '/x', source: 'local' }) },
    playlist: { findUnique: async () => null },
    supportQueue: { findFirst: async () => ({ id: 1, serverConfigId: 1, sid: 1, channelId: 10, enabled: true, settings: JSON.stringify({ supporterGroupIds: [50] }) }) },
  };

  const voiceCalls: string[] = [];
  const bot = new Proxy({ status: 'connected', queue: { add: () => voiceCalls.push('queue.add'), next: () => null } }, {
    get: (t: any, k) => (k in t ? t[k] : () => voiceCalls.push(`bot.${String(k)}`)),
  });
  const voice = {
    getBot: () => bot,
    stopBot: async () => { voiceCalls.push('stopBot'); },
    startBot: async () => { voiceCalls.push('startBot'); },
  };

  const runner = new FlowRunner(prisma as any, { getBotClient: () => client } as any, { clients: new Set() } as any, () => undefined);
  runner.setVoiceBotManager(voice as any);
  return { runner, sent, dbWrites, voiceCalls, prisma, client };
}

/** Records every HTTP request axios would send, and sends none. */
async function withRecordedHttp<T>(run: () => Promise<T>): Promise<{ result: T; requests: string[] }> {
  const requests: string[] = [];
  const before = axios.defaults.adapter;
  axios.defaults.adapter = async (config: any) => {
    requests.push(`${config.method} ${config.url}`);
    return { data: '{}', status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    return { result: await run(), requests };
  } finally {
    axios.defaults.adapter = before;
  }
}

const flowInfo = (flowData: FlowDefinition) => ({ id: 1, name: 'test', serverConfigId: 1, virtualServerId: 1, flowData });

test('every action type of executeAction has a node in this test (a new one must be added, and handled in a test run)', () => {
  const source = readFileSync(new URL('./flow-runner.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('private async executeAction('), source.indexOf('private async executeKick('));
  const cases = [...body.matchAll(/case '(\w+)':/g)].map((m) => m[1]).sort();
  assert.ok(cases.length > 25, 'the case list was found');
  assert.deepEqual(cases, Object.keys(ACTIONS).sort());
});

test('a test run of a flow with every action changes nothing', async () => {
  const r = rig();
  const { result: report, requests } = await withRecordedHttp(() => r.runner.test(flowInfo(everyActionFlow()), 't', 'event', EVENT));

  const writes = r.sent.filter((c) => !isReadOnlyCommand(c.command.toLowerCase()));
  assert.deepEqual(writes, [], 'no write reached the TeamSpeak client');
  assert.deepEqual(r.dbWrites, [], 'no database row written');
  assert.deepEqual(r.voiceCalls, [], 'no music bot touched');
  assert.deepEqual(requests, [], 'no HTTP request sent');

  assert.equal(report.status, 'completed', report.error);
  const step = (id: string) => report.steps.find((s) => s.nodeId === id)!;
  for (const actionType of Object.keys(ACTIONS)) assert.ok(step(actionType), `${actionType} ran`);

  // What it would have done instead.
  const written = report.steps.flatMap((s) => s.effects).filter((e) => e.kind === 'write').map((e: any) => e.command);
  for (const command of ['clientkick', 'banclient', 'clientmove', 'sendtextmessage', 'clientpoke', 'channelcreate', 'servergroupaddclient', 'servergroupdelclient', 'channeledit', 'channeldelete']) {
    assert.ok(written.includes(command), `${command} described`);
  }
  assert.deepEqual(step('afkMover').effects.find((e) => e.kind === 'write'), { kind: 'write', command: 'clientmove', params: { clid: '3', cid: '9' }, names: { 3: 'Max' } });
  assert.ok(step('rankCheck').effects.some((e) => e.kind === 'write' && e.command === 'servergroupaddclient'));
  assert.ok(step('tempChannelCleanup').effects.some((e) => e.kind === 'write' && e.command === 'channeldelete'));
  // A created channel's id is simulated and used by the next node.
  assert.ok(step('channelEdit').effects.some((e) => e.kind === 'write' && e.params.cid === FLOW_TEST_SIMULATED_ID));
  const hook = step('webhook').effects.find((e) => e.kind === 'http') as any;
  assert.equal(hook.body, '{"who":"3"}');
  assert.equal(hook.headers.Authorization, MASKED_VALUE);
  assert.ok(step('voiceJoinChannel').effects.some((e) => e.kind === 'voice' && e.params.channelId === '5' && e.params.channelPassword !== 'pw'));
  // The client goes to the queue's waiting channel (10); the queue job does the rest.
  assert.deepEqual(step('supportEnqueue').effects.find((e) => e.kind === 'write'), { kind: 'write', command: 'clientmove', params: { clid: '3', cid: '10' }, names: { 3: 'Max' } });
  assert.ok(step('animatedChannel').effects.some((e) => e.kind === 'note' && e.code === 'animationManagedByEngine'));

  // Variables: read from the database, written only into the report.
  assert.deepEqual(report.variables.find((v) => v.name === 'joins'), { name: 'joins', before: '3', after: '4' });
  assert.ok(report.variables.some((v) => v.name === 'ignore' && v.after === '["3"]'));
  assert.ok(report.variables.some((v) => v.name === 'onlinetime_30'));
  // Values that come from a write or request the test did not make are marked.
  const temp = (name: string) => report.temp.find((t) => t.name === name);
  assert.equal(temp('lastCreatedChannelId')?.simulated, true);
  assert.equal(temp('hook')?.simulated, true);
  assert.equal(temp('wq')?.simulated, true);
  assert.equal(temp('online')?.simulated, false);
  assert.equal(temp('online')?.value, '1');
});

test('positive control: the same flow run for real does write, request and command the bot', async () => {
  const r = rig();
  const { requests } = await withRecordedHttp(() => r.runner.execute(flowInfo(everyActionFlow()), 't', 'event', EVENT));
  const writes = new Set(r.sent.filter((c) => !isReadOnlyCommand(c.command.toLowerCase())).map((c) => c.command));
  for (const command of ['clientkick', 'banclient', 'clientmove', 'sendtextmessage', 'clientpoke', 'channelcreate', 'servergroupaddclient', 'servergroupdelclient', 'channeledit', 'channeldelete']) {
    assert.ok(writes.has(command), `${command} sent`);
  }
  assert.ok(r.dbWrites.includes('botVariable.update') && r.dbWrites.includes('botExecution.create') && r.dbWrites.includes('musicBot.update'));
  assert.ok(r.voiceCalls.includes('stopBot') && r.voiceCalls.includes('startBot'));
  assert.equal(requests.length, 2);
  assert.ok(r.sent.some((c) => c.command === 'clientmove' && c.params.cid === '10'), 'supportEnqueue moved the client into the waiting channel');
});

// --- What a test shows about placeholders, conditions, loops and limits ---

const node = (id: string, type: string, data: object): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as any);
const chain = (...nodes: FlowNode[]): FlowDefinition => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })),
});
const trigger = node('t', 'trigger', { triggerType: 'webhook', webhookPath: 'x', method: 'POST' });
const runTest = (flowData: FlowDefinition, event: Record<string, string> = {}) => rig().runner.test(flowInfo(flowData), 't', 'webhook', event) as Promise<FlowTestReport>;

test('placeholders: resolved, empty, nested, filtered - each one listed', async () => {
  const report = await runTest(
    chain(trigger, node('l', 'log', { nodeType: 'log', level: 'info', message: '{{event.webhook_body.a.b}}|{{event.missing}}|{{event.webhook_body.a.x}}|{{temp.nothing}}|{{event.up|uptime}}|{{exec.executionId}}' })),
    { webhook_body: '{"a":{"b":"deep"}}', up: '90061' },
  );
  const step = report.steps[1];
  assert.equal(step.logs[0].message, 'deep||||1d 1h 1m|0');
  assert.deepEqual(step.placeholders.map((p) => [p.expression, p.value, p.empty]), [
    ['event.webhook_body.a.b', 'deep', false],
    ['event.missing', '', true],
    ['event.webhook_body.a.x', '', true],
    ['temp.nothing', '', true],
    ['event.up|uptime', '1d 1h 1m', false],
    ['exec.executionId', '0', false],
  ]);
});

test('a condition that cannot be evaluated shows why, and takes the false branch', async () => {
  const cond = { ...node('c', 'condition', { nodeType: 'condition', expression: 'event.x ==' }) };
  const report = await runTest({ nodes: [trigger, cond, node('yes', 'log', { nodeType: 'log', level: 'info', message: 'y' }), node('no', 'log', { nodeType: 'log', level: 'info', message: 'n' })], edges: [
    { id: 'a', source: 't', target: 'c' }, { id: 'b', source: 'c', target: 'yes', sourceHandle: 'true' }, { id: 'c', source: 'c', target: 'no', sourceHandle: 'false' },
  ] });
  const step = report.steps.find((s) => s.nodeId === 'c')!;
  assert.equal(step.branch, 'false');
  assert.match(step.conditionError!, /./);
  assert.deepEqual(report.steps.map((s) => s.nodeId), ['t', 'c', 'no']);
});

test('a condition sees a variable written earlier in the same test', async () => {
  const report = await runTest({ nodes: [
    trigger,
    node('v', 'variable', { nodeType: 'variable', operation: 'set', variableName: 'joins', value: '10' }),
    node('c', 'condition', { nodeType: 'condition', expression: 'var.joins == 10' }),
  ], edges: [{ id: 'a', source: 't', target: 'v' }, { id: 'b', source: 'v', target: 'c' }] });
  assert.equal(report.steps.find((s) => s.nodeId === 'c')!.branch, 'true');
  assert.deepEqual(report.variables, [{ name: 'joins', before: '3', after: '10' }]);
});

test('a loop over a read result: iterations are numbered, its write per item described', async () => {
  const report = await runTest({ nodes: [
    trigger,
    node('q', 'action', { actionType: 'webquery', command: 'clientlist', storeAs: 'clients' }),
    node('loop', 'loop', { nodeType: 'loop', arrayVariable: 'clients', itemVariable: 'c' }),
    node('p', 'action', { actionType: 'poke', message: 'hi {{temp.c.client_nickname}}' }),
  ], edges: [{ id: 'a', source: 't', target: 'q' }, { id: 'b', source: 'q', target: 'loop' }, { id: 'c', source: 'loop', target: 'p', sourceHandle: 'body' }] });
  const poke = report.steps.find((s) => s.nodeId === 'p')!;
  assert.equal(poke.iteration, 0);
  assert.equal(poke.placeholders[0].value, 'Max');
  assert.equal(report.temp.find((t) => t.name === 'clients')?.simulated, false);
});

test('limits hold in a test: node visits, delay not waited for, read cap', async () => {
  // A cycle: stopped by the node-visit limit.
  const a = node('a', 'log', { nodeType: 'log', level: 'info', message: 'x' });
  const cyc = await runTest({ nodes: [trigger, a], edges: [{ id: '1', source: 't', target: 'a' }, { id: '2', source: 'a', target: 'a' }] });
  assert.equal(cyc.status, 'failed');
  assert.equal(cyc.errorCode, 'nodeVisits');

  const started = Date.now();
  const delayed = await runTest(chain(trigger, node('d', 'delay', { nodeType: 'delay', delayMs: 600000 }), node('after', 'log', { nodeType: 'log', level: 'info', message: 'done' })));
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(delayed.steps[1].effects, [{ kind: 'delay', ms: 300000 }]);
  assert.equal(delayed.steps[2].nodeId, 'after');

  // More reads than allowed: the test ends, even through an error branch.
  const many = Array.from({ length: FLOW_TEST_MAX_READS + 5 }, (_, i) => node(`r${i}`, 'action', { actionType: 'webquery', command: 'serverinfo' }));
  const reads = await runTest({
    nodes: [trigger, ...many, node('err', 'log', { nodeType: 'log', level: 'warn', message: 'e' })],
    edges: many.flatMap((n, i) => [{ id: `e${i}`, source: i ? many[i - 1].id : 't', target: n.id }, { id: `x${i}`, source: n.id, target: 'err', sourceHandle: 'error' }]),
  });
  assert.equal(reads.status, 'failed');
  assert.equal(reads.errorCode, 'readLimit');
  assert.equal(reads.reads, FLOW_TEST_MAX_READS + 1);
  assert.ok(!reads.steps.some((s) => s.nodeId === 'err'));
});

test('engine: a sample the trigger would ignore runs nothing, a command sample is enriched like a live one', async () => {
  const engine = new BotEngine({} as any, {} as any, {} as any, {} as any) as any;
  const calls: any[] = [];
  engine.flowRunner = { test: async (...args: any[]) => { calls.push(args); return { status: 'completed' }; } };
  const flow = flowInfo({ nodes: [], edges: [] });

  const ev = node('t', 'trigger', { triggerType: 'event', eventName: 'notifycliententerview', filters: { client_type: '0' } });
  const ignored = await engine.testFlow(flow, { nodes: [ev], edges: [] }, undefined, { client_type: '1' });
  assert.equal(ignored.status, 'notTriggered');
  assert.deepEqual(ignored.mismatch, { key: 'client_type', expected: '0', actual: '1' });
  assert.equal(calls.length, 0);

  const bound = node('t', 'trigger', { triggerType: 'command', commandPrefix: '!', commandName: 'hilfe', channelId: '9' });
  await engine.testFlow(flow, { nodes: [bound], edges: [] }, 't', { msg: '!hilfe abc', invokerid: '4' });
  assert.equal(calls[0][3].command_args, 'abc');
  assert.equal(calls[0][3].command_channel_id, '9');
  assert.equal(calls[0][3].clid, '4');

  const hook = node('t', 'trigger', { triggerType: 'webhook', webhookPath: 'p', method: 'POST' });
  await engine.testFlow(flow, { nodes: [hook], edges: [] }, undefined, { body: '{"a":1}', query: '{"secret":"x","q":"1"}' });
  await assert.rejects(engine.testFlow(flow, { nodes: [hook], edges: [] }, undefined, { body: '{nope' }), /must be JSON/);
  await assert.rejects(engine.testFlow(flow, { nodes: [ev, { ...hook, id: 'h' }], edges: [] }, undefined, {}), /Choose one/);
  assert.deepEqual(calls[1][3], { webhook_path: 'p', webhook_method: 'POST', webhook_body: '{"a":1}', webhook_query: '{"q":"1"}' });
});

// --- Forced branches, filter overview, animation preview ---

test('a forced branch is taken and marked; the expression is still evaluated and its error shown', async () => {
  const flowData: FlowDefinition = { nodes: [
    trigger,
    node('c', 'condition', { nodeType: 'condition', expression: 'event.x ==' }),
    node('yes', 'log', { nodeType: 'log', level: 'info', message: 'y' }),
    node('no', 'log', { nodeType: 'log', level: 'info', message: 'n' }),
  ], edges: [
    { id: 'a', source: 't', target: 'c' }, { id: 'b', source: 'c', target: 'yes', sourceHandle: 'true' }, { id: 'c', source: 'c', target: 'no', sourceHandle: 'false' },
  ] };
  const report = await rig().runner.test(flowInfo(flowData), 't', 'webhook', {}, undefined, new Map([['c', true]]));
  const cond = report.steps.find((s) => s.nodeId === 'c')!;
  assert.equal(cond.branch, 'true');
  assert.equal(cond.forced, true);
  assert.match(cond.conditionError!, /./);
  assert.deepEqual(report.steps.map((s) => s.nodeId), ['t', 'c', 'yes']);
  // Not forced: the expression decides, nothing is marked.
  const plain = await rig().runner.test(flowInfo(flowData), 't', 'webhook', {});
  assert.equal(plain.steps.find((s) => s.nodeId === 'c')!.forced, undefined);
  assert.equal(plain.steps.find((s) => s.nodeId === 'c')!.branch, 'false');
});

test('engine: every filter is listed with its result; animations are previewed with the frames the timer would set', async () => {
  const engine = new BotEngine({} as any, {} as any, {} as any, {} as any) as any;
  const forced: any[] = [];
  engine.flowRunner = { test: async (...args: any[]) => { forced.push(args[5]); return { status: 'completed', steps: [] }; } };
  const flow = flowInfo({ nodes: [], edges: [] });
  const ev = node('t', 'trigger', { triggerType: 'event', eventName: 'notifycliententerview', filters: { client_type: '0', ctid: '5' } });
  const anim = node('a', 'action', { actionType: 'animatedChannel', channelId: '9', text: 'Hi', style: 'blink', intervalSeconds: '0.5', prefix: '' });

  const missed = await engine.testFlow(flow, { nodes: [ev, anim], edges: [] }, undefined, { client_type: '0', ctid: '7' });
  assert.equal(missed.status, 'notTriggered');
  assert.deepEqual(missed.filters, [
    { key: 'client_type', expected: '0', actual: '0', ok: true },
    { key: 'ctid', expected: '5', actual: '7', ok: false },
  ]);
  // A frame of only spaces (TeamSpeak refuses it) is listed as '' - the timer skips it.
  assert.deepEqual(missed.animations, [{ nodeId: 'a', label: 'a', channelId: '9', intervalSeconds: 0.5, frames: ['Hi', 'Hi', '--', 'Hi', 'Hi', ''] }]);
  assert.deepEqual(animationFrames(animationConfig(anim.data as any)), missed.animations[0].frames);

  const hit = await engine.testFlow(flow, { nodes: [ev, anim], edges: [] }, undefined, { client_type: '0', ctid: '5' }, { c1: false });
  assert.ok(hit.filters.every((f: any) => f.ok));
  assert.equal(hit.animations.length, 1);
  assert.deepEqual([...forced[0]], [['c1', false]]);
});
