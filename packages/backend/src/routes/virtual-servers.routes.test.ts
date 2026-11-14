import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { virtualServerRoutes } from './virtual-servers.routes.js';
import { errorHandler, TSApiError } from '../middleware/error-handler.js';

// A stand-in for TS6 that answers serverdelete/serverstop/serverlist the way the real server did
// (measured on 6.0.0-beta13.1): running or "online virtual" -> 1035, unknown sid -> 1024.
function fakeTs(status: Map<number, string>) {
  const calls: string[] = [];
  return {
    calls,
    getClient: () => ({
      execute: async (_sid: number, cmd: string, params?: { sid: number }) => {
        calls.push(`${cmd}${params ? ` ${params.sid}` : ''}`);
        if (cmd === 'serverlist') return [...status].map(([id, s]) => ({ virtualserver_id: String(id), virtualserver_status: s }));
        const s = status.get(params!.sid);
        if (s === undefined) throw new TSApiError(1024, 'invalid serverID');
        if (cmd === 'serverstop') { status.set(params!.sid, 'offline'); return {}; }
        if (cmd === 'serverdelete') {
          if (s !== 'offline') throw new TSApiError(1035, 'server got an invalid status for this operation');
          status.delete(params!.sid);
          return {};
        }
        throw new Error(`unexpected ${cmd}`);
      },
    }),
  };
}

async function withApp(status: Map<number, string>, fn: (del: (sid: string) => Promise<{ status: number; code?: string }>, calls: string[]) => Promise<void>) {
  const app = express();
  const ts = fakeTs(status);
  app.locals.connectionPool = ts;
  app.use((req, _res, next) => { (req as any).user = { id: 1, role: 'admin' }; next(); });
  app.use('/servers/:configId/virtual-servers', virtualServerRoutes);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/servers/1/virtual-servers`;
  try {
    await fn(async (sid) => {
      const r = await fetch(`${base}/${sid}`, { method: 'DELETE' });
      return { status: r.status, code: (await r.json()).code };
    }, ts.calls);
  } finally {
    server.close();
  }
}

test('delete: stopped goes, running stays (and is never stopped), virtual is stopped then deleted', async () => {
  const status = new Map([[1, 'online'], [2, 'offline'], [3, 'online virtual']]);
  await withApp(status, async (del, calls) => {
    assert.deepEqual(await del('2'), { status: 200, code: undefined });
    assert.deepEqual(await del('1'), { status: 409, code: 'SERVER_RUNNING' });
    assert.equal(status.get(1), 'online');
    assert.ok(!calls.includes('serverstop 1'), 'a running server is never stopped by a delete');
    assert.deepEqual(await del('3'), { status: 200, code: undefined });
    assert.deepEqual([...status.keys()], [1]);
  });
});

test('delete: unknown sid is 404, a malformed one 400 without asking TeamSpeak', async () => {
  await withApp(new Map([[1, 'online']]), async (del, calls) => {
    assert.deepEqual(await del('9'), { status: 404, code: 'SERVER_NOT_FOUND' });
    for (const bad of ['0', '05', 'abc', '-1']) assert.equal((await del(bad)).status, 400, bad);
    assert.deepEqual(calls, ['serverdelete 9']);
  });
});
