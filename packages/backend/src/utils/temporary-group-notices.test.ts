import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMP_GROUP_EXPIRED_NOTICE_WAIT_MS,
  TEMP_GROUP_NOTICE_DEFAULTS,
  clipNotice,
  dueWarning,
  formatNoticeDate,
  noticeSettingsProblem,
  renderNoticeText,
} from '@ts6/common';
import { noticeToSend, noticeWanted } from './temporary-group-notices.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WARN = [7 * DAY, DAY];

test('a warning is due once its time has come, the closest one when several are', () => {
  const set = 0;
  const expires = 30 * DAY;
  assert.equal(dueWarning(WARN, expires, set, null, 22 * DAY), null);
  assert.equal(dueWarning(WARN, expires, set, null, 23 * DAY), 7 * DAY);
  // 7 days handled: nothing new until the 1-day mark
  assert.equal(dueWarning(WARN, expires, set, 7 * DAY, 25 * DAY), null);
  assert.equal(dueWarning(WARN, expires, set, 7 * DAY, 29 * DAY), DAY);
  // both passed unnoticed (backend off): only the closest one is sent
  assert.equal(dueWarning(WARN, expires, set, null, 29.5 * DAY), DAY);
  // after the expiry no warning at all
  assert.equal(dueWarning(WARN, expires, set, null, expires), null);
});

test('warnings that had already passed when the deadline was set are skipped', () => {
  // a 3-day deadline gets the 1-day warning, never the 7-day one
  const set = 100 * DAY;
  const expires = set + 3 * DAY;
  assert.equal(dueWarning(WARN, expires, set, null, set + HOUR), null);
  assert.equal(dueWarning(WARN, expires, set, null, set + 2 * DAY), DAY);
  // a deadline shorter than every warning gets none
  assert.equal(dueWarning(WARN, set + 12 * HOUR, set, null, set + 11 * HOUR), null);
});

test('placeholders are filled, {expires} in the chosen zone, across daylight saving', () => {
  const expires = Date.parse('2026-11-07T09:00:00Z');
  const text = renderNoticeText('{client}/{group}/{expires}/{days}/{hours}/{unknown}', {
    client: 'Anna', group: 'VIP', expiresAt: expires, now: expires - (2 * DAY + 5 * HOUR + 1), timeZone: 'Europe/Berlin',
  });
  assert.equal(text, 'Anna/VIP/2026-11-07 10:00 Europe/Berlin/2/53/{unknown}');
  assert.equal(formatNoticeDate(Date.parse('2026-07-07T09:00:00Z'), 'Europe/Berlin'), '2026-07-07 11:00 Europe/Berlin');
  assert.equal(formatNoticeDate(expires, 'UTC'), '2026-11-07 09:00 UTC');
  // a zone that does not exist (half typed in the form) does not throw
  assert.equal(formatNoticeDate(expires, 'Mars/Base'), '2026-11-07 09:00 UTC');
  assert.equal(formatNoticeDate(expires, ''), '2026-11-07 09:00 UTC');
  // nothing left: zero, never negative
  assert.match(renderNoticeText('{days} {hours}', { client: '', group: '', expiresAt: 0, now: DAY, timeZone: 'UTC' }), /^0 0$/);
});

test('texts are cut to the measured limits by characters, not bytes', () => {
  assert.equal(clipNotice('ä'.repeat(100), 100), 'ä'.repeat(100));
  const cut = clipNotice('ä'.repeat(101), 100);
  assert.equal([...cut].length, 100);
  assert.ok(cut.endsWith('…'));
});

