// Stage 4: bring deleted channels back from a snapshot with normal commands (channelcreate +
// one channeladdperm per permission), with their place in the tree. Measured on 6.0.0-beta13.1:
// channel_order = the id of the channel above (0 = first) works on create; a taken name under the
// same parent answers 771, an unknown parent 768, an unknown position 779; TeamSpeak hashes any
// channel_password it is given again, so a snapshot's hash cannot be set back; channel permissions
// ignore negated/skip; a new channel comes with two permissions of its own.
import { CHANNEL_NAME_MAX } from '@ts6/common';
import type { SnapshotRestoreChannelChoice, SnapshotRestoreOutcome, SnapshotRestorePermFailure } from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ParsedSnapshot, SnapshotChannel } from './ts-snapshot.js';
import { acquireChannelCreateLock } from './channel-create-lock.js';
import { codeOf, groupReferences, messageOf, type RestoreClient } from './snapshot-restore.js';

const NAME_TAKEN = 771;
const ALREADY_THERE = 770;

/** The snapshot fields a channel is created with; empty ones are left to TeamSpeak's default. */
const CHANNEL_CREATE_FIELDS = [
  'channel_topic', 'channel_description', 'channel_name_phonetic', 'channel_codec', 'channel_codec_quality',
  'channel_codec_latency_factor', 'channel_codec_is_unencrypted', 'channel_maxclients', 'channel_maxfamilyclients',
  'channel_flag_maxclients_unlimited', 'channel_flag_maxfamilyclients_unlimited', 'channel_flag_maxfamilyclients_inherited',
  'channel_flag_permanent', 'channel_flag_semi_permanent', 'channel_banner_gfx_url', 'channel_banner_mode',
] as const;

/** The deleted channels above `id` (closest first) that must come back before it; stops at one that still exists. */
function deletedAncestors(snap: ParsedSnapshot, live: Map<number, unknown>, id: number): number[] {
  const out: number[] = [];
  for (let pid = snap.channels.get(id)?.pid ?? 0; pid && !live.has(pid) && snap.channels.has(pid) && out.length < 1000; pid = snap.channels.get(pid)!.pid) out.push(pid);
  return out;
}

/** Depth from the top level, so parents are created before their children. */
function depth(snap: ParsedSnapshot, id: number): number {
  let d = 0;
  for (let pid = snap.channels.get(id)?.pid ?? 0; pid && snap.channels.has(pid) && d < 1000; pid = snap.channels.get(pid)!.pid) d++;
  return d;
}

/** Siblings in their snapshot order: a channel's `order` is the id of the one above it. */
function snapshotOrder(snap: ParsedSnapshot, ids: number[]): number[] {
  const left = new Set(ids);
  const out: number[] = [];
  while (left.size) {
    // the next one sits below something already placed, or below nothing that is still to come
    const next = [...left].find((id) => !left.has(snap.channels.get(id)!.order)) ?? [...left][0];
    out.push(next);
    left.delete(next);
  }
  return out;
}

/**
 * Previews (dryRun) or restores deleted channels with their fields and permissions. A chosen channel
 * whose parent was deleted too brings that parent along (role `parent`); a preview also offers the
 * deleted subchannels (role `child`), which a run restores only when they are listed. A channel that
 * had a password gets the new one from the choice, or none.
 */
