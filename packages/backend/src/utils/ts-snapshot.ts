// Reading a TeamSpeak 6 server snapshot ({version, data}) and comparing two of them.
// data = base64 of a zstd frame holding ServerQuery text: records split by '|', fields by ' ',
// `key=value` in query escaping, sections marked by bare begin_/end_ tokens (measured on
// 6.0.0-beta13.1, format version 3; TeamSpeak does not document it). Only groups, channels and
// their permissions are read; the server's keys, password hashes, API key hashes and client
// identities that a snapshot also holds are never picked up.
import zlib from 'node:zlib';
import { tsUnescape } from '@ts6/common';
import type {
  SnapshotCompareCounts,
  SnapshotCompareResult,
  SnapshotFieldChange,
  SnapshotObjectDiff,
  SnapshotObjectKind,
  SnapshotPermChange,
  SnapshotPermValue,
} from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';

export const SUPPORTED_SNAPSHOT_VERSIONS = ['3'];
/** A snapshot of a large server is a few MB of text; anything far beyond is not one. */
const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const REQUIRED_MARKERS = ['end_virtualserver', 'begin_channels', 'end_channels', 'begin_permissions', 'server_groups', 'channel_groups', 'end_permissions'];

/**
 * The channel fields compared, by allowlist: a field a later beta adds (possibly a secret, like
 * channel_password and channel_security_salt today) stays out until it is named here.
 */
const CHANNEL_FIELDS = [
  'channel_name', 'channel_topic', 'channel_description', 'channel_name_phonetic',
  'channel_flag_permanent', 'channel_flag_semi_permanent', 'channel_flag_default', 'channel_flag_password',
  'channel_codec', 'channel_codec_quality', 'channel_codec_latency_factor', 'channel_codec_is_unencrypted',
  'channel_maxclients', 'channel_maxfamilyclients', 'channel_flag_maxclients_unlimited',
  'channel_flag_maxfamilyclients_unlimited', 'channel_flag_maxfamilyclients_inherited',
  'channel_banner_gfx_url', 'channel_banner_mode', 'channel_storage_quota',
] as const;

export interface SnapshotGroup { id: number; name: string; perms: Map<string, SnapshotPermValue> }
export interface SnapshotChannel { id: number; pid: number; order: number; fields: Record<string, string>; perms: Map<string, SnapshotPermValue> }
export interface ParsedSnapshot {
  version: string;
  serverGroups: Map<number, SnapshotGroup>;
  channelGroups: Map<number, SnapshotGroup>;
  channels: Map<number, SnapshotChannel>;
}

/** The text inside a snapshot, or a 400 saying why it is not one this version can read. */
export function decodeSnapshot(snapshot: { version?: unknown; data?: unknown; salt?: unknown }): { version: string; text: string } {
  if (!snapshot || typeof snapshot.data !== 'string' || snapshot.data === '' || (typeof snapshot.version !== 'string' && typeof snapshot.version !== 'number')) {
    throw new AppError(400, 'Not a server snapshot (version and data are missing)');
  }
  if (snapshot.salt) throw new AppError(400, 'This snapshot is protected with a password; it cannot be compared');
  const version = String(snapshot.version);
  if (!SUPPORTED_SNAPSHOT_VERSIONS.includes(version)) {
    throw new AppError(400, `Snapshot format version ${version} is not supported (supported: ${SUPPORTED_SNAPSHOT_VERSIONS.join(', ')})`);
  }
  let text: string;
  try {
    text = zlib.zstdDecompressSync(Buffer.from(snapshot.data, 'base64'), { maxOutputLength: MAX_TEXT_BYTES }).toString('utf8');
  } catch {
    throw new AppError(400, 'The snapshot data cannot be unpacked (damaged or cut off)');
  }
  return { version, text };
}

function permOf(kv: Record<string, string>): [string, SnapshotPermValue] | null {
  if (!kv.permid) return null;
  return [kv.permid, { value: Number(kv.permvalue ?? 0), negated: kv.permnegated === '1', skip: kv.permskip === '1' }];
}

