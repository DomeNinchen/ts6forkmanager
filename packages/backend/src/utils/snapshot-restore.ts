// Stage 3: bring single server or channel groups back from a snapshot with normal commands
// (servergroupadd + one servergroupaddperm per permission), so TeamSpeak checks the caller's rights,
// unlike serversnapshotdeploy. The group gets a NEW id (TeamSpeak never reuses one); what still
// names the old id in the manager is listed, never rewritten. Measured on 6.0.0-beta13.1: a taken
// name answers 1282, a name over 30 characters 1541, an unknown permission 2562; a new group comes
// with a few permissions of its own; channel groups ignore negated/skip.
import { flowGroupReferences, GROUP_NAME_MAX } from '@ts6/common';
import type {
  SnapshotGroupKind,
  SnapshotGroupReference,
  SnapshotRestoreGroupChoice,
  SnapshotRestoreOutcome,
  SnapshotRestorePermFailure,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ParsedSnapshot, SnapshotGroup } from './ts-snapshot.js';

export interface RestoreClient {
  execute(sid: number, command: string, params?: Record<string, unknown>): Promise<any>;
}

const DUPLICATE = 1282;
const CLIENT_GONE = 512;
const ALREADY_MEMBER = 2561;

const codeOf = (err: unknown) => (err as { code?: number })?.code;
const messageOf = (err: unknown) => {
  const e = err as { code?: number; message?: string; failedPermission?: string };
  return `${e.message ?? String(err)}${e.code !== undefined && e.code > 0 ? ` (${e.code}${e.failedPermission ? `, ${e.failedPermission}` : ''})` : ''}`;
};

const CMD = {
  serverGroup: { list: 'servergrouplist', add: 'servergroupadd', addPerm: 'servergroupaddperm', delPerm: 'servergroupdelperm', permList: 'servergrouppermlist', id: 'sgid' },
  channelGroup: { list: 'channelgrouplist', add: 'channelgroupadd', addPerm: 'channelgroupaddperm', delPerm: 'channelgroupdelperm', permList: 'channelgrouppermlist', id: 'cgid' },
} as const;

const parseIds = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : []);

/** Every place in the manager that names this group id on this virtual server. */
export async function groupReferences(prisma: PrismaClient, configId: number, sid: number, kind: SnapshotGroupKind, id: number): Promise<SnapshotGroupReference[]> {
  const out: SnapshotGroupReference[] = [];
  if (kind === 'serverGroup') {
    if (await prisma.protectedServerGroup.findFirst({ where: { serverConfigId: configId, sid, sgid: id } })) out.push({ where: 'protected-group', detail: '' });
    const temporary = await prisma.temporaryServerGroup.count({ where: { serverConfigId: configId, sid, sgid: id, state: 'active' } });
    if (temporary) out.push({ where: 'temporary-group', detail: String(temporary) });
    for (const q of await prisma.supportQueue.findMany({ where: { serverConfigId: configId, sid } })) {
      let s: Record<string, unknown> = {};
      try { s = JSON.parse(q.settings); } catch { /* unreadable settings name nothing */ }
      for (const field of ['vipGroupIds', 'supporterGroupIds']) if (parseIds(s[field]).includes(id)) out.push({ where: 'support-queue', detail: `${q.channelId}:${field}` });
    }
    const raid = await prisma.raidProtection.findFirst({ where: { serverConfigId: configId, sid } });
    if (raid) {
      let s: Record<string, unknown> = {};
      try { s = JSON.parse(raid.settings); } catch { /* as above */ }
      for (const field of ['exemptGroupIds', 'notifyGroupIds']) if (parseIds(s[field]).includes(id)) out.push({ where: 'raid-protection', detail: field });
      if (Number(s.restrictGroupId) === id) out.push({ where: 'raid-protection', detail: 'restrictGroupId' });
    }
    // Chat command rights are per connection (no virtual server); listed because they may mean this one.
    for (const p of await prisma.botCommandPermission.findMany({ where: { serverConfigId: configId } })) {
      if (p.allowedGroupIds.split(',').map((x) => x.trim()).includes(String(id))) out.push({ where: 'command-permission', detail: p.command });
    }
    if (await prisma.botCommandAdminGroup.findFirst({ where: { serverConfigId: configId, groupId: String(id) } })) out.push({ where: 'command-admin-group', detail: '' });
  }
  for (const flow of await prisma.botFlow.findMany({ where: { serverConfigId: configId, virtualServerId: sid }, select: { name: true, flowData: true } })) {
    let nodes: unknown[] = [];
    try { nodes = JSON.parse(flow.flowData).nodes ?? []; } catch { /* unreadable flow names nothing */ }
    for (const r of flowGroupReferences(nodes, kind === 'serverGroup' ? 'servergroup' : 'channelgroup', id)) {
      out.push({ where: 'flow', detail: `${flow.name} / ${r.node} / ${r.field}` });
    }
  }
  return out;
}

/** The name a choice creates the group under, or null when the replacement name is not usable. */
function nameFor(choice: SnapshotRestoreGroupChoice, group: SnapshotGroup): string | null {
  if (choice.newName === undefined) return group.name;
  const name = String(choice.newName).trim();
  return name && name.length <= GROUP_NAME_MAX ? name : null;
}

