import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'dgram';
import http from 'http';
import type { AddressInfo } from 'net';
import { isInit1Answer, sidecarStep, voiceStep } from './connection-diagnosis.js';

const init1 = (step: number) => Buffer.concat([Buffer.from('TS3INIT1'), Buffer.from([0, 101, 0x88, step]), Buffer.alloc(20)]);

test('only a TeamSpeak Init1 answer counts as a voice answer', () => {
  assert.equal(isInit1Answer(init1(1)), true);
  assert.equal(isInit1Answer(init1(3)), false);
  assert.equal(isInit1Answer(Buffer.from('HTTP/1.1 400 Bad Request')), false);
  assert.equal(isInit1Answer(Buffer.alloc(4)), false);
});

test('voice step: answer, wrong answer, silence', async (t) => {
  const server = dgram.createSocket('udp4');
  let reply: Buffer | null = init1(1);
  server.on('message', (msg, from) => {
    // The probe is a client Init0: MAC "TS3INIT1", pid 101, cid 0, flags 0x88, step 0.
    assert.equal(msg.subarray(0, 8).toString(), 'TS3INIT1');
    assert.equal(msg[12], 0x88);
    assert.equal(msg[17], 0);
    if (reply) server.send(reply, from.port, from.address);
  });
  await new Promise<void>((r) => server.bind(0, '127.0.0.1', r));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;

  const ok = await voiceStep('127.0.0.1', port, 1);
  assert.deepEqual([ok.status, ok.cause, ok.port, ok.sid], ['ok', 'ok', port, 1]);

  reply = Buffer.from('nope');
  assert.equal((await voiceStep('127.0.0.1', port)).cause, 'unexpected-response');

  reply = null;
  const silent = await voiceStep('127.0.0.1', port);
  assert.deepEqual([silent.status, silent.cause], ['failed', 'timeout']);
});

test('sidecar step: not configured, healthy, wrong answer, nothing listening', async (t) => {
  assert.deepEqual([(await sidecarStep(undefined)).status, (await sidecarStep(undefined)).cause], ['skipped', 'not-configured']);

  let body = JSON.stringify({ status: 'ok', videoPort: 1, audioPort: 2 });
  const server = http.createServer((req, res) => { assert.equal(req.url, '/health'); res.end(body); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  assert.equal((await sidecarStep(url)).status, 'ok');
  body = '<html>';
  assert.equal((await sidecarStep(url)).cause, 'unexpected-response');

  const closed = http.createServer();
  await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
  const closedPort = (closed.address() as AddressInfo).port;
  await new Promise((r) => closed.close(r));
  const refused = await sidecarStep(`http://127.0.0.1:${closedPort}`);
  assert.deepEqual([refused.status, refused.cause], ['failed', 'refused']);
});
