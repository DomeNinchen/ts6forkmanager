// Fixtures: real TS6 6.0.0-beta13.1 snapshots of a throwaway server, every key, hash and identity
// replaced with "invented-…". a = baseline; b = after: server group "Fixture New" (11) added,
// "Fixture Gone" (10) deleted, Moderators (9) talk power 42 -> 43 negated and ignore_antiflood
// removed, channel group 9 join power 7 -> 8, channel 3 renamed, moved from parent 2 to the top
// level below channel 4 and its needed talk power 55 -> 56; c = b taken again without a change.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { compareSnapshots, decodeSnapshot, parseSnapshotText, readSnapshot } from './ts-snapshot.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'snapshots');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as { version: string; data: string };
const textOf = (name: string) => decodeSnapshot(load(name)).text;
const pack = (text: string) => ({ version: '3', data: zlib.zstdCompressSync(Buffer.from(text)).toString('base64') });

describe('readSnapshot', () => {
  it('reads groups, channels and their permissions', () => {
    const s = readSnapshot(load('a.json'));
    assert.deepEqual([...s.serverGroups.values()].map((g) => g.name), ['Server Admin', 'Normal', 'Guest', 'Fixture Moderators', 'Fixture Gone']);
    assert.deepEqual(s.serverGroups.get(9)!.perms.get('i_client_talk_power'), { value: 42, negated: false, skip: false });
    assert.deepEqual(s.serverGroups.get(9)!.perms.get('b_client_ignore_antiflood'), { value: 1, negated: false, skip: true });
    assert.equal(s.channelGroups.get(9)!.name, 'Fixture Channel Mods');
    const parent = s.channels.get(2)!;
    assert.equal(parent.fields.channel_name, 'Fixture Parent');
    assert.equal(parent.fields.channel_description, 'line one\nline | two');
    assert.equal(parent.fields.channel_flag_password, '1');
    assert.equal(s.channels.get(3)!.pid, 2);
    assert.deepEqual(s.channels.get(3)!.perms.get('i_client_needed_talk_power'), { value: 55, negated: false, skip: false });
  });

  it('never picks up secret fields', () => {
    const s = readSnapshot(load('a.json'));
    for (const c of s.channels.values()) {
      for (const k of Object.keys(c.fields)) assert.ok(!/^channel_password$|salt|unique_identifier|filepath/.test(k), k);
    }
  });

  it('refuses what it cannot read', () => {
    assert.throws(() => readSnapshot({ version: '3' }), /version and data are missing/);
    assert.throws(() => readSnapshot({ version: '4', data: load('a.json').data }), /version 4 is not supported/);
    assert.throws(() => readSnapshot({ ...load('a.json'), salt: 'x' }), /password/);
    const a = load('a.json');
    assert.throws(() => readSnapshot({ version: '3', data: a.data.slice(0, a.data.length / 2) }), /cannot be unpacked/);
    assert.throws(() => readSnapshot({ version: '3', data: 'bm90IHpzdGQ=' }), /cannot be unpacked/);
    // unpacks, but the sections are not there
    assert.throws(() => readSnapshot(pack('virtualserver_name=x')), /unknown layout/);
    const cut = textOf('a.json');
    assert.throws(() => readSnapshot(pack(cut.slice(0, cut.indexOf('channel_groups')))), /unknown layout.*channel_groups/);
  });

  it('ignores unknown fields and permissions of channels that are gone', () => {
    const text = textOf('a.json')
      .replace('channel_name=Fixture\\sOther', 'channel_name=Fixture\\sOther channel_future_field=1')
      .replace('channel_flat ', 'channel_flat id1=999 id2=0 permid=i_icon_id permvalue=1 permskip=0 permnegated=0|');
    const s = parseSnapshotText(text);
    assert.equal(s.channels.get(4)!.fields.channel_future_field, undefined);
    assert.equal(s.channels.has(999), false);
    assert.equal(compareSnapshots(readSnapshot(load('a.json')), s).objects.length, 0);
  });
});