/** Groups, channels and their permissions out of a snapshot's text; a 400 when its sections are not the known ones. */
export function parseSnapshotText(text: string, version = '3'): ParsedSnapshot {
  const missing = REQUIRED_MARKERS.filter((m) => !new RegExp(`(^|[ |])${m}([ |]|$)`).test(text));
  if (missing.length) throw new AppError(400, `The snapshot has an unknown layout (missing: ${missing.join(', ')})`);
  const out: ParsedSnapshot = { version, serverGroups: new Map(), channelGroups: new Map(), channels: new Map() };
  const channelPerms = new Map<number, Map<string, SnapshotPermValue>>();
  type Section = 'server' | 'channels' | 'clients' | 'serverGroups' | 'channelGroups' | 'relations' | 'clientFlat' | 'channelFlat' | 'channelClientFlat' | 'apikeys' | 'other';
  let section: Section = 'server';
  let group: SnapshotGroup | null = null;
  let flatId = 0;
  for (const record of text.split('|')) {
    const kv: Record<string, string> = {};
    for (const token of record.split(' ')) {
      if (!token) continue;
      const eq = token.indexOf('=');
      if (eq >= 0) { kv[token.slice(0, eq)] = tsUnescape(token.slice(eq + 1)); continue; }
      // A bare token: a section marker, or a field without value (empty) which changes nothing here.
      switch (token) {
        case 'begin_channels': section = 'channels'; break;
        case 'begin_clients': section = 'clients'; break;
        case 'server_groups': section = 'serverGroups'; group = null; break;
        case 'channel_groups': section = 'channelGroups'; group = null; break;
        case 'end_groups': section = 'relations'; group = null; break;
        case 'client_flat': section = 'clientFlat'; break;
        case 'channel_flat': section = 'channelFlat'; break;
        case 'channel_client_flat': section = 'channelClientFlat'; break;
        case 'begin_apikeys': section = 'apikeys'; break;
        case 'end_channels': case 'end_clients': case 'end_relations': case 'end_flat': case 'end_permissions': case 'end_apikeys': section = 'other'; break;
      }
    }
    if (section === 'channels' && kv.channel_id !== undefined) {
      const fields: Record<string, string> = {};
      for (const f of CHANNEL_FIELDS) fields[f] = kv[f] ?? '';
      out.channels.set(Number(kv.channel_id), { id: Number(kv.channel_id), pid: Number(kv.channel_pid ?? 0), order: Number(kv.channel_order ?? 0), fields, perms: new Map() });
    } else if (section === 'serverGroups' || section === 'channelGroups') {
      if (kv.id !== undefined) {
        group = { id: Number(kv.id), name: kv.name ?? '', perms: new Map() };
        (section === 'serverGroups' ? out.serverGroups : out.channelGroups).set(group.id, group);
      }
      const perm = permOf(kv);
      if (perm && group) group.perms.set(perm[0], perm[1]);
    } else if (section === 'channelFlat') {
      if (kv.id1 !== undefined) flatId = Number(kv.id1);
      const perm = permOf(kv);
      if (perm) {
        if (!channelPerms.has(flatId)) channelPerms.set(flatId, new Map());
        channelPerms.get(flatId)!.set(perm[0], perm[1]);
      }
    }
  }
  // TeamSpeak keeps permissions of channels that are gone; only those of listed channels count.
  for (const [cid, perms] of channelPerms) {
    const channel = out.channels.get(cid);
    if (channel) channel.perms = perms;
  }
  return out;
}

export function readSnapshot(snapshot: { version?: unknown; data?: unknown; salt?: unknown }): ParsedSnapshot {
  const { version, text } = decodeSnapshot(snapshot);
  return parseSnapshotText(text, version);
}

function samePerm(a: SnapshotPermValue, b: SnapshotPermValue): boolean {
  return a.value === b.value && a.negated === b.negated && a.skip === b.skip;
}

