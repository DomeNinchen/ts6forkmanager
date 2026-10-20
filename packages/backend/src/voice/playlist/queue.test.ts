import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayQueue } from './queue.js';

const track = (id: string) => ({ id, title: id, filePath: `${id}.mp3`, source: 'local' as const });

function queueOf(...ids: string[]): PlayQueue {
  const q = new PlayQueue();
  q.addMany(ids.map(track));
  return q;
}
const order = (q: PlayQueue) => q.getAll().map((i) => i.id);

test('playNow pulls a later track to right after the current one', () => {
  const q = queueOf('a', 'b', 'c', 'd');
  q.playAt(0);
  assert.equal(q.playNow(3)?.id, 'd');
  assert.deepEqual(order(q), ['a', 'd', 'b', 'c']);
  assert.equal(q.index, 1);
  assert.equal(q.next()?.id, 'b'); // b and c were not skipped
});

test('playNow moves an already played track forward again', () => {
  const q = queueOf('a', 'b', 'c', 'd');
  q.playAt(2);
  assert.equal(q.playNow(0)?.id, 'a');
  assert.deepEqual(order(q), ['b', 'c', 'a', 'd']);
  assert.equal(q.next()?.id, 'd');
});

test('playNow with nothing current puts the track at the front', () => {
  const q = queueOf('a', 'b', 'c');
  assert.equal(q.playNow(2)?.id, 'c');
  assert.deepEqual(order(q), ['c', 'a', 'b']);
  assert.equal(q.index, 0);
});

test('playNow on the current track just replays it', () => {
  const q = queueOf('a', 'b');
  q.playAt(1);
  assert.equal(q.playNow(1)?.id, 'b');
  assert.deepEqual(order(q), ['a', 'b']);
});

test('playNow follows the shuffled playback order', () => {
  const q = queueOf('a', 'b', 'c', 'd', 'e');
  q.setShuffle(true);
  q.playAt(0);
  const before = order(q);
  assert.equal(q.playNow(4)?.id, before[4]);
  assert.deepEqual(order(q), [before[0], before[4], before[1], before[2], before[3]]);
  assert.equal(q.next()?.id, before[1]);
});

test('playNow rejects an out-of-range index', () => {
  assert.equal(queueOf('a').playNow(1), null);
  assert.equal(queueOf('a').playNow(-1), null);
});
