// restoreChannels against a stand-in TeamSpeak answering like 6.0.0-beta13.1 did when measured
// (771 taken name under the same parent, 768 unknown parent, new ids, two default permissions on a new
// channel, the creating query client moved in, sometimes a bare ok without the cid).
// Fixture a: channels 1 Default, 2 "Fixture Parent" (password, description), 3 "Fixture Child" (in 2,
// needed talk power 55), 4 "Fixture Other". The live run is in the PR.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot } from './ts-snapshot.js';
import { restoreChannels } from './snapshot-restore-channels.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'snapshots');
const snap = readSnapshot(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')));

class FakeTs {
  calls: Array<[string, Record<string, any>]> = [];
  next = 50;
  bareOk = false;
  channels = new Map<number, { pid: number; name: string; params: Record<string, any>; perms: Map<string, number> }>();
  me = { clid: 7, cid: 1 };
  constructor() {
    this.channels.set(1, { pid: 0, name: 'Default Channel', params: {}, perms: new Map() });
    this.channels.set(4, { pid: 0, name: 'Fixture Other', params: {}, perms: new Map() }); // 2 and 3 were deleted
  }
  err(code: number, message: string) { return Object.assign(new Error(message), { code }); }
  async execute(_sid: number, command: string, p: Record<string, any> = {}) {
    this.calls.push([command, p]);
    switch (command) {
      case 'channellist': return [...this.channels].map(([cid, c]) => ({ cid: String(cid), pid: String(c.pid), channel_name: c.name }));
      case 'whoami': return [{ client_id: String(this.me.clid), client_channel_id: String(this.me.cid) }];
      case 'channelcreate': {
        const cpid = Number(p.cpid ?? 0);
        if (cpid && !this.channels.has(cpid)) throw this.err(768, 'invalid channelID');
        if ([...this.channels.values()].some((c) => c.pid === cpid && c.name === p.channel_name)) throw this.err(771, 'channel name is already in use');
        const cid = this.next++;
        this.channels.set(cid, { pid: cpid, name: p.channel_name, params: p, perms: new Map([['i_channel_needed_permission_modify_power', 100], ['i_channel_needed_delete_power', 100]]) });
        this.me.cid = cid; // TeamSpeak moves the creator in
        return this.bareOk ? [] : [{ cid: String(cid) }];
      }
      case 'channeladdperm': this.channels.get(Number(p.cid))!.perms.set(p.permsid, Number(p.permvalue)); return [];
      case 'channelpermlist': return [...this.channels.get(Number(p.cid))!.perms.keys()].map((permsid) => ({ permsid }));
      case 'channeldelperm': this.channels.get(Number(p.cid))!.perms.delete(p.permsid); return [];
      case 'clientmove': if (this.me.cid === Number(p.cid)) throw this.err(770, 'already member of channel'); this.me.cid = Number(p.cid); return [];
    }
    throw new Error(`unexpected ${command}`);
  }
}

function fakePrisma(refs = false) {
  return {
    supportQueue: { findMany: async () => (refs ? [{ channelId: 3, settings: JSON.stringify({ afkChannelIds: [2] }) }] : []) },
    musicBot: { findMany: async ({ where }: any) => (refs && where.defaultChannel === '2' ? [{ name: 'Radio' }] : []) },
    botFlow: { findMany: async () => (refs ? [{ name: 'Mover', flowData: JSON.stringify({ nodes: [{ id: 'n', type: 'action_move', label: 'Move', config: { channelId: '3' } }] }) }] : []) },
  } as any;
}
const sum = (outs: any[]) => outs.map((o) => `${o.oldId}:${o.status}${o.role ? `:${o.role}` : ''}${o.reason ? `:${o.reason}` : ''}`);

describe('restoreChannels', () => {
  it('preview of a child brings its deleted parent; preview of a parent offers its deleted child', async () => {
    const ts = new FakeTs();
    assert.deepEqual(sum(await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 3 }], { dryRun: true })), ['2:ready:parent', '3:ready']);
    assert.deepEqual(sum(await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 2 }], { dryRun: true })), ['2:ready', '3:ready:child']);
    assert.deepEqual(ts.calls.map((c) => c[0]), ['channellist', 'channellist'], 'a preview only reads the channel list');
  });

  it('restores parent then child in place, with fields, permissions and a new password; the query client goes back', async () => {
    const ts = new FakeTs();
    const outs = await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 2, password: 'new-secret' }, { id: 3 }], {});
    assert.deepEqual(sum(outs), ['2:created', '3:created']);
    const [p, c] = outs;
    const parent = ts.channels.get(p.newId!)!;
    const child = ts.channels.get(c.newId!)!;
    assert.equal(parent.pid, 0);
    assert.equal(parent.params.channel_order, snap.channels.get(2)!.order, 'below the same channel as before');
    assert.equal(parent.params.channel_description, 'line one\nline | two');
    assert.equal(parent.params.channel_password, 'new-secret');
    assert.equal(p.password, 'set');
    assert.equal(child.pid, p.newId, 'the child goes under the NEW parent');
    assert.deepEqual([...child.perms].sort(), [...snap.channels.get(3)!.perms].map(([k, v]) => [k, v.value]).sort(), 'exactly the snapshot permissions');
    assert.ok(!('channel_password' in child.params) && c.password === undefined, 'the child had no password');
    assert.equal(ts.me.cid, 1, 'query client back in its channel');
  });

  it('a channel that had a password and gets none says so', async () => {
    const ts = new FakeTs();
    const [o] = await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 2 }], {});
    assert.equal(o.password, 'none');
    assert.ok(!('channel_password' in ts.channels.get(o.newId!)!.params));
  });

  it('a run restores only the listed children', async () => {
    const ts = new FakeTs();
    assert.deepEqual(sum(await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 2 }], {})), ['2:created']);
  });

  it('a taken name: preview says so and its child cannot follow; another name creates both; a repeat skips', async () => {
    const ts = new FakeTs();
    ts.channels.set(9, { pid: 0, name: 'Fixture Parent', params: {}, perms: new Map() });
    assert.deepEqual(sum(await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 2 }, { id: 3 }], { dryRun: true })), ['2:name-taken', '3:skipped:parent-missing']);
    const outs = await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 2, newName: 'Fixture Parent old' }, { id: 3 }], {});
    assert.deepEqual(sum(outs), ['2:created', '3:created']);
    assert.equal(ts.channels.get(outs[0].newId!)!.name, 'Fixture Parent old');
    // Again: the deleted parent comes along, its name is taken now, so neither is created twice.
    assert.deepEqual(sum(await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 3 }], {})), ['2:skipped:parent:name-taken', '3:skipped:parent-missing']);
  });

  it('a too long name, an unknown or still existing channel are refused', async () => {
    const ts = new FakeTs();
    assert.deepEqual(sum(await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 2, newName: 'x'.repeat(41) }, { id: 4 }, { id: 999 }], {})),
      ['4:skipped:still-exists', '999:skipped:not-in-snapshot', '2:skipped:invalid-name']);
    assert.ok(!ts.calls.some(([c]) => c === 'channelcreate'));
  });

  it('a bare ok without the cid finds the new channel by name and parent', async () => {
    const ts = new FakeTs();
    ts.bareOk = true;
    const outs = await restoreChannels(ts, fakePrisma(), 1, 1, snap, [{ id: 2 }, { id: 3 }], {});
    assert.deepEqual(sum(outs), ['2:created', '3:created']);
    assert.equal(ts.channels.get(outs[1].newId!)!.pid, outs[0].newId);
  });

  it('lists the manager places naming the old channel id', async () => {
    const outs = await restoreChannels(new FakeTs(), fakePrisma(true), 1, 1, snap, [{ id: 2 }, { id: 3 }], { dryRun: true });
    assert.deepEqual(outs.map((o) => o.references), [
      [{ where: 'support-queue', detail: '3:afkChannelIds' }, { where: 'music-bot', detail: 'Radio' }],
      [{ where: 'support-queue', detail: '3:channelId' }, { where: 'flow', detail: 'Mover / Move / channelId' }],
    ]);
  });
});
