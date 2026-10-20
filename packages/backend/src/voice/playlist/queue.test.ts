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

test('next() drops the finished track from the queue', () => {
  const q = queueOf('a', 'b', 'c');
  assert.equal(q.next()?.id, 'a');
  assert.deepEqual(order(q), ['a', 'b', 'c']);
  assert.equal(q.index, 0);
  assert.equal(q.next()?.id, 'b');
  assert.deepEqual(order(q), ['b', 'c']);
  q.next();
  assert.equal(q.next(), null); // c finished, nothing left
  assert.deepEqual(order(q), []);
  assert.equal(q.index, -1);
});

test('a song added after the queue ran out plays alone, not after old tracks', () => {
  const q = queueOf('a', 'b');
  q.next(); q.next(); q.next();
  q.insertNext(track('new'));
  assert.deepEqual(order(q), ['new']);
  assert.equal(q.next(), null);
});

test('previous() brings finished tracks back from the hidden history', () => {
  const q = queueOf('a', 'b', 'c');
  q.next(); q.next(); // playing b, a is history
  assert.equal(q.previous()?.id, 'a');
  assert.deepEqual(order(q), ['a', 'b', 'c']);
  assert.equal(q.previous()?.id, 'a'); // no more history: restart current
  assert.deepEqual(order(q), ['a', 'b', 'c']);
});

test('previous() after the queue ran out replays the last track', () => {
  const q = queueOf('a');
  q.next(); q.next();
  assert.equal(q.previous()?.id, 'a');
  assert.equal(q.index, 0);
});

test('playNow pulls a later track to the front, the skipped-over ones stay queued', () => {
  const q = queueOf('a', 'b', 'c', 'd');
  q.next(); // playing a
  assert.equal(q.playNow(3)?.id, 'd');
  assert.deepEqual(order(q), ['d', 'b', 'c']); // a counts as played
  assert.equal(q.next()?.id, 'b');
  assert.equal(q.previous()?.id, 'd');
  assert.equal(q.previous()?.id, 'a');
});

test('playNow with nothing current starts that track', () => {
  const q = queueOf('a', 'b', 'c');
  assert.equal(q.playNow(2)?.id, 'c');
  assert.deepEqual(order(q), ['c', 'a', 'b']);
  assert.equal(q.index, 0);
});

test('playNow on the current track just replays it', () => {
  const q = queueOf('a', 'b');
  q.next();
  assert.equal(q.playNow(0)?.id, 'a');
  assert.deepEqual(order(q), ['a', 'b']);
});

test('playNow and removeAt reject an out-of-range index', () => {
  assert.equal(queueOf('a').playNow(1), null);
  assert.equal(queueOf('a').playNow(-1), null);
  assert.equal(queueOf('a').removeAt(1), null);
});

test('insertNext retires the current track and keeps the rest queued', () => {
  const q = queueOf('a', 'b');
  q.next();
  q.insertNext(track('x'));
  assert.deepEqual(order(q), ['x', 'b']);
  assert.equal(q.previous()?.id, 'a');
});

test('removing the current track does not count the next one as played', () => {
  const q = queueOf('a', 'b', 'c');
  q.next();
  assert.equal(q.removeAt(0)?.id, 'a');
  assert.equal(q.index, -1);
  assert.equal(q.next()?.id, 'b');
});

test('move only reorders upcoming tracks, never past the current one', () => {
  const q = queueOf('a', 'b', 'c');
  q.next();
  assert.equal(q.move(1, 0), false);
  assert.equal(q.move(0, 2), false);
  assert.equal(q.move(2, 1), true);
  assert.deepEqual(order(q), ['a', 'c', 'b']);
});

test('shuffle keeps the current track first, turning it off restores the added order', () => {
  const q = queueOf('a', 'b', 'c', 'd', 'e', 'f');
  q.next();
  q.setShuffle(true);
  assert.equal(order(q)[0], 'a');
  q.add(track('g'));
  assert.equal(order(q)[0], 'a');
  q.setShuffle(false);
  assert.deepEqual(order(q), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('history is capped', () => {
  const q = queueOf(...Array.from({ length: 60 }, (_, i) => `t${i}`));
  for (let i = 0; i < 60; i++) q.next(); // t59 current, t0..t58 played
  for (let i = 0; i < 60; i++) q.previous();
  assert.equal(order(q).length, 51); // current + the 50 kept in history
  assert.equal(order(q)[0], 't9');
});

test('clear empties queue and history', () => {
  const q = queueOf('a', 'b');
  q.next(); q.next();
  q.clear();
  assert.deepEqual(order(q), []);
  assert.equal(q.previous(), null);
});

test('lengthChange fires when a finished track leaves the queue', () => {
  const q = queueOf('a', 'b');
  const seen: number[] = [];
  q.on('lengthChange', (n) => seen.push(n));
  q.next(); // a becomes current, no length change
  q.next(); // a leaves
  assert.deepEqual(seen, [1]);
});
