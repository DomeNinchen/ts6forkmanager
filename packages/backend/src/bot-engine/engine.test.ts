import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotEngine } from './engine.js';

// The concurrency limit seen from a webhook caller: what it is told, and what the
// flow's execution history keeps of dropped triggers.
function setup(limit: number) {
  const rows: any[] = [];
  const prisma = {
    botExecution: {
      create: async ({ data }: any) => { rows.push({ id: rows.length + 1, ...data }); return rows[rows.length - 1]; },
      update: async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data),
    },
  };
  const engine = new BotEngine(prisma as any, {} as any, {} as any, {} as any) as any;
  engine.setMaxConcurrentPerFlow(limit);

  // Every started execution waits until the test lets it finish.
  const pending: Array<() => void> = [];
  engine.flowRunner = { execute: () => new Promise<void>((resolve) => pending.push(resolve)) };

  for (const id of [1, 2]) {
    engine.flows.set(id, { id, name: `flow ${id}`, flowData: { nodes: [], edges: [] }, triggerNodes: [] });
  }
  engine.webhookEntries = [
    { flowId: 1, nodeId: 't', path: 'hook', method: 'POST', secret: 's3cret' },
    { flowId: 2, nodeId: 't', path: 'hook', method: 'POST', secret: 's3cret' },
  ];

  const call = (secret = 's3cret', path = 'hook') => {
    const res: any = { statusCode: 200, headers: {} };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.set = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    engine.handleWebhookRequest({ params: { path: [path] }, method: 'POST', headers: { 'x-webhook-secret': secret }, query: {}, body: {} }, res);
    return { status: res.statusCode, body: res.body, retryAfter: res.headers['Retry-After'] };
  };
  const finishAll = async () => { pending.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); };
  return { engine, rows, call, finishAll };
}

test('triggers beyond the limit are dropped, reported and recorded once per minute', async () => {
  const { engine, rows, call, finishAll } = setup(2);

  // Both flows sit on the same path: two calls fill both flows' limit.
  assert.deepEqual(call(), { status: 200, body: { triggered: 2, dropped: 0 }, retryAfter: undefined });
  assert.deepEqual(call(), { status: 200, body: { triggered: 2, dropped: 0 }, retryAfter: undefined });

  // Third and fourth call: everything dropped -> 429.
  assert.deepEqual(call(), { status: 429, body: { triggered: 0, dropped: 2 }, retryAfter: '5' });
  assert.deepEqual(call(), { status: 429, body: { triggered: 0, dropped: 2 }, retryAfter: '5' });

  // Wrong secret and unknown path stay the plain 404, overload or not.
  assert.deepEqual(call('wrong'), { status: 404, body: { error: 'Not found' }, retryAfter: undefined });
  assert.deepEqual(call('s3cret', 'nope'), { status: 404, body: { error: 'Not found' }, retryAfter: undefined });

  // One 'dropped' row per flow, not one per dropped trigger.
  await new Promise((r) => setImmediate(r));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === 'dropped' && r.triggeredBy === 'webhook'));

  // The count runs back down: after the executions end, both flows start again.
  await finishAll();
  assert.deepEqual(call(), { status: 200, body: { triggered: 2, dropped: 0 }, retryAfter: undefined });

  // Closing the window (here by stopping the engine) writes the final counts.
  await engine.stop();
  assert.deepEqual(rows.map((r) => JSON.parse(r.triggerData)), [{ dropped: 2 }, { dropped: 2 }]);
});

test('a partial answer when only one of two flows on a path is full', async () => {
  const { engine, call } = setup(1);
  // Fill flow 1 only: drop flow 2's registration for one call.
  const both = engine.webhookEntries;
  engine.webhookEntries = both.filter((w: any) => w.flowId === 1);
  assert.equal(call().body.triggered, 1);
  engine.webhookEntries = both;

  assert.deepEqual(call(), { status: 200, body: { triggered: 1, dropped: 1 }, retryAfter: undefined });
  await engine.stop();
});

