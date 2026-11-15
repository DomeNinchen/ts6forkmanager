// Stage 4b: set single permissions and fields of a group or channel that still exists back to the
// snapshot, with normal commands under the caller's rights. A permission the snapshot's object does
// not have is removed (delperm of an unset permission answers ok, measured). Channel permissions and
// channel group permissions take the value only (they ignore negated/skip, measured on 6.0.0-beta13.1).
import { SNAPSHOT_RESET_EXCLUDED_FIELDS } from '@ts6/common';
import type { SnapshotObjectKind, SnapshotPermValue, SnapshotResetChoice, SnapshotResetOutcome } from '@ts6/common';
import type { ParsedSnapshot } from './ts-snapshot.js';
import { messageOf, type RestoreClient } from './snapshot-restore.js';

const CMD = {
  serverGroup: { list: 'servergrouplist', idKey: 'sgid', nameKey: 'name', addPerm: 'servergroupaddperm', delPerm: 'servergroupdelperm', rename: 'servergrouprename' },
  channelGroup: { list: 'channelgrouplist', idKey: 'cgid', nameKey: 'name', addPerm: 'channelgroupaddperm', delPerm: 'channelgroupdelperm', rename: 'channelgrouprename' },
  channel: { list: 'channellist', idKey: 'cid', nameKey: 'channel_name', addPerm: 'channeladdperm', delPerm: 'channeldelperm', rename: '' },
} as const;

/** The snapshot's object: its name, fields (a group has only its name) and permissions. */
function snapshotObject(snap: ParsedSnapshot, kind: SnapshotObjectKind, id: number): { fields: Record<string, string>; perms: Map<string, SnapshotPermValue> } | null {
  if (kind === 'channel') {
    const c = snap.channels.get(id);
    return c ? { fields: c.fields, perms: c.perms } : null;
  }
  const g = (kind === 'serverGroup' ? snap.serverGroups : snap.channelGroups).get(id);
  return g ? { fields: { name: g.name }, perms: g.perms } : null;
}

/**
 * Previews (dryRun) or sets the chosen permissions and fields back, one line per item. An object that
 * no longer exists, or a field that cannot be set back, is skipped with the reason.
 */
export async function resetItems(client: RestoreClient, sid: number, snap: ParsedSnapshot, choices: SnapshotResetChoice[], opts: { dryRun?: boolean }): Promise<SnapshotResetOutcome[]> {
  const lists = new Map<SnapshotObjectKind, Map<number, string>>();
  const liveNames = async (kind: SnapshotObjectKind) => {
    if (!lists.has(kind)) {
      const rows: Array<Record<string, string>> = await client.execute(sid, CMD[kind].list);
      lists.set(kind, new Map(rows.map((r) => [Number(r[CMD[kind].idKey]), r[CMD[kind].nameKey]])));
    }
    return lists.get(kind)!;
  };

  const out: SnapshotResetOutcome[] = [];
  for (const choice of choices) {
    const { kind, id } = choice;
    const cmd = CMD[kind];
    const live = await liveNames(kind);
    const name = live.get(id) ?? '';
    const was = snapshotObject(snap, kind, id);
    const items: Array<{ item: 'perm' | 'field'; key: string }> = [
      ...(choice.fields ?? []).map((key) => ({ item: 'field' as const, key })),
      ...(choice.perms ?? []).map((key) => ({ item: 'perm' as const, key })),
    ];
    for (const { item, key } of items) {
      const line = { kind, id, name, item, key };
      if (!live.has(id)) { out.push({ ...line, to: null, status: 'skipped', reason: 'object-gone' }); continue; }
      if (!was) { out.push({ ...line, to: null, status: 'skipped', reason: 'not-in-snapshot' }); continue; }
      if (item === 'field' && (SNAPSHOT_RESET_EXCLUDED_FIELDS.includes(key) || !(key in was.fields))) {
        out.push({ ...line, to: null, status: 'skipped', reason: 'not-resettable' });
        continue;
      }
      const to: string | SnapshotPermValue | null = item === 'field' ? was.fields[key] : was.perms.get(key) ?? null;
      if (opts.dryRun) { out.push({ ...line, to, status: 'ready' }); continue; }
      try {
        if (item === 'field') {
          if (kind === 'channel') await client.execute(sid, 'channeledit', { cid: id, [key]: to as string });
          else await client.execute(sid, cmd.rename, { [cmd.idKey]: id, name: to as string });
          if (key === 'name' || key === 'channel_name') live.set(id, to as string);
        } else if (to === null) {
          await client.execute(sid, cmd.delPerm, { [cmd.idKey]: id, permsid: key });
        } else {
          const v = to as SnapshotPermValue;
          await client.execute(sid, cmd.addPerm, { [cmd.idKey]: id, permsid: key, permvalue: v.value, ...(kind === 'serverGroup' ? { permnegated: v.negated ? 1 : 0, permskip: v.skip ? 1 : 0 } : {}) });
        }
        out.push({ ...line, to, status: 'ok' });
      } catch (err) {
        out.push({ ...line, to, status: 'failed', message: messageOf(err) });
      }
    }
  }
  return out;
}
