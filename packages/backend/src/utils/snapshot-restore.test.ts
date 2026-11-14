// restoreGroups against a stand-in TeamSpeak that answers like 6.0.0-beta13.1 did when measured
// (1282 taken name, new ids never reused, default permissions on a new group, 2562 unknown
// permission, 512 unknown client, 2561 already a member). The live run is in the PR.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSnapshot, parseSnapshotText } from './ts-snapshot.js';
import { groupReferences, restoreGroups } from './snapshot-restore.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'snapshots');
// Snapshot a (groups 9 "Fixture Moderators", 10 "Fixture Gone", channel group 9) with two members of group 10 added.
const text = decodeSnapshot(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8'))).text
  .replace('end_groups|end_relations|channel_groups', 'end_groups|iid=0 cldbid=50 gid=10|iid=0 cldbid=51 gid=10|end_relations|channel_groups');
const snap = parseSnapshotText(text);

class FakeTs {
  calls: string[] = [];
  nextId = 20;
  groups = new Map<string, { id: number; name: string; type: number; perms: Map<string, string> }>();
  members = new Set<string>();
  clients = new Set([50]);
  denyPerm: string | null = null;
  constructor() {
    this.groups.set('s9', { id: 9, name: 'Fixture Moderators', type: 1, perms: new Map() }); // 10 was deleted
    this.groups.set('s1', { id: 1, name: 'Guest Server Query', type: 2, perms: new Map() });
  }
  err(code: number, message: string) { return Object.assign(new Error(message), { code }); }
  async execute(_sid: number, command: string, p: Record<string, any> = {}) {
    this.calls.push(command);
    const kind = command.startsWith('server') ? 's' : 'c';
    const key = (id: unknown) => `${kind}${id}`;
    switch (command) {
      case 'servergrouplist': case 'channelgrouplist':
        return [...this.groups.entries()].filter(([k]) => k[0] === kind).map(([, g]) => ({ [kind === 's' ? 'sgid' : 'cgid']: String(g.id), name: g.name, type: String(g.type) }));
      case 'servergroupadd': case 'channelgroupadd': {
        if ([...this.groups.entries()].some(([k, g]) => k[0] === kind && g.type === 1 && g.name === p.name)) throw this.err(1282, 'database duplicate entry');
        if (String(p.name).length > 30) throw this.err(1541, 'invalid parameter size');
        const id = this.nextId++;
        const perms = new Map([['i_group_needed_modify_power', '100'], ['i_group_needed_member_add_power', '100'], ['i_group_needed_member_remove_power', '100']]);
        if (kind === 's') perms.set('b_group_is_permanent', '1');
        this.groups.set(key(id), { id, name: p.name, type: 1, perms });
        return [{ [kind === 's' ? 'sgid' : 'cgid']: String(id) }];
      }
      case 'servergroupaddperm': case 'channelgroupaddperm': {
        if (p.permsid === this.denyPerm) throw Object.assign(this.err(2568, 'insufficient client permissions'), { failedPermission: 'i_permission_modify_power' });
        if (p.permsid === 'i_unknown_perm') throw this.err(2562, 'invalid permission ID');
        this.groups.get(key(p.sgid ?? p.cgid))!.perms.set(p.permsid, `${p.permvalue}/${p.permnegated ?? 0}/${p.permskip ?? 0}`);
        return [];
      }
      case 'servergrouppermlist': case 'channelgrouppermlist':
        return [...this.groups.get(key(p.sgid ?? p.cgid))!.perms.keys()].map((permsid) => ({ permsid }));
      case 'servergroupdelperm': case 'channelgroupdelperm':
        this.groups.get(key(p.sgid ?? p.cgid))!.perms.delete(p.permsid);
        return [];
      case 'servergroupaddclient':
        if (!this.clients.has(p.cldbid)) throw this.err(512, 'invalid clientID');
        if (this.members.has(`${p.sgid}:${p.cldbid}`)) throw this.err(2561, 'duplicate entry');
        this.members.add(`${p.sgid}:${p.cldbid}`);
        return [];
    }
    throw new Error(`unexpected ${command}`);
  }
}

/** A manager database where old group 10 is protected, in a support queue, the raid exemptions, a chat command and a flow. */
function fakePrisma(empty = false) {
  const flow = { nodes: [{ id: 'n1', type: 'action_groupAdd', label: 'Give VIP', config: { groupId: '10' } }, { id: 'n2', type: 'action_idleKicker', config: { exemptGroupIds: '7,10' } }] };
  return {
    protectedServerGroup: { findFirst: async ({ where }: any) => (!empty && where.sgid === 10 ? { id: 1 } : null) },
    temporaryServerGroup: { count: async ({ where }: any) => (!empty && where.sgid === 10 && where.state === 'active' ? 2 : 0) },
    supportQueue: { findMany: async () => (empty ? [] : [{ channelId: 77, settings: JSON.stringify({ vipGroupIds: [3], supporterGroupIds: [10] }) }]) },
    raidProtection: { findFirst: async () => (empty ? null : { settings: JSON.stringify({ exemptGroupIds: [10], notifyGroupIds: [], restrictGroupId: 10 }) }) },
    botCommandPermission: { findMany: async () => (empty ? [] : [{ command: 'play', allowedGroupIds: '6, 10' }, { command: 'skip', allowedGroupIds: '100' }]) },
    botCommandAdminGroup: { findFirst: async () => null },
    botFlow: { findMany: async () => (empty ? [] : [{ name: 'Welcome', flowData: JSON.stringify(flow) }, { name: 'Broken', flowData: '{' }]) },
  } as any;
}

const gone = { kind: 'serverGroup' as const, id: 10 };

describe('restoreGroups', () => {
  it('preview: ready, nothing sent but the group lists', async () => {
    const ts = new FakeTs();
    const [o] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [gone], { dryRun: true });
    assert.equal(o.status, 'ready');
    assert.equal(o.name, 'Fixture Gone');
    assert.equal(o.permissions, snap.serverGroups.get(10)!.perms.size);
    assert.deepEqual(o.members, { inSnapshot: 2 });
    assert.deepEqual(ts.calls, ['servergrouplist']);
  });

  it('creates the group with exactly the snapshot permissions, and a repeat creates nothing twice', async () => {
    const ts = new FakeTs();
    const [o] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [gone], {});
    assert.equal(o.status, 'created');
    assert.equal(o.newId, 20);
    assert.equal(o.permFailures, undefined);
    const want = [...snap.serverGroups.get(10)!.perms].map(([k, v]) => `${k}=${v.value}/${v.negated ? 1 : 0}/${v.skip ? 1 : 0}`).sort();
    assert.deepEqual([...ts.groups.get('s20')!.perms].map(([k, v]) => `${k}=${v}`).sort(), want);
    assert.equal(o.members?.added, undefined, 'members only with the checkbox');

    const [again] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [gone], {});
    assert.equal(again.status, 'skipped');
    assert.equal(again.reason, 'name-taken');
    assert.equal(ts.groups.size, 3);
  });

  it('a taken name: preview says so; another name creates it; a too long or empty one is refused', async () => {
    const ts = new FakeTs();
    const moderators = { kind: 'serverGroup' as const, id: 9 };
    ts.groups.delete('s9');
    ts.groups.set('s15', { id: 15, name: 'Fixture Moderators', type: 1, perms: new Map() }); // same name, other id
    const [p] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [moderators], { dryRun: true });
    assert.equal(p.status, 'name-taken');
    const [p2] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [{ ...moderators, newName: 'Moderators old' }], { dryRun: true });
    assert.deepEqual([p2.status, p2.createdAs], ['ready', 'Moderators old']);
    const [bad] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [{ ...moderators, newName: 'x'.repeat(31) }], { dryRun: true });
    assert.deepEqual([bad.status, bad.reason], ['skipped', 'invalid-name']);
    const [blank] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [{ ...moderators, newName: '  ' }], {});
    assert.deepEqual([blank.status, blank.reason], ['skipped', 'invalid-name']);
    const [run] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [{ ...moderators, newName: ' Moderators old ' }], {});
    assert.deepEqual([run.status, run.createdAs, ts.groups.get(`s${run.newId}`)?.name], ['created', 'Moderators old', 'Moderators old']);
    const [skip] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [moderators], {});
    assert.deepEqual([skip.status, skip.reason], ['skipped', 'name-taken']);
  });

  it('a group still on the server, or not in the snapshot, is left alone', async () => {
    const ts = new FakeTs();
    const [still, missing] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [{ kind: 'serverGroup', id: 9 }, { kind: 'serverGroup', id: 999 }], {});
    assert.deepEqual([still.status, still.reason], ['skipped', 'still-exists']);
    assert.deepEqual([missing.status, missing.reason], ['skipped', 'not-in-snapshot']);
    assert.ok(!ts.calls.includes('servergroupadd'));
  });

  it('a permission that cannot be set is reported and the group is kept', async () => {
    const ts = new FakeTs();
    ts.denyPerm = 'i_icon_id';
    const s2 = parseSnapshotText(text.replace('name=Fixture\\sGone ', 'name=Fixture\\sGone permid=i_unknown_perm permvalue=1 permskip=0 permnegated=0|'));
    const [o] = await restoreGroups(ts, fakePrisma(true), 1, 1, s2, [gone], {});
    assert.equal(o.status, 'created');
    assert.deepEqual(o.permFailures?.map((f) => f.perm).sort(), ['i_icon_id', 'i_unknown_perm']);
    assert.match(o.permFailures!.find((f) => f.perm === 'i_icon_id')!.message, /2568, i_permission_modify_power/);
    assert.ok(ts.groups.get('s20'));
  });

  it('members only with the checkbox: still-known clients added, gone ones counted', async () => {
    const ts = new FakeTs();
    const [o] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [gone], { members: true });
    assert.deepEqual(o.members, { inSnapshot: 2, added: 1, missing: 1, failed: 0 });
    assert.ok(ts.members.has('20:50'));
  });

  it('a channel group: no negated/skip sent, no members', async () => {
    const ts = new FakeTs();
    const [o] = await restoreGroups(ts, fakePrisma(true), 1, 1, snap, [{ kind: 'channelGroup', id: 9 }], { members: true });
    assert.equal(o.status, 'created');
    assert.equal(o.members, undefined);
    assert.deepEqual([...ts.groups.get(`c${o.newId}`)!.perms.keys()].sort(), [...snap.channelGroups.get(9)!.perms.keys()].sort());
    assert.ok([...ts.groups.get(`c${o.newId}`)!.perms.values()].every((v) => v.endsWith('/0/0')));
  });
});

describe('groupReferences', () => {
  it('lists every place naming the old id, and only those', async () => {
    const refs = await groupReferences(fakePrisma(), 1, 1, 'serverGroup', 10);
    assert.deepEqual(refs, [
      { where: 'protected-group', detail: '' },
      { where: 'temporary-group', detail: '2' },
      { where: 'support-queue', detail: '77:supporterGroupIds' },
      { where: 'raid-protection', detail: 'exemptGroupIds' },
      { where: 'raid-protection', detail: 'restrictGroupId' },
      { where: 'command-permission', detail: 'play' },
      { where: 'flow', detail: 'Give VIP / groupId' },
      { where: 'flow', detail: 'action_idleKicker / exemptGroupIds' },
    ].map((r) => (r.where === 'flow' ? { ...r, detail: `Welcome / ${r.detail}` } : r)));
    assert.deepEqual(await groupReferences(fakePrisma(), 1, 1, 'serverGroup', 3), [{ where: 'support-queue', detail: '77:vipGroupIds' }]);
    assert.deepEqual(await groupReferences(fakePrisma(), 1, 1, 'channelGroup', 10), []);
  });
});
