import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowRunner } from './flow-runner.js';
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
