import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { decryptOrNull, encrypt } from '../utils/crypto.js';
import { ConnectionPool } from './connection-pool.js';

/** What a value stored by an installation with another ENCRYPTION_KEY looks like. */
function encryptWithOtherKey(plain: string): string {
  const key = scryptSync('another-installations-key', 'ts6-webui-enc-v1', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = cipher.update(plain, 'utf8', 'hex') + cipher.final('hex');
  return `enc:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data}`;
}

test('decryptOrNull: the value with the running key, null with another key', () => {
  assert.equal(decryptOrNull(encrypt('secret'), 'test value', 'test remedy'), 'secret');
  assert.equal(decryptOrNull(encryptWithOtherKey('secret'), 'test value', 'test remedy'), null);
});

test('a connection whose key cannot be decrypted is left out; the others and the start go on', async () => {
  const servers = [
    { id: 1, host: '127.0.0.1', webqueryPort: 10080, apiKey: encrypt('good'), botApiKey: encryptWithOtherKey('bot'), useHttps: false, queryNickname: null, botQueryName: null },
    { id: 2, host: '127.0.0.1', webqueryPort: 10080, apiKey: encryptWithOtherKey('foreign'), botApiKey: null, useHttps: false, queryNickname: null, botQueryName: null },
  ];
  const prisma = { tsServerConfig: { findMany: async () => servers } } as any;
  const pool = new ConnectionPool(prisma);
  await pool.initialize();
  assert.equal(pool.hasClient(1), true);
  assert.equal(pool.hasClient(2), false);
  // No bot identity for 1 either: flows fall back to the connection's own client.
  assert.equal(pool.getBotClient(1), pool.getClient(1));
  pool.destroy();
});