/**
 * Previews (dryRun) or restores the chosen groups, one after another, each with its own outcome.
 * A group whose id is still on the server is left alone (changing an existing group is not this);
 * a taken name is skipped unless the choice names another one. Permissions that fail are reported
 * and the group is kept.
 */
export async function restoreGroups(
  client: RestoreClient,
  prisma: PrismaClient,
  configId: number,
  sid: number,
  snap: ParsedSnapshot,
  choices: SnapshotRestoreGroupChoice[],
  opts: { dryRun?: boolean; members?: boolean },
): Promise<SnapshotRestoreOutcome[]> {
  const live: Record<SnapshotGroupKind, { ids: Set<number>; names: Set<string> } | undefined> = { serverGroup: undefined, channelGroup: undefined };
  const liveOf = async (kind: SnapshotGroupKind) => {
    if (!live[kind]) {
      const rows: Array<Record<string, string>> = await client.execute(sid, CMD[kind].list);
      // Only regular groups (type 1) are restored, and names only clash among those.
      const regular = rows.filter((r) => String(r.type) === '1');
      live[kind] = { ids: new Set(regular.map((r) => Number(r[CMD[kind].id]))), names: new Set(regular.map((r) => r.name)) };
    }
    return live[kind]!;
  };

  const outcomes: SnapshotRestoreOutcome[] = [];
  for (const choice of choices) {
    const kind = choice.kind;
    const group = (kind === 'serverGroup' ? snap.serverGroups : snap.channelGroups).get(Number(choice.id));
    const base = { kind, oldId: Number(choice.id), name: group?.name ?? '', permissions: group?.perms.size ?? 0 };
    if (!group) { outcomes.push({ ...base, status: 'skipped', reason: 'not-in-snapshot', references: [] }); continue; }
    const references = await groupReferences(prisma, configId, sid, kind, group.id);
    const members: SnapshotRestoreOutcome['members'] = kind === 'serverGroup' ? { inSnapshot: snap.serverGroupMembers.get(group.id)?.length ?? 0 } : undefined;
    const name = nameFor(choice, group);
    const createdAs = name !== null && name !== group.name ? name : undefined;
    const now = await liveOf(kind);
    if (name === null) { outcomes.push({ ...base, status: 'skipped', reason: 'invalid-name', members, references }); continue; }
    if (now.ids.has(group.id)) { outcomes.push({ ...base, status: 'skipped', reason: 'still-exists', members, references }); continue; }
    if (now.names.has(name)) {
      outcomes.push({ ...base, status: opts.dryRun ? 'name-taken' : 'skipped', ...(opts.dryRun ? {} : { reason: 'name-taken' as const }), createdAs, members, references });
      continue;
    }
    if (opts.dryRun) { outcomes.push({ ...base, status: 'ready', createdAs, members, references }); continue; }

    let newId: number;
    try {
      const created = await client.execute(sid, CMD[kind].add, { name });
      newId = Number((Array.isArray(created) ? created[0] : created)?.[CMD[kind].id]);
      if (!Number.isInteger(newId) || newId <= 0) throw new Error('TeamSpeak returned no id for the new group');
    } catch (err) {
      if (codeOf(err) === DUPLICATE) { now.names.add(name); outcomes.push({ ...base, status: 'skipped', reason: 'name-taken', createdAs, members, references }); }
      else outcomes.push({ ...base, status: 'failed', message: messageOf(err), createdAs, members, references });
      continue;
    }
    now.ids.add(newId);
    now.names.add(name);

    const permFailures: SnapshotRestorePermFailure[] = [];
    for (const [perm, v] of group.perms) {
      const params: Record<string, unknown> = { [CMD[kind].id]: newId, permsid: perm, permvalue: v.value };
      if (kind === 'serverGroup') Object.assign(params, { permnegated: v.negated ? 1 : 0, permskip: v.skip ? 1 : 0 });
      try { await client.execute(sid, CMD[kind].addPerm, params); } catch (err) { permFailures.push({ perm, message: messageOf(err) }); }
    }
    // A new group starts with a few permissions of its own; those the snapshot's group did not have go.
    try {
      const has: Array<{ permsid: string }> = await client.execute(sid, CMD[kind].permList, { [CMD[kind].id]: newId, '-permsid': '' });
      for (const p of has) {
        if (group.perms.has(p.permsid)) continue;
        try { await client.execute(sid, CMD[kind].delPerm, { [CMD[kind].id]: newId, permsid: p.permsid }); } catch (err) { permFailures.push({ perm: p.permsid, message: messageOf(err) }); }
      }
    } catch (err) {
      permFailures.push({ perm: '*', message: messageOf(err) });
    }

    if (members && opts.members) {
      Object.assign(members, { added: 0, missing: 0, failed: 0 });
      for (const cldbid of snap.serverGroupMembers.get(group.id) ?? []) {
        try { await client.execute(sid, 'servergroupaddclient', { sgid: newId, cldbid }); members.added!++; }
        catch (err) {
          if (codeOf(err) === ALREADY_MEMBER) members.added!++;
          else if (codeOf(err) === CLIENT_GONE) members.missing!++;
          else members.failed!++;
        }
      }
    }
    outcomes.push({ ...base, status: 'created', newId, createdAs, ...(permFailures.length ? { permFailures } : {}), members, references });
  }
  return outcomes;
}
