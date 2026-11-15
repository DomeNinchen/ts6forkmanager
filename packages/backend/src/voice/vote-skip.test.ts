import { test } from 'node:test';
import assert from 'node:assert/strict';
import { votesNeeded, tallyVotes } from './vote-skip.js';

const DEFAULT = { percent: 50, minVotes: 1 };

test('more than half, at least one vote', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => votesNeeded(n, DEFAULT)), [1, 2, 2, 3, 3]);
});

test('minimum votes wins over the percentage, also when alone', () => {
  const rule = { percent: 50, minVotes: 2 };
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => votesNeeded(n, rule)), [2, 2, 2, 3, 3]);
});

test('exactly at the threshold', () => {
  // 75 % of 4 = 3 -> more than that needs 4; 74 % of 4 = 2.96 -> 3
  assert.equal(votesNeeded(4, { percent: 75, minVotes: 1 }), 4);
  assert.equal(votesNeeded(4, { percent: 74, minVotes: 1 }), 3);
  assert.equal(votesNeeded(4, { percent: 100, minVotes: 1 }), 4, 'never more than everybody');
  assert.equal(votesNeeded(4, { percent: 0, minVotes: 1 }), 1);
});

test('broken inputs fall back to safe values', () => {
  assert.equal(votesNeeded(0, DEFAULT), 1, 'empty channel never passes without a vote');
  assert.equal(votesNeeded(-3, DEFAULT), 1);
  assert.equal(votesNeeded(NaN, DEFAULT), 1);
  assert.equal(votesNeeded(4, { percent: NaN, minVotes: 1 }), 3, 'NaN percent = 50');
  assert.equal(votesNeeded(4, { percent: 500, minVotes: 0 }), 4);
  assert.equal(votesNeeded(4, { percent: -10, minVotes: NaN }), 1);
});

test('only votes of people in the channel count', () => {
  const people = new Set([10, 11, 12]);
  // 99 left the channel (or was never in it): its vote has lapsed
  assert.deepEqual(tallyVotes(people, new Set([10, 99]), DEFAULT), { votes: 1, needed: 2, passed: false });
  assert.deepEqual(tallyVotes(people, new Set([10, 11]), DEFAULT), { votes: 2, needed: 2, passed: true });
});

test('somebody leaving can complete the quorum', () => {
  const votes = new Set([10, 11]);
  assert.equal(tallyVotes(new Set([10, 11, 12, 13]), votes, DEFAULT).passed, false); // 2 of 4, needs 3
  assert.equal(tallyVotes(new Set([10, 11, 12]), votes, DEFAULT).passed, true); // 2 of 3, needs 2
});

test('alone = own vote is enough with the default rule', () => {
  assert.equal(tallyVotes(new Set([10]), new Set([10]), DEFAULT).passed, true);
  assert.equal(tallyVotes(new Set([10]), new Set(), DEFAULT).passed, false);
});
