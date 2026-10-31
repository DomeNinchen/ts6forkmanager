import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BULK_MAX, clientDbBanToBulk, clientDbDeleteToBulk, type BulkOutcome } from '@ts6/common';
import type { Request, Response } from 'express';
import { bulkIds, isDryRun, planned, runPerTarget, sendPreview } from './bulk.js';
import { bulkDiffJson } from './change-log-snapshots.js';
import { AppError } from '../middleware/error-handler.js';

test('bulkIds takes 1..BULK_MAX positive ids, each once', () => {
  assert.deepEqual(bulkIds([3, '4', 3], 'clids'), [3, 4]);
  assert.throws(() => bulkIds([], 'clids'), AppError);
  assert.throws(() => bulkIds('3', 'clids'), AppError);
  assert.throws(() => bulkIds([0], 'clids'), AppError);
  assert.throws(() => bulkIds(Array.from({ length: BULK_MAX + 1 }, (_, i) => i + 1), 'clids'), AppError);
  assert.equal(bulkIds(Array.from({ length: BULK_MAX }, (_, i) => i + 1), 'clids').length, BULK_MAX);
});

test('runPerTarget reports each target, skips the ones with a reason and keeps the order', async () => {
  const ran: number[] = [];
  const outcomes = await runPerTarget(
    [{ id: 1, name: 'a' }, { id: 2, name: 'b', reason: 'protected' }, { id: 3, name: 'c' }, { id: 4, name: 'd' }],
    async (id) => {
      ran.push(id);
      if (id === 3) throw new Error('invalid clientID');
    },
  );
  assert.deepEqual(ran.sort(), [1, 3, 4]);
  assert.deepEqual(outcomes, [
    { id: 1, name: 'a', status: 'ok' },
    { id: 2, name: 'b', status: 'skipped', reason: 'protected' },
    { id: 3, name: 'c', status: 'failed', message: 'invalid clientID' },
    { id: 4, name: 'd', status: 'ok' },
  ]);
});

test('a preview runs nothing, says what would happen and keeps the change log out', () => {
  assert.equal(isDryRun({ body: { dryRun: true } } as Request), true);
  assert.equal(isDryRun({ body: { dryRun: 'true' } } as Request), false); // only the JSON boolean
  assert.equal(isDryRun({ body: undefined } as Request), false);
  assert.deepEqual(planned([{ id: 1, name: 'a' }, { id: 2, name: 'b', reason: 'not-found' }]), [
    { id: 1, name: 'a', status: 'ok' }, { id: 2, name: 'b', status: 'skipped', reason: 'not-found' },
  ]);
  let sent: unknown;
  const res = { locals: {} as Record<string, unknown>, json: (b: unknown) => { sent = b; } } as unknown as Response;
  sendPreview(res, [{ id: 1, name: 'a', status: 'ok' }]);
  assert.deepEqual(sent, { outcomes: [{ id: 1, name: 'a', status: 'ok' }], dryRun: true });
  assert.equal(res.locals.dryRun, true);
  assert.equal(res.locals.bulkOutcomes, undefined);
});

test('runPerTarget runs at most four at a time', async () => {
  let running = 0;
  let peak = 0;
  await runPerTarget(Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: String(i) })), async () => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
  });
  assert.equal(peak, 4);
});

test('client database results become bulk outcomes', () => {
  assert.deepEqual(clientDbBanToBulk([
    { cldbid: 7, nickname: 'Anna', target: 'ip', status: 'created', banid: 3 },
    { cldbid: 8, nickname: '', target: 'ip', status: 'skipped', message: 'no-value' },
    { cldbid: 9, nickname: 'Max', target: 'uid', status: 'failed', message: 'denied' },
    { cldbid: 10, nickname: '', target: 'uid', status: 'skipped', message: 'not-found' },
  ]).map((o) => [o.name, o.status, o.reason ?? o.message ?? '']), [
    ['Anna (ip)', 'ok', ''], ['#8 (ip)', 'skipped', 'no-value'], ['Max (uid)', 'failed', 'denied'], ['#10 (uid)', 'skipped', 'not-found'],
  ]);
  assert.deepEqual(clientDbDeleteToBulk({ deleted: [1], online: [2], failed: [{ cldbid: 3, message: 'x' }] }).map((o) => `${o.id}:${o.status}:${o.reason ?? o.message ?? ''}`),
    ['1:ok:', '2:skipped:online', '3:failed:x']);
});

test('bulkDiffJson keeps the counts, the failures first, and stays under the size cap', () => {
  const outcomes: BulkOutcome[] = Array.from({ length: 500 }, (_, i) =>
    i % 50 === 0 ? { id: i, name: `n${i}`, status: 'failed', message: 'x'.repeat(300) } : { id: i, name: `n${i}`, status: 'ok' });
  const { bulk } = JSON.parse(bulkDiffJson(outcomes));
  assert.deepEqual([bulk.ok, bulk.skipped, bulk.failed], [490, 0, 10]);
  assert.ok(bulk.items.length > 0 && bulk.items.length <= 100);
  assert.equal(bulk.items[0].status, 'failed');
  assert.ok(bulkDiffJson(outcomes).length <= 16000);
});