function permChanges(before: Map<string, SnapshotPermValue>, after: Map<string, SnapshotPermValue>): SnapshotPermChange[] {
  const out: SnapshotPermChange[] = [];
  for (const perm of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(perm) ?? null;
    const a = after.get(perm) ?? null;
    if (b && a && samePerm(a, b)) continue;
    out.push({ perm, before: b, after: a });
  }
  return out.sort((x, y) => x.perm.localeCompare(y.perm));
}

/** "Name (#id)" of a channel, "" for the top level, "#id" when that channel is not on this side. */
function channelLabel(channels: Map<number, SnapshotChannel>, id: number): string {
  if (!id) return '';
  const c = channels.get(id);
  return c ? `${c.fields.channel_name} (#${id})` : `#${id}`;
}

/** Parent and position (the channel it sorts below) as ids, so renaming a neighbour changes nothing here; shown as names. */
function channelFields(c: SnapshotChannel): Record<string, string> {
  return { parent: String(c.pid), below: String(c.order), ...c.fields };
}

function emptyCounts(): SnapshotCompareCounts {
  return { added: 0, removed: 0, changed: 0, unchanged: 0 };
}

/**
 * What differs between `before` (the snapshot) and `after` (the live server), matched by id:
 * a group deleted and made again under the same name is one removed and one added object.
 * Sorted by kind, then id, so the same two snapshots always give the same list.
 */
export function compareSnapshots(before: ParsedSnapshot, after: ParsedSnapshot): SnapshotCompareResult {
  const objects: SnapshotObjectDiff[] = [];
  const counts: Record<SnapshotObjectKind, SnapshotCompareCounts> = { serverGroup: emptyCounts(), channelGroup: emptyCounts(), channel: emptyCounts() };

  const compare = <T>(kind: SnapshotObjectKind, b: Map<number, T>, a: Map<number, T>, name: (o: T) => string, fields: (o: T) => Record<string, string>, perms: (o: T) => Map<string, SnapshotPermValue>) => {
    for (const id of [...new Set([...b.keys(), ...a.keys()])].sort((x, y) => x - y)) {
      const ob = b.get(id);
      const oa = a.get(id);
      const fb = ob ? fields(ob) : {};
      const fa = oa ? fields(oa) : {};
      const fieldChanges: SnapshotFieldChange[] = [];
      for (const field of new Set([...Object.keys(fb), ...Object.keys(fa)])) {
        const vb = ob ? fb[field] ?? '' : null;
        const va = oa ? fa[field] ?? '' : null;
        // A new or removed object lists only the fields that carry something.
        if (vb === va || (!ob && va === '') || (!oa && vb === '') || ((!ob || !oa) && (vb ?? va) === '0' && (field === 'parent' || field === 'below'))) continue;
        const shown = (v: string | null, side: ParsedSnapshot) => (v !== null && kind === 'channel' && (field === 'parent' || field === 'below') ? channelLabel(side.channels, Number(v)) : v);
        fieldChanges.push({ field, before: shown(vb, before), after: shown(va, after) });
      }
      const permDiff = permChanges(ob ? perms(ob) : new Map(), oa ? perms(oa) : new Map());
      const status = !ob ? 'added' : !oa ? 'removed' : fieldChanges.length || permDiff.length ? 'changed' : null;
      if (!status) { counts[kind].unchanged++; continue; }
      counts[kind][status]++;
      objects.push({ kind, id, name: name((oa ?? ob)!), status, fields: fieldChanges, perms: permDiff });
    }
  };

  const groupFields = (g: SnapshotGroup) => ({ name: g.name });
  compare('serverGroup', before.serverGroups, after.serverGroups, (g) => g.name, groupFields, (g) => g.perms);
  compare('channelGroup', before.channelGroups, after.channelGroups, (g) => g.name, groupFields, (g) => g.perms);
  compare('channel', before.channels, after.channels, (c) => c.fields.channel_name, channelFields, (c) => c.perms);

  return { formatVersion: after.version, objects, counts };
}
