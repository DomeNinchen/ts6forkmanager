import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { webhookIngress } from './webhook-ingress.js';
import { isValidWebhookSetting, webhookSettings, WEBHOOK_DEFAULTS } from '../utils/webhook-settings.js';

test('webhook settings: whole numbers inside the bounds only', () => {
  assert.equal(isValidWebhookSetting('bodyLimitKb', 1), true);
  assert.equal(isValidWebhookSetting('bodyLimitKb', 10_240), true);
  assert.equal(isValidWebhookSetting('bodyLimitKb', 0), false);
  assert.equal(isValidWebhookSetting('bodyLimitKb', -5), false);
  assert.equal(isValidWebhookSetting('bodyLimitKb', 10_241), false);
  assert.equal(isValidWebhookSetting('validPerMinute', 1.5), false);
  assert.equal(isValidWebhookSetting('failedPerMinute', '10'), false);
  assert.equal(isValidWebhookSetting('failedPerMinute', 1_001), false);
  assert.deepEqual(webhookSettings(), WEBHOOK_DEFAULTS);
});

// A real server with the real middleware in front of a handler that plays the engine:
// path "ok" is a valid call, anything else the engine's 404.
async function withServer(fn: (url: string) => Promise<void>) {
  const app = express();
  let parsed = 0;
  app.all('/hook/*path', ...webhookIngress(), (req, res) => {
    if (req.body !== undefined) parsed++;
    if (req.params.path?.[0] === 'ok') res.json({ triggered: 1, parsed });
    else res.status(404).json({ error: 'Not found' });
  });
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ type: err.type });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`);
  } finally {
    server.close();
  }
}

test('failed calls hit their limit, valid calls are counted apart', async () => {
  await withServer(async (url) => {
    const { failedPerMinute } = WEBHOOK_DEFAULTS;
    for (let i = 0; i < failedPerMinute; i++) {
      assert.equal((await fetch(`${url}/nope`, { method: 'POST' })).status, 404);
    }
    const blocked = await fetch(`${url}/nope`, { method: 'POST' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'Retry-After is set');
    // The same address is now blocked for valid calls too: the failed limiter runs first.
    assert.equal((await fetch(`${url}/ok`, { method: 'POST' })).status, 429);
  });
  await withServer(async (url) => {
    // Valid calls never count against the failed limit.
    for (let i = 0; i < WEBHOOK_DEFAULTS.failedPerMinute + 5; i++) {
      assert.equal((await fetch(`${url}/ok`, { method: 'POST' })).status, 200);
    }
    assert.equal((await fetch(`${url}/nope`, { method: 'POST' })).status, 404);
  });
});

test('body over the limit is refused with 413 before it is parsed, one just under passes', async () => {
  await withServer(async (url) => {
    const limit = WEBHOOK_DEFAULTS.bodyLimitKb * 1024;
    const json = (bytes: number) => JSON.stringify({ x: 'a'.repeat(bytes - 8) }); // {"x":""} is 8 bytes
    const under = await fetch(`${url}/ok`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json(limit) });
    assert.equal(under.status, 200);
    assert.equal(((await under.json()) as any).parsed, 1);
    const over = await fetch(`${url}/ok`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json(limit + 1) });
    assert.equal(over.status, 413);
    assert.equal(((await over.json()) as any).error, 'Request body is too large');
    assert.equal(over.headers.get('connection'), 'close');
  });
});