describe('compareSnapshots', () => {
  it('shows exactly the known changes (positive control)', () => {
    const r = compareSnapshots(readSnapshot(load('a.json')), readSnapshot(load('b.json')));
    const summary = r.objects.map((o) => `${o.kind}:${o.id}:${o.status}`);
    // Nothing else: channel 4, now with channel 3 sorted below it, did not change itself.
    assert.deepEqual(summary, ['serverGroup:9:changed', 'serverGroup:10:removed', 'serverGroup:11:added', 'channelGroup:9:changed', 'channel:3:changed']);

    const mods = r.objects.find((o) => o.kind === 'serverGroup' && o.id === 9)!;
    assert.deepEqual(mods.fields, []);
    assert.deepEqual(mods.perms, [
      { perm: 'b_client_ignore_antiflood', before: { value: 1, negated: false, skip: true }, after: null },
      { perm: 'i_client_talk_power', before: { value: 42, negated: false, skip: false }, after: { value: 43, negated: true, skip: false } },
    ]);
    const gone = r.objects.find((o) => o.id === 10 && o.kind === 'serverGroup')!;
    assert.equal(gone.name, 'Fixture Gone');
    assert.deepEqual(gone.fields, [{ field: 'name', before: 'Fixture Gone', after: null }]);
    assert.ok(gone.perms.every((p) => p.after === null) && gone.perms.some((p) => p.perm === 'i_icon_id'));
    assert.ok(r.objects.find((o) => o.id === 11 && o.kind === 'serverGroup')!.perms.every((p) => p.before === null));

    const cg = r.objects.find((o) => o.kind === 'channelGroup')!;
    assert.deepEqual(cg.perms, [{ perm: 'i_channel_needed_join_power', before: { value: 7, negated: false, skip: false }, after: { value: 8, negated: false, skip: false } }]);

    const moved = r.objects.find((o) => o.kind === 'channel' && o.id === 3)!;
    assert.equal(moved.name, 'Fixture Child Renamed');
    assert.deepEqual(moved.fields, [
      { field: 'parent', before: 'Fixture Parent (#2)', after: '' },
      { field: 'below', before: '', after: 'Fixture Other (#4)' },
      { field: 'channel_name', before: 'Fixture Child', after: 'Fixture Child Renamed' },
    ]);
    assert.deepEqual(moved.perms.map((p) => [p.perm, p.before?.value, p.after?.value]), [['i_client_needed_talk_power', 55, 56]]);
    assert.deepEqual(r.counts.serverGroup, { added: 1, removed: 1, changed: 1, unchanged: 3 });
  });

  it('is empty for two snapshots without a change, both ways round (negative control)', () => {
    const b = readSnapshot(load('b.json'));
    const c = readSnapshot(load('c.json'));
    assert.deepEqual(compareSnapshots(b, c).objects, []);
    assert.deepEqual(compareSnapshots(c, b).objects, []);
    assert.deepEqual(compareSnapshots(b, b).counts.channel, { added: 0, removed: 0, changed: 0, unchanged: b.channels.size });
  });

  it('swapping the sides swaps added and removed', () => {
    const r = compareSnapshots(readSnapshot(load('b.json')), readSnapshot(load('a.json')));
    assert.equal(r.objects.find((o) => o.kind === 'serverGroup' && o.id === 10)!.status, 'added');
    assert.equal(r.objects.find((o) => o.kind === 'serverGroup' && o.id === 11)!.status, 'removed');
  });

  it('does not depend on the order of records', () => {
    const text = textOf('a.json');
    // Swap two channel rows: same channels, different order in the file.
    const rows = text.split('|');
    const i = rows.findIndex((r) => r.startsWith('channel_id=2 '));
    const j = rows.findIndex((r) => r.startsWith('channel_id=4 '));
    [rows[i], rows[j]] = [rows[j], rows[i]];
    assert.deepEqual(compareSnapshots(readSnapshot(load('a.json')), parseSnapshotText(rows.join('|'))).objects, []);
  });

  it('renaming a channel does not report the channel sorted below it', () => {
    const a = readSnapshot(load('a.json'));
    const renamed = parseSnapshotText(textOf('a.json').replace('channel_name=Fixture\\sParent', 'channel_name=Fixture\\sParent\\s2'));
    const r = compareSnapshots(a, renamed);
    assert.deepEqual(r.objects.map((o) => o.id), [2]);
  });
});
