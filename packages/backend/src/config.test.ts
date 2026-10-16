import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRefreshExpiryMs } from './config.js';

const DAY = 86_400_000;

test('JWT_REFRESH_EXPIRY: number with a unit', () => {
  assert.equal(parseRefreshExpiryMs('7d'), 7 * DAY);
  assert.equal(parseRefreshExpiryMs('12h'), 12 * 3_600_000);
  assert.equal(parseRefreshExpiryMs('30m'), 30 * 60_000);
  assert.equal(parseRefreshExpiryMs('90s'), 90_000);
  assert.equal(parseRefreshExpiryMs('2w'), 14 * DAY);
  assert.equal(parseRefreshExpiryMs(' 3D '), 3 * DAY);
});

test('JWT_REFRESH_EXPIRY: unset or unusable falls back to 7 days', () => {
  for (const raw of [undefined, '', '0d', '7', 'banana', '-1d', '1.5d', '7 days']) {
    assert.equal(parseRefreshExpiryMs(raw), 7 * DAY, String(raw));
  }
});
