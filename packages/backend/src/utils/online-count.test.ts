import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOnline, parseOnlineCountFilter } from './online-count.js';

const clients = [
  { client_type: '0', client_servergroups: '7', client_unique_identifier: 'alice=' },
  { client_type: '0', client_servergroups: '7,10', client_unique_identifier: 'afk=' },
  { client_type: '0', client_servergroups: '1', client_unique_identifier: 'bot=' },
  { client_type: '1', client_servergroups: '2', client_unique_identifier: 'serveradmin' }, // query login
];
const none = { excludedGroups: [], excludeMusicBots: false };

test('counts voice clients only when nothing is excluded', () => {
  assert.equal(countOnline(clients, none, new Set()), 3);
});

test('a client in any excluded group is left out, by exact group id', () => {
  assert.equal(countOnline(clients, { excludedGroups: [10], excludeMusicBots: false }, new Set()), 2);
  // group 1 must not match the client in "10" or "7,10"
  assert.equal(countOnline(clients, { excludedGroups: [1], excludeMusicBots: false }, new Set()), 2);
});

test("the app's own music bots are left out by unique id, only when switched on", () => {
  assert.equal(countOnline(clients, { excludedGroups: [], excludeMusicBots: true }, new Set(['bot='])), 2);
  assert.equal(countOnline(clients, none, new Set(['bot='])), 3);
});

test('both rules together', () => {
  assert.equal(countOnline(clients, { excludedGroups: [10], excludeMusicBots: true }, new Set(['bot='])), 1);
});

test('parse accepts only the expected shape', () => {
  assert.deepEqual(parseOnlineCountFilter({ excludedGroups: [3, 3, 5], excludeMusicBots: true }), { excludedGroups: [3, 5], excludeMusicBots: true });
  assert.equal(parseOnlineCountFilter({ excludedGroups: ['3'], excludeMusicBots: false }), null);
  assert.equal(parseOnlineCountFilter({ excludedGroups: [0], excludeMusicBots: false }), null);
  assert.equal(parseOnlineCountFilter({ excludedGroups: [], excludeMusicBots: 'yes' }), null);
  assert.equal(parseOnlineCountFilter(null), null);
});
