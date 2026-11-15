import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelOccupancy } from './channel-occupancy.js';
import type { ParsedCommand } from './tslib/index.js';

const cmd = (name: string, groups: Record<string, string>[]) => ({ name, params: groups[0], groups }) as unknown as ParsedCommand;

test('peopleIds: own channel only, without the bot, other bots and query clients', () => {
  const occ = new ChannelOccupancy();
  const own = 1;
  occ.handle(cmd('notifycliententerview', [
    { clid: '1', ctid: '5', client_type: '0' }, // the bot itself
    { clid: '2' }, // person, keys omitted = same as the first entry
    { clid: '3', client_type: '1' }, // query client
    { clid: '4' }, // another bot of the app
    { clid: '6', ctid: '7' }, // person in another channel
  ]), own);
  assert.deepEqual([...occ.peopleIds(own, new Set([4]))!], [2]);

  occ.handle(cmd('notifyclientmoved', [{ clid: '6', ctid: '5' }]), own);
  assert.deepEqual([...occ.peopleIds(own, new Set([4]))!].sort(), [2, 6]);
  occ.handle(cmd('notifyclientleftview', [{ clid: '2' }]), own);
  assert.deepEqual([...occ.peopleIds(own, new Set([4]))!], [6]);
  assert.equal(occ.countPeople(own, new Set([4])), 1);
});

test('peopleIds is null while the own channel is unknown', () => {
  assert.equal(new ChannelOccupancy().peopleIds(1), null);
});