test('settings are checked like the backend stores them', () => {
  const ok = { ...TEMP_GROUP_NOTICE_DEFAULTS };
  assert.equal(noticeSettingsProblem(ok), null);
  assert.ok(noticeSettingsProblem({ ...ok, warnBeforeMs: [30_000] }));
  assert.ok(noticeSettingsProblem({ ...ok, warnBeforeMs: [90_500] }), 'whole minutes only');
  assert.ok(noticeSettingsProblem({ ...ok, warnBeforeMs: [DAY, DAY] }));
  assert.ok(noticeSettingsProblem({ ...ok, warnBeforeMs: [1, 2, 3, 4, 5, 6].map((d) => d * DAY) }));
  assert.ok(noticeSettingsProblem({ ...ok, warnBeforeMs: [366 * DAY] }));
  assert.equal(noticeSettingsProblem({ ...ok, warnBeforeMs: [365 * DAY] }), null);
  assert.ok(noticeSettingsProblem({ ...ok, timeZone: 'Mars/Olympus' }));
  assert.ok(noticeSettingsProblem({ ...ok, warningText: '   ' }));
  assert.ok(noticeSettingsProblem({ ...ok, expiredText: 'x'.repeat(1001) }));
  assert.ok(noticeSettingsProblem({ ...ok, poke: 'yes' as unknown as boolean }));
});

test('nothing is wanted when everything is off', () => {
  assert.equal(noticeWanted(TEMP_GROUP_NOTICE_DEFAULTS, 'warning'), true);
  assert.equal(noticeWanted({ ...TEMP_GROUP_NOTICE_DEFAULTS, enabled: false }, 'warning'), false);
  assert.equal(noticeWanted({ ...TEMP_GROUP_NOTICE_DEFAULTS, privateMessage: false, offlineMessage: false, poke: false }, 'expired'), false);
  assert.equal(noticeWanted({ ...TEMP_GROUP_NOTICE_DEFAULTS, notifyExpired: false }, 'expired'), false);
  assert.equal(noticeWanted({ ...TEMP_GROUP_NOTICE_DEFAULTS, warnBeforeMs: [] }, 'warning'), false);
});

test('what an entry should hear now', () => {
  const now = 1000 * DAY;
  const base = {
    state: 'active', expiresAt: new Date(now + 5 * HOUR), deadlineSetAt: new Date(now - 10 * DAY),
    warnedBeforeMin: null as number | null, pendingNotice: null as string | null, endedAt: null as Date | null, lastNotice: null as string | null,
  };
  const s = TEMP_GROUP_NOTICE_DEFAULTS;
  assert.deepEqual(noticeToSend(base, s, now), { kind: 'warning', beforeMs: DAY, onlyOnlineWays: false });
  assert.equal(noticeToSend({ ...base, warnedBeforeMin: DAY / 60_000 }, s, now), null);
  // waiting for the client: only the online ways are left
  const waiting = JSON.stringify({ kind: 'warning', beforeMs: DAY, at: '', sent: ['offline'], waitingForOnline: true });
  assert.deepEqual(noticeToSend({ ...base, pendingNotice: 'warning', warnedBeforeMin: 1440, lastNotice: waiting }, s, now), { kind: 'warning', beforeMs: DAY, onlyOnlineWays: true });
  // a waiting warning is dropped once the deadline has passed
  assert.deepEqual(noticeToSend({ ...base, pendingNotice: 'warning', expiresAt: new Date(now - 1) }, s, now), { drop: true });
  // the expiry notice: right away, then waiting, dropped after 30 days
  const ended = { ...base, state: 'revoked', pendingNotice: 'expired', endedAt: new Date(now - HOUR) };
  assert.deepEqual(noticeToSend(ended, s, now), { kind: 'expired', onlyOnlineWays: false });
  assert.deepEqual(noticeToSend({ ...ended, lastNotice: JSON.stringify({ kind: 'expired', at: '', sent: ['offline'], waitingForOnline: true }) }, s, now), { kind: 'expired', onlyOnlineWays: true });
  assert.deepEqual(noticeToSend({ ...ended, endedAt: new Date(now - TEMP_GROUP_EXPIRED_NOTICE_WAIT_MS - 1) }, s, now), { drop: true });
  // switched off: no new warnings
  assert.equal(noticeToSend(base, { ...s, enabled: false }, now), null);
});
