import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMP_GROUP_MAX_DURATION_MS,
  TEMP_GROUP_MIN_DURATION_MS,
  TEMP_GROUP_NOTES,
  parseTempGroupNote,
  tempGroupDurationProblem,
  tempGroupExpiry,
  tempGroupExtendedExpiry,
  tempGroupRetryDelayMs,
} from '@ts6/common';
import { classifyRevokeError, isTempGroupDue, rowAfterAttempt } from './temporary-groups.js';
import { ConnectionUnavailableError, TSApiError } from '../middleware/error-handler.js';

const DAY = 24 * 60 * 60 * 1000;

test('30 days are 30 x 24 hours, also across the change to daylight saving time', () => {
  // 2026-03-29 is the switch to summer time in Europe/Berlin: the wall clock skips an hour.
  const start = Date.parse('2026-03-20T12:00:00Z');
  const end = tempGroupExpiry(start, 30 * DAY);
  assert.equal(end - start, 30 * DAY);
  assert.equal(new Date(end).toISOString(), '2026-04-19T12:00:00.000Z');
  // In Berlin the wall clock shows 14:00 at the end after 13:00 at the start - the duration, not the wall clock, is what counts.
  assert.equal(new Date(end).toLocaleString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }), '14:00');
  assert.equal(new Date(start).toLocaleString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }), '13:00');
});

test('extending counts from the current expiry while it lies ahead, from now once it has passed', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  assert.equal(tempGroupExtendedExpiry(now + 5 * DAY, now, 7 * DAY), now + 12 * DAY);
  assert.equal(tempGroupExtendedExpiry(now - 2 * DAY, now, 7 * DAY), now + 7 * DAY);
  assert.equal(tempGroupExtendedExpiry(now, now, DAY), now + DAY);
});

test('a deadline is one minute to five years away', () => {
  assert.equal(tempGroupDurationProblem(TEMP_GROUP_MIN_DURATION_MS), null);
  assert.equal(tempGroupDurationProblem(TEMP_GROUP_MAX_DURATION_MS), null);
  assert.ok(tempGroupDurationProblem(TEMP_GROUP_MIN_DURATION_MS - 1));
  assert.ok(tempGroupDurationProblem(TEMP_GROUP_MAX_DURATION_MS + 1));
  assert.ok(tempGroupDurationProblem('30d'));
  assert.ok(tempGroupDurationProblem(Number.NaN));
  assert.ok(tempGroupDurationProblem(-DAY));
});

test('due = open and its next attempt has come (injected clock)', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const before = new Date(now.getTime() - 1);
  const after = new Date(now.getTime() + 1);
  assert.equal(isTempGroupDue({ state: 'active', nextAttemptAt: before }, now), true);
  assert.equal(isTempGroupDue({ state: 'active', nextAttemptAt: now }, now), true);
  assert.equal(isTempGroupDue({ state: 'active', nextAttemptAt: after }, now), false);
  assert.equal(isTempGroupDue({ state: 'waiting', nextAttemptAt: before }, now), true);
  assert.equal(isTempGroupDue({ state: 'error', nextAttemptAt: before }, now), true);
  // Long overdue (the backend was off) is still due - unlike a flow Delay, it is never dropped.
  assert.equal(isTempGroupDue({ state: 'active', nextAttemptAt: new Date(now.getTime() - 365 * DAY) }, now), true);
  for (const state of ['revoked', 'already-removed', 'permanent']) {
    assert.equal(isTempGroupDue({ state, nextAttemptAt: before }, now), false, state);
  }
});

test('the pause between tries starts at 30 s, doubles and stops at 30 minutes', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 50].map(tempGroupRetryDelayMs), [30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000, 1_800_000]);
});

test('TeamSpeak answers map to states (codes measured on 6.0.0-beta13.1)', () => {
  assert.equal(classifyRevokeError(new ConnectionUnavailableError(1)).state, 'waiting');
  assert.equal(classifyRevokeError(new TSApiError(-1, 'connect ECONNREFUSED', undefined, 'ECONNREFUSED')).state, 'waiting');
  assert.equal(classifyRevokeError(new TSApiError(2563, 'empty result set')).state, 'already-removed');
  assert.equal(classifyRevokeError(new TSApiError(2560, 'invalid group ID')).state, 'already-removed');
  assert.equal(classifyRevokeError(new TSApiError(512, 'invalid clientID')).state, 'already-removed');
  const power = classifyRevokeError(new TSApiError(2568, 'insufficient client permissions', 'i_group_member_remove_power'));
  assert.equal(power.state, 'error');
  assert.match(power.message!, /i_group_member_remove_power/);
  assert.equal(classifyRevokeError(new TSApiError(1538, 'invalid parameter')).state, 'error');
  assert.equal(classifyRevokeError(new Error('boom')).state, 'error');
});

test('every stored reason is read back as its note, with the detail after it', () => {
  const cases: Array<[unknown, string, string]> = [
    [new ConnectionUnavailableError(1), 'connectionInactive', ''],
    [new TSApiError(-1, 'connect ECONNREFUSED'), 'unreachable', 'connect ECONNREFUSED'],
    [new TSApiError(2563, 'empty result set'), 'notMember', ''],
    [new TSApiError(2560, 'invalid group ID'), 'groupGone', ''],
    [new TSApiError(512, 'invalid clientID'), 'clientGone', ''],
    [new TSApiError(2568, 'insufficient client permissions', 'i_group_needed_member_remove_power'), 'noPower', 'i_group_needed_member_remove_power'],
    [new TSApiError(5122, 'invalid apikey'), 'teamspeakError', '5122 invalid apikey'],
  ];
  for (const [err, key, detail] of cases) {
    assert.deepEqual(parseTempGroupNote(classifyRevokeError(err).message!), { key, detail }, key);
  }
  assert.deepEqual(parseTempGroupNote(TEMP_GROUP_NOTES.otherIdentity), { key: 'otherIdentity', detail: '' });
  assert.equal(parseTempGroupNote('something else'), null);
});

test('a failed try stays open with the next pause, a final one ends the row', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const waiting = rowAfterAttempt(0, { state: 'waiting', message: 'down' }, now);
  assert.equal(waiting.state, 'waiting');
  assert.equal(waiting.attempts, 1);
  assert.equal(waiting.nextAttemptAt!.getTime(), now.getTime() + 30_000);
  assert.equal('endedAt' in waiting, false);
  const error = rowAfterAttempt(3, { state: 'error', message: 'power' }, now);
  assert.equal(error.nextAttemptAt!.getTime(), now.getTime() + 240_000);
  for (const state of ['revoked', 'already-removed'] as const) {
    const done = rowAfterAttempt(2, { state, message: null }, now);
    assert.equal(done.state, state);
    assert.equal(done.nextAttemptAt, null);
    assert.equal((done as { endedAt: Date }).endedAt, now);
  }
});