test('after a restart, waiting executions go on and count against the limit; one of a switched-off flow is cancelled', async () => {
  const { engine, rows, call, finishAll } = setup(1);
  engine.webhookEntries = engine.webhookEntries.filter((w: any) => w.flowId === 1);
  rows.push(
    { id: 1, flowId: 1, status: 'waiting', resumeNodeId: 'n0', resumeAt: new Date(), state: '{}' },
    { id: 2, flowId: 9, status: 'waiting', resumeNodeId: 'n0', resumeAt: new Date(), state: '{}' },
  );
  engine.prisma.botExecution.findMany = async ({ where }: any) => rows.filter((r) => r.status === where.status);
  const resumed: number[] = [];
  const pending: Array<() => void> = [];
  engine.flowRunner.resume = (_flow: any, row: any) => { resumed.push(row.id); return new Promise<void>((r) => pending.push(r)); };

  await engine.resumeWaitingExecutions();
  assert.deepEqual(resumed, [1]);
  assert.equal(rows[1].status, 'cancelled');
  // The resumed one fills flow 1's limit of 1.
  assert.equal(call().status, 429);
  pending.forEach((f) => f());
  await finishAll();
  assert.equal(call().status, 200);
  await finishAll();
  await engine.stop();
});

test('every Animated Channel node of a flow runs, at its speed, in its time zone, under the bot identity', async () => {
  const names = new Map<string, string[]>();
  const client = { executePost: async (_sid: number, _cmd: string, p: any) => { names.set(p.cid, [...(names.get(p.cid) ?? []), p.channel_name]); return []; } };
  // Only the bot identity exists here: an animation asking for the admin client would fail.
  const engine = new BotEngine({} as any, { getBotClient: () => client } as any, {} as any, {} as any) as any;
  const node = (id: string, channelId: string, timezone: string) => ({
    id, type: 'action', position: { x: 0, y: 0 },
    data: { actionType: 'animatedChannel', label: id, channelId, text: '{{time.hours}}', style: 'blink', intervalSeconds: '0.25', prefix: '', timezone },
  });
  engine.flows.set(1, { id: 1, flowData: { nodes: [node('a', '10', 'Asia/Tokyo'), node('b', '20', 'America/Los_Angeles')], edges: [] }, triggerNodes: [] });

  engine.startAnimationsForFlow(1, 1, 1);
  await new Promise((r) => setTimeout(r, 600));
  engine.animationManager.stopAnimation(1);
  const hour = (timeZone: string) => String(Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(new Date()))).padStart(2, '0');

  // Both channels, more than the first frame each (0.25 s, not the 3 s fallback), each in its own zone.
  assert.ok((names.get('10')?.length ?? 0) >= 2 && (names.get('20')?.length ?? 0) >= 2, JSON.stringify([...names]));
  assert.equal(names.get('10')![0], hour('Asia/Tokyo'));
  assert.equal(names.get('20')![0], hour('America/Los_Angeles'));

  // Stopped for good: no more renames.
  const count = names.get('10')!.length + names.get('20')!.length;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(names.get('10')!.length + names.get('20')!.length, count);
});

test('disabling and enabling a flow keeps counting the executions still running', async () => {
  const { engine, call, finishAll } = setup(1);
  engine.webhookEntries = engine.webhookEntries.filter((w: any) => w.flowId === 1);
  const [flow, entry] = [engine.flows.get(1), engine.webhookEntries[0]];
  assert.equal(call().status, 200);

  // What a quick off/on does to the registrations, with the first execution still running.
  await engine.disableFlow(1);
  engine.flows.set(1, flow);
  engine.webhookEntries.push(entry);
  assert.equal(call().status, 429);

  await finishAll();
  assert.equal(call().status, 200);
  await finishAll();
  assert.equal(engine.executionCounts.size, 0);
  await engine.stop();
});
