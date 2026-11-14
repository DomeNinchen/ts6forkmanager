import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldText, searchEntries, pushRecent, channelParents } from '../src/lib/search.ts';

const e = (...terms: string[]) => ({ terms });
const names = (list: { terms: string[] }[]) => list.map((x) => x.terms[0]);

test('foldText: case, accents, ß and spelled-out umlauts', () => {
  assert.equal(foldText('Über'), 'uber');
  assert.equal(foldText('ueber'), 'uber');
  assert.equal(foldText('Paramètres'), 'parametres');
  assert.equal(foldText('Straße'), 'strasse');
});

test('matches part of a word, ignoring case and umlauts', () => {
  const entries = [e('Server-Gruppen'), e('Bans'), e('Änderungsprotokoll'), e('Kanäle')];
  assert.deepEqual(names(searchEntries(entries, 'grup')), ['Server-Gruppen']);
  assert.deepEqual(names(searchEntries(entries, 'GRUPPEN')), ['Server-Gruppen']);
  assert.deepEqual(names(searchEntries(entries, 'anderung')), ['Änderungsprotokoll']);
  assert.deepEqual(names(searchEntries(entries, 'aenderung')), ['Änderungsprotokoll']);
  assert.deepEqual(names(searchEntries(entries, 'kanale')), ['Kanäle']);
  assert.deepEqual(searchEntries(entries, 'xyz'), []);
});

test('every word must match, in any term', () => {
  const entries = [e('Konto', 'Account', 'Einstellungen'), e('Benutzer', 'Users', 'Einstellungen')];
  assert.deepEqual(names(searchEntries(entries, 'einst kont')), ['Konto']);
  assert.deepEqual(names(searchEntries(entries, 'users')), ['Benutzer']);
  assert.deepEqual(names(searchEntries(entries, 'einst nothing')), []);
});

test('ranking: exact > prefix > word start > anywhere; visible name before other terms', () => {
  const entries = [e('Channel Groups'), e('Banned channels'), e('Channels'), e('Bans', 'Channel'), e('Xchannel')];
  assert.deepEqual(names(searchEntries(entries, 'channel')), ['Channel Groups', 'Channels', 'Banned channels', 'Bans', 'Xchannel']);
  assert.deepEqual(names(searchEntries(entries, 'channels')), ['Channels', 'Banned channels']);
});

test('empty query keeps order; limit caps the result', () => {
  const entries = [e('a1'), e('a2'), e('a3')];
  assert.deepEqual(names(searchEntries(entries, '  ')), ['a1', 'a2', 'a3']);
  assert.deepEqual(names(searchEntries(entries, 'a', 2)), ['a1', 'a2']);
});

test('channelParents: whole chain, top level, unknown id, loop in broken data', () => {
  // WebQuery sends ids as strings.
  const channels = [
    { cid: '1', pid: '0' }, { cid: '2', pid: '1' }, { cid: '3', pid: '2' }, { cid: '4', pid: '0' },
    { cid: '7', pid: '8' }, { cid: '8', pid: '7' },
  ];
  assert.deepEqual([...channelParents(channels, 3)!], [2, 1]);
  assert.deepEqual([...channelParents(channels, 4)!], []);
  assert.equal(channelParents(channels, 99), null);
  assert.deepEqual([...channelParents(channels, 7)!].sort(), [7, 8]);
});

test('pushRecent: front, no duplicates, capped', () => {
  assert.deepEqual(pushRecent(['b', 'a'], 'a'), ['a', 'b']);
  assert.deepEqual(pushRecent(['1', '2', '3', '4', '5'], '6'), ['6', '1', '2', '3', '4']);
});
