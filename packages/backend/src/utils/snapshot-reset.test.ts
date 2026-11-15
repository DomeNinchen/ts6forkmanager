// resetItems against a stand-in TeamSpeak. Fixture a: server group 9 "Fixture Moderators" (talk power 42,
// ignore antiflood skip), channel group 9 (join power 7), channel 4 "Fixture Other".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot } from './ts-snapshot.js';
import { resetItems } from './snapshot-reset.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'snapshots');
const snap = readSnapshot(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')));

class FakeTs {
  calls: Array<[string, Record<string, any>]> = [];
  fail: string | null = null;
  async execute(_sid: number, command: string, p: Record<string, any> = {}) {
    this.calls.push([command, p]);
    if (command === 'servergrouplist') return [{ sgid: '9', name: 'Moderators renamed' }];
    if (command === 'channelgrouplist') return [{ cgid: '9', name: 'Fixture Channel Mods' }];
    if (command === 'channellist') return [{ cid: '4', channel_name: 'Other renamed' }];
    if (p.permsid === this.fail) throw Object.assign(new Error('insufficient client permissions'), { code: 2568 });
    return [];
  }
}
const sum = (outs: any[]) => outs.map((o) => `${o.kind}:${o.id}:${o.item}:${o.key}:${o.status}${o.reason ? `:${o.reason}` : ''}`);

describe('resetItems', () => {
  it('preview lists what each item is set to and sends nothing but the lists', async () => {
    const ts = new FakeTs();
    const outs = await resetItems(ts, 1, snap, [{ kind: 'serverGroup', id: 9, fields: ['name'], perms: ['i_client_talk_power', 'i_icon_id'] }], { dryRun: true });
    assert.deepEqual(sum(outs), ['serverGroup:9:field:name:ready', 'serverGroup:9:perm:i_client_talk_power:ready', 'serverGroup:9:perm:i_icon_id:ready']);
    assert.equal(outs[0].to, 'Fixture Moderators');
    assert.equal(outs[0].name, 'Moderators renamed');
    assert.deepEqual(outs[1].to, { value: 42, negated: false, skip: false });
    assert.equal(outs[2].to, null, 'not in the snapshot -> removed');
    assert.deepEqual(ts.calls.map((c) => c[0]), ['servergrouplist']);
  });

  it('sets a server group name and permissions back, removes one the snapshot did not have', async () => {
    const ts = new FakeTs();
    const outs = await resetItems(ts, 1, snap, [{ kind: 'serverGroup', id: 9, fields: ['name'], perms: ['b_client_ignore_antiflood', 'i_icon_id'] }], {});
    assert.ok(outs.every((o) => o.status === 'ok'));
    assert.deepEqual(ts.calls.slice(1), [
      ['servergrouprename', { sgid: 9, name: 'Fixture Moderators' }],
      ['servergroupaddperm', { sgid: 9, permsid: 'b_client_ignore_antiflood', permvalue: 1, permnegated: 0, permskip: 1 }],
      ['servergroupdelperm', { sgid: 9, permsid: 'i_icon_id' }],
    ]);
  });

  it('channel groups and channels: value only; channel fields through channeledit', async () => {
    const ts = new FakeTs();
    await resetItems(ts, 1, snap, [{ kind: 'channelGroup', id: 9, perms: ['i_channel_needed_join_power'] }, { kind: 'channel', id: 4, fields: ['channel_name', 'channel_topic'] }], {});
    assert.deepEqual(ts.calls.filter((c) => !c[0].endsWith('list')), [
      ['channelgroupaddperm', { cgid: 9, permsid: 'i_channel_needed_join_power', permvalue: 7 }],
      ['channeledit', { cid: 4, channel_name: 'Fixture Other' }],
      ['channeledit', { cid: 4, channel_topic: snap.channels.get(4)!.fields.channel_topic }],
    ]);
  });

  it('refuses what cannot be set back, objects gone or not in the snapshot; a failure is reported per item', async () => {
    const ts = new FakeTs();
    ts.fail = 'i_client_talk_power';
    const outs = await resetItems(ts, 1, snap, [
      { kind: 'channel', id: 4, fields: ['parent', 'below', 'channel_flag_password', 'channel_flag_default', 'channel_password', 'unknown_field'] },
      { kind: 'serverGroup', id: 77, perms: ['i_icon_id'] },
      { kind: 'serverGroup', id: 9, perms: ['i_client_talk_power'] },
    ], {});
    assert.deepEqual(sum(outs).slice(0, 6), Array(6).fill(0).map((_, i) => `channel:4:field:${['parent', 'below', 'channel_flag_password', 'channel_flag_default', 'channel_password', 'unknown_field'][i]}:skipped:not-resettable`));
    assert.equal(sum(outs)[6], 'serverGroup:77:perm:i_icon_id:skipped:object-gone');
    assert.equal(outs[7].status, 'failed');
    assert.match(outs[7].message!, /2568/);
    assert.ok(!ts.calls.some((c) => c[0] === 'channeledit'));
  });
});