export async function restoreChannels(
  client: RestoreClient,
  prisma: PrismaClient,
  configId: number,
  sid: number,
  snap: ParsedSnapshot,
  choices: SnapshotRestoreChannelChoice[],
  opts: { dryRun?: boolean },
): Promise<SnapshotRestoreOutcome[]> {
  const rows: Array<Record<string, string>> = await client.execute(sid, 'channellist');
  const live = new Map(rows.map((r) => [Number(r.cid), { pid: Number(r.pid), name: r.channel_name }]));
  const outcomes: SnapshotRestoreOutcome[] = [];
  const base = (c: SnapshotChannel) => ({ kind: 'channel' as const, oldId: c.id, name: c.fields.channel_name, permissions: c.perms.size, parentOldId: c.pid });

  const plan = new Map<number, { choice: SnapshotRestoreChannelChoice; role?: 'parent' | 'child' }>();
  for (const choice of choices) {
    const c = snap.channels.get(Number(choice.id));
    if (!c) { outcomes.push({ kind: 'channel', oldId: Number(choice.id), name: '', permissions: 0, status: 'skipped', reason: 'not-in-snapshot', references: [] }); continue; }
    if (live.has(c.id)) { outcomes.push({ ...base(c), status: 'skipped', reason: 'still-exists', references: [] }); continue; }
    plan.set(c.id, { choice });
  }
  for (const id of [...plan.keys()]) {
    for (const pid of deletedAncestors(snap, live, id)) if (!plan.has(pid)) plan.set(pid, { choice: { id: pid }, role: 'parent' });
  }
  if (opts.dryRun) {
    // the preview offers every deleted channel below one that is coming back
    for (const c of snap.channels.values()) {
      if (plan.has(c.id) || live.has(c.id)) continue;
      const above = [c.pid, ...deletedAncestors(snap, live, c.pid)].filter(Boolean);
      if (above.every((pid) => !live.has(pid)) && above.some((pid) => plan.has(pid) && plan.get(pid)!.role !== 'parent')) {
        plan.set(c.id, { choice: { id: c.id }, role: 'child' });
      }
    }
  }

  // parents first; siblings in their snapshot order so "below" points at one already there
  const byDepth = new Map<number, number[]>();
  for (const id of plan.keys()) { const d = depth(snap, id); byDepth.set(d, [...(byDepth.get(d) ?? []), id]); }
  const ordered = [...byDepth.keys()].sort((a, b) => a - b).flatMap((d) => snapshotOrder(snap, byDepth.get(d)!));

  const newIds = new Map<number, number>();
  const skipped = new Set<number>();
  const release = opts.dryRun ? null : await acquireChannelCreateLock(`${configId}:${sid}`);
  let me: { clid: number; cid: number } | null = null;
  try {
    if (!opts.dryRun && ordered.length) {
      const who = (await client.execute(sid, 'whoami'))?.[0];
      if (who) me = { clid: Number(who.client_id), cid: Number(who.client_channel_id) };
    }
    for (const id of ordered) {
      const c = snap.channels.get(id)!;
      const { choice, role } = plan.get(id)!;
      const references = await groupReferences(prisma, configId, sid, 'channel', c.id);
      const hadPassword = c.fields.channel_flag_password === '1';
      const password = hadPassword ? (typeof choice.password === 'string' && choice.password !== '' ? 'set' as const : 'none' as const) : undefined;
      const extra = { references, ...(role ? { role } : {}), ...(password ? { password } : {}), ...(c.fields.channel_flag_default === '1' ? { defaultDropped: true as const } : {}) };
      const name = choice.newName === undefined ? c.fields.channel_name : String(choice.newName).trim();
      const createdAs = name !== c.fields.channel_name ? name : undefined;
      const skip = (reason: SnapshotRestoreOutcome['reason']) => { skipped.add(c.id); outcomes.push({ ...base(c), status: 'skipped', reason, createdAs, ...extra }); };
      if (!name || [...name].length > CHANNEL_NAME_MAX) { skip('invalid-name'); continue; }
      // where it goes: the parent as it is now (still there, created a moment ago, or - in a preview - about to be)
      const parentComing = plan.has(c.pid) && !skipped.has(c.pid);
      const parent = c.pid === 0 ? 0 : live.has(c.pid) ? c.pid : newIds.get(c.pid) ?? (opts.dryRun && parentComing ? -1 : null);
      if (parent === null) { skip('parent-missing'); continue; }
      if (parent >= 0 && [...live.values()].some((l) => l.pid === parent && l.name === name)) {
        if (opts.dryRun) { skipped.add(c.id); outcomes.push({ ...base(c), status: 'name-taken', createdAs, ...extra }); } else skip('name-taken');
        continue;
      }
      if (opts.dryRun) { outcomes.push({ ...base(c), status: 'ready', createdAs, ...extra }); continue; }

      const params: Record<string, unknown> = { channel_name: name, cpid: parent };
      for (const f of CHANNEL_CREATE_FIELDS) if (c.fields[f] !== '' && c.fields[f] !== undefined) params[f] = c.fields[f];
      // A channel that is neither permanent nor semi-permanent would vanish the moment it is empty.
      if (params.channel_flag_permanent !== '1' && params.channel_flag_semi_permanent !== '1') params.channel_flag_permanent = 1;
      const below = c.order === 0 ? 0 : live.has(c.order) ? c.order : newIds.get(c.order);
      if (below !== undefined) params.channel_order = below;
      if (password === 'set') params.channel_password = choice.password;

      let newId: number;
      try {
        const created = await client.execute(sid, 'channelcreate', params);
        newId = Number((Array.isArray(created) ? created[0] : created)?.cid);
        if (!Number.isInteger(newId) || newId <= 0) {
          // TS6 sometimes answers a bare "ok" without the cid (measured 2026-11-10); the name was free, so it finds it.
          const now: Array<Record<string, string>> = await client.execute(sid, 'channellist');
          newId = Number(now.find((x) => x.channel_name === name && Number(x.pid) === parent)?.cid);
          if (!Number.isInteger(newId) || newId <= 0) throw new Error('TeamSpeak did not say which channel it created');
        }
      } catch (err) {
        if (codeOf(err) === NAME_TAKEN) skip('name-taken');
        else { skipped.add(c.id); outcomes.push({ ...base(c), status: 'failed', message: messageOf(err), createdAs, ...extra }); }
        continue;
      }
      newIds.set(c.id, newId);
      live.set(newId, { pid: parent, name });

      const permFailures: SnapshotRestorePermFailure[] = [];
      for (const [perm, v] of c.perms) {
        try { await client.execute(sid, 'channeladdperm', { cid: newId, permsid: perm, permvalue: v.value }); } catch (err) { permFailures.push({ perm, message: messageOf(err) }); }
      }
      // A new channel starts with a few permissions of its own; those the snapshot's channel did not have go.
      try {
        const has: Array<{ permsid: string }> = await client.execute(sid, 'channelpermlist', { cid: newId, '-permsid': '' });
        for (const p of has) {
          if (c.perms.has(p.permsid)) continue;
          try { await client.execute(sid, 'channeldelperm', { cid: newId, permsid: p.permsid }); } catch (err) { permFailures.push({ perm: p.permsid, message: messageOf(err) }); }
        }
      } catch (err) {
        permFailures.push({ perm: '*', message: messageOf(err) });
      }
      outcomes.push({ ...base(c), status: 'created', newId, createdAs, ...(permFailures.length ? { permFailures } : {}), ...extra });
    }
  } finally {
    // TeamSpeak moved the query client into each channel it created; put it back where it was.
    if (me && newIds.size) {
      try { await client.execute(sid, 'clientmove', { clid: me.clid, cid: me.cid }); } catch (err) { if (codeOf(err) !== ALREADY_THERE) console.warn(`[SnapshotRestore] Could not move the query client back: ${messageOf(err)}`); }
    }
    release?.();
  }
  return outcomes;
}
