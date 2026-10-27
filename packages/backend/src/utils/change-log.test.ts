import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI_CHANGE_SECRET_PLACEHOLDER } from '@ts6/common';
import { flushChangeLog, maskChangeBody, recordChange, type ChangeBase, type ChangeOutcome } from './change-log.js';

const SECRET = 'THROWAWAY-SECRET-abc123';

test('secret fields are masked while ordinary fields and the flag stay readable', () => {
  const json = maskChangeBody({
    name: 'Lobby',
    apiKey: SECRET,
    sshPassword: SECRET,
    newPassword: SECRET,
    clientSecret: SECRET,
    botApiKey: SECRET,
    cpw: SECRET,
    channel_password: SECRET,
    channel_flag_password: '1',
  })!;
  assert.ok(!json.includes(SECRET), 'a secret value leaked into the change log');
  assert.ok(json.includes('"name":"Lobby"'));
  // The 0/1 flag is not a secret and must stay readable (same carve-out as classification.ts).
  assert.ok(json.includes('"channel_flag_password":"1"'));
  assert.ok(json.includes(UI_CHANGE_SECRET_PLACEHOLDER));
});

test('a nested secret is masked too', () => {
  assert.ok(!maskChangeBody({ sso: { clientSecret: SECRET } })!.includes(SECRET));
});

test('an empty secret (the "leave it unchanged" case) is not reported as changed', () => {
  const json = maskChangeBody({ apiKey: '', name: 'x' })!;
  assert.ok(!json.includes(UI_CHANGE_SECRET_PLACEHOLDER));
  assert.ok(json.includes('"apiKey":""'));
});

test('a value too large to keep is dropped, only its length remains', () => {
  const big = 'A'.repeat(1000);
  const json = maskChangeBody({ avatarData: big })!;
  assert.ok(!json.includes(big));
  assert.ok(json.includes('(omitted, 1000 chars)'));
});

test('an empty body is stored as nothing', () => {
  assert.equal(maskChangeBody({}), null);
  assert.equal(maskChangeBody(undefined), null);
});

test('non-critical rows are written as one batch, and a flush with nothing waiting writes nothing', async () => {
  const batches: unknown[][] = [];
  const prisma = { uiChangeLog: { createMany: async ({ data }: { data: unknown[] }) => { batches.push(data); return { count: data.length }; } } } as any;
  const row = (n: number): ChangeBase & ChangeOutcome => ({
    createdAt: new Date(), userId: 1, username: 'a', role: 'admin', ip: null, method: 'PUT', area: 'channels',
    routePattern: '/x', serverConfigId: null, virtualServerId: null, targetId: String(n), body: null,
    status: 'ok', httpStatus: 200, errorMessage: null, durationMs: 1, loggedToTeamSpeak: false,
  });
  recordChange(prisma, row(1));
  recordChange(prisma, row(2));
  recordChange(prisma, row(3));
  await flushChangeLog(prisma);
  await flushChangeLog(prisma);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].map((r: any) => r.targetId), ['1', '2', '3']);
});
