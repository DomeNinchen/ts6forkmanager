import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOf, countPair } from '../src/lib/host-info.ts';

test('countOf: strings from hostinfo, real 0, missing fields', () => {
  assert.equal(countOf('0'), 0);
  assert.equal(countOf('32'), 32);
  assert.equal(countOf(3), 3);
  assert.equal(countOf(undefined), null);
  assert.equal(countOf(null), null);
  assert.equal(countOf(''), null);
  assert.equal(countOf('abc'), null);
});

test('countPair: running virtual servers / created servers', () => {
  // fixed values, several running servers cannot be made on the licence-limited test server
  assert.equal(countPair('0', 1), '0 / 1');
  assert.equal(countPair('1', 1), '1 / 1');
  assert.equal(countPair('3', 5), '3 / 5');
  assert.equal(countPair('1', undefined), '1');
  assert.equal(countPair(undefined, 4), '-');
});

test('countPair: user slots', () => {
  assert.equal(countPair('0', '32'), '0 / 32');
  assert.equal(countPair('4', '32'), '4 / 32');
  assert.equal(countPair(undefined, undefined), '-');
});
