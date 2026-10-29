import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issuedBeforeCutoff, loadSessionCutoff } from './session-cutoff.js';

const prismaWith = (value: string | null) => ({
  appSetting: { findUnique: async () => (value === null ? null : { key: 'sessions_valid_after', value }) },
}) as any;

test('without a restore every token passes; after one, only tokens issued from then on', async () => {
  await loadSessionCutoff(prismaWith(null));
  assert.equal(issuedBeforeCutoff(1), false);
  await loadSessionCutoff(prismaWith(String(Date.parse('2026-10-29T12:00:00.000Z'))));
  const cut = Date.parse('2026-10-29T12:00:00.000Z') / 1000;
  assert.equal(issuedBeforeCutoff(cut - 60), true);
  assert.equal(issuedBeforeCutoff(cut), false);
  assert.equal(issuedBeforeCutoff(cut + 60), false);
  assert.equal(issuedBeforeCutoff(undefined), true);
  await loadSessionCutoff(prismaWith('garbage'));
  assert.equal(issuedBeforeCutoff(1), false);
});
