import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { isPrivateIP, ssrfSafeAxiosOptions } from './url-validator.js';

test('isPrivateIP: internal addresses in every spelling are private', () => {
  for (const ip of [
    '127.0.0.1', '10.1.2.3', '172.18.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '::1', '[::1]', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '[::ffff:7f00:1]',
  ]) assert.equal(isPrivateIP(ip), true, ip);
});

test('isPrivateIP: public addresses and hostnames are not', () => {
  // A hostname that merely starts like an IPv6 prefix used to count as private
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', 'fdroid.org', 'fc-koeln.de', 'example.com']) {
    assert.equal(isPrivateIP(ip), false, ip);
  }
});

/** A server that redirects every request to `to` with a 307 (method and body kept). */
async function redirector(to: (port: number) => string): Promise<{ url: string; close: () => void; targetHits: () => number }> {
  let hits = 0;
  const target = http.createServer((_req, res) => { hits++; res.end('internal'); });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const targetPort = (target.address() as AddressInfo).port;
  const front = http.createServer((_req, res) => { res.writeHead(307, { location: to(targetPort) }); res.end(); });
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(front.address() as AddressInfo).port}/`,
    close: () => { front.close(); target.close(); },
    targetHits: () => hits,
  };
}

test('a redirect to an internal address literal is not followed', async () => {
  const s = await redirector((port) => `http://127.0.0.1:${port}/source`);
  try {
    await assert.rejects(axios.post(s.url, { source: 'x' }, { ...ssrfSafeAxiosOptions, timeout: 5000 }));
    assert.equal(s.targetHits(), 0);
    // Control: without the options the same redirect does reach the internal server
    await axios.post(s.url, { source: 'x' }, { timeout: 5000 });
    assert.equal(s.targetHits(), 1);
  } finally { s.close(); }
});

test('a redirect to a name that resolves internally is not followed', async () => {
  const s = await redirector((port) => `http://localhost:${port}/source`);
  try {
    await assert.rejects(axios.get(s.url, { ...ssrfSafeAxiosOptions, timeout: 5000 }), /private IP/);
    assert.equal(s.targetHits(), 0);
  } finally { s.close(); }
});
