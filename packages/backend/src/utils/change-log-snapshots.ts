// Before and after for the most important targets (R6 stage 2). A rule per route reads the
// target once, before the change runs; after a successful change the diff is worked out from
// what was read and what was sent (the agreed design: no second read, so one TeamSpeak query per
// change and no more). A read that fails or takes too long never holds the change back - the row
// then says the state before was unavailable.

import type { BulkOutcome, UiChangeDiff, UiChangeField, UiChangeMethod } from '@ts6/common';
import { UI_CHANGE_SECRET_PLACEHOLDER } from '@ts6/common';
import type { WebQueryClient } from '../ts-client/webquery-client.js';
import { ALLOWED_INSTANCE_PARAMS } from '../routes/instance.routes.js';
import { ALLOWED_SERVER_EDIT_PARAMS } from '../routes/virtual-servers.routes.js';
import { isSecretField } from './change-log.js';

/** Longer than this and the change goes ahead without its state before. */
export const SNAPSHOT_TIMEOUT_MS = 3000;
/** A delete-all keeps the count and this many of the deleted targets. */
export const DELETED_LIST_MAX = 100;
/** One value longer than this keeps only its length (a welcome message, a banner URL list, ...). */
const VALUE_MAX_LENGTH = 512;
/** The whole diff, as JSON. */
const DIFF_MAX_LENGTH = 16000;

export interface SnapshotContext {
  client: WebQueryClient;
  /** The virtual server of the route (0 on the instance). */
  sid: number;
  /** The path segments below the area, decoded (a privilege key arrives URL-encoded). */
  leaf: string[];
  body: Record<string, unknown>;
}

interface SnapshotRule {
  method: UiChangeMethod;
  /** The change log's own route pattern (change-log-policy.ts). */
  pattern: string;
  read(ctx: SnapshotContext): Promise<unknown>;
  diff(before: unknown, ctx: SnapshotContext): UiChangeDiff;
}

type Row = Record<string, unknown>;

const rows = (answer: unknown): Row[] => (Array.isArray(answer) ? answer : answer ? [answer as Row] : []);
const text = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));
const short = (v: string | null): string | null =>
  v !== null && v.length > VALUE_MAX_LENGTH ? `(omitted, ${v.length} chars)` : v;

/** A target as it was, for a delete: every field as text, secrets left out. */
function asDeleted(row: Row | undefined): Record<string, string> | undefined {
  if (!row) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (isSecretField(k) || v === null || v === undefined || v === '') continue;
    out[k] = short(String(v)) as string;
  }
  return out;
}

/**
 * The sent fields that differ from the target as read. A secret field cannot be compared (the
 * server does not hand it back) - it is listed as changed when a value was sent.
 */
function changedFields(before: Row | undefined, sent: Record<string, unknown>, keep: (key: string) => boolean = () => true): UiChangeField[] {
  const fields: UiChangeField[] = [];
  for (const [key, value] of Object.entries(sent)) {
    if (!keep(key) || value === undefined) continue;
    if (isSecretField(key)) {
      if (value !== '' && value !== null) fields.push({ field: key, before: UI_CHANGE_SECRET_PLACEHOLDER, after: UI_CHANGE_SECRET_PLACEHOLDER });
      continue;
    }
    const was = text(before?.[key]);
    const now = text(value);
    if (was !== now) fields.push({ field: key, before: short(was), after: short(now) });
  }
  return fields;
}

// --- permissions -------------------------------------------------------------------

/** "75", "75 · negated", "1 · skip" - one permission's value as TeamSpeak keeps it. */
function permValue(value: unknown, negated: unknown, skip: unknown): string {
  const flags = [String(negated) === '1' ? 'negated' : null, String(skip) === '1' ? 'skip' : null].filter(Boolean);
  return [String(value), ...flags].join(' · ');
}

const permsidsOf = (body: Record<string, unknown>): string[] =>
  (Array.isArray(body.permsid) ? body.permsid : body.permsid !== undefined ? [body.permsid] : []).map(String);

function permissionRules(pattern: string, list: (ctx: SnapshotContext) => Promise<unknown>): SnapshotRule[] {
  const diffFor = (adding: boolean) => (before: unknown, ctx: SnapshotContext): UiChangeDiff => {
    const permsids = permsidsOf(ctx.body);
    // The forms send the permission by name; one sent by number only cannot be matched to the list.
    if (permsids.length === 0) return { unavailable: 'permission given by number, not by name' };
    const had = new Map(rows(before).map((r) => [String(r.permsid), r]));
    const pick = (field: string, i: number) => {
      const v = ctx.body[field];
      return Array.isArray(v) ? v[i] : v;
    };
    const fields = permsids.map((permsid, i): UiChangeField => {
      const r = had.get(permsid);
      return {
        field: permsid,
        before: r ? permValue(r.permvalue, r.permnegated, r.permskip) : null,
        after: adding ? permValue(pick('permvalue', i), pick('permnegated', i) ?? 0, pick('permskip', i) ?? 0) : null,
      };
    }).filter((f) => f.before !== f.after);
    return { fields };
  };
  return [
    { method: 'PUT', pattern, read: list, diff: diffFor(true) },
    { method: 'DELETE', pattern, read: list, diff: diffFor(false) },
  ];
}

// --- the rules ----------------------------------------------------------------------

const VS = '/servers/:configId/vs/:sid';
const id = (ctx: SnapshotContext, i = 0) => ctx.leaf.filter((s) => /^\d+$/.test(s))[i];

const channelInfo = (ctx: SnapshotContext) => ctx.client.execute(ctx.sid, 'channelinfo', { cid: id(ctx) });
const serverGroup = async (ctx: SnapshotContext) => rows(await ctx.client.execute(ctx.sid, 'servergrouplist')).find((g) => String(g.sgid) === id(ctx));
const channelGroup = async (ctx: SnapshotContext) => rows(await ctx.client.execute(ctx.sid, 'channelgrouplist')).find((g) => String(g.cgid) === id(ctx));
const renameDiff = (before: unknown, ctx: SnapshotContext): UiChangeDiff => ({ fields: changedFields(before as Row | undefined, { name: ctx.body.name }) });

export const SNAPSHOT_RULES: readonly SnapshotRule[] = [
  // Channels
  { method: 'PUT', pattern: `${VS}/channels/:id`, read: channelInfo, diff: (b, ctx) => ({ fields: changedFields(rows(b)[0], ctx.body) }) },
  { method: 'DELETE', pattern: `${VS}/channels/:id`, read: channelInfo, diff: (b) => ({ deleted: asDeleted(rows(b)[0]) }) },
  {
    method: 'POST', pattern: `${VS}/channels/:id/move`, read: channelInfo,
    // channelmove takes cpid/order; channelinfo calls the same things pid/channel_order.
    diff: (b, ctx) => {
      const r = rows(b)[0];
      return { fields: changedFields({ cpid: r?.pid, order: r?.channel_order }, { cpid: ctx.body.cpid, order: ctx.body.order }) };
    },
  },
  // Server and channel groups
  { method: 'PUT', pattern: `${VS}/server-groups/:id`, read: serverGroup, diff: renameDiff },
  { method: 'DELETE', pattern: `${VS}/server-groups/:id`, read: serverGroup, diff: (b) => ({ deleted: asDeleted(b as Row | undefined) }) },
  { method: 'PUT', pattern: `${VS}/channel-groups/:id`, read: channelGroup, diff: renameDiff },
  { method: 'DELETE', pattern: `${VS}/channel-groups/:id`, read: channelGroup, diff: (b) => ({ deleted: asDeleted(b as Row | undefined) }) },
  // Permissions: only the ones the change names
  ...permissionRules(`${VS}/server-groups/:id/permissions`, (ctx) => ctx.client.execute(ctx.sid, 'servergrouppermlist', { sgid: id(ctx), '-permsid': '' })),
  ...permissionRules(`${VS}/channel-groups/:id/permissions`, (ctx) => ctx.client.execute(ctx.sid, 'channelgrouppermlist', { cgid: id(ctx), '-permsid': '' })),
  ...permissionRules(`${VS}/channels/:id/permissions`, (ctx) => ctx.client.execute(ctx.sid, 'channelpermlist', { cid: id(ctx), '-permsid': '' })),
  ...permissionRules(`${VS}/channels/:id/clients/:id/permissions`, (ctx) => ctx.client.execute(ctx.sid, 'channelclientpermlist', { cid: id(ctx), cldbid: id(ctx, 1), '-permsid': '' })),
  ...permissionRules(`${VS}/clients/:id/permissions`, (ctx) => ctx.client.execute(ctx.sid, 'clientpermlist', { cldbid: id(ctx), '-permsid': '' })),
  // Virtual server and instance settings: only the fields the handler really passes on
  {
    method: 'PUT', pattern: '/servers/:configId/virtual-servers/:id',
    read: (ctx) => ctx.client.execute(Number(id(ctx)), 'serverinfo'),
    diff: (b, ctx) => ({ fields: changedFields(rows(b)[0], ctx.body, (k) => ALLOWED_SERVER_EDIT_PARAMS.has(k)) }),
  },
  {
    method: 'PUT', pattern: '/servers/:configId/instance',
    read: (ctx) => ctx.client.execute(0, 'instanceinfo'),
    diff: (b, ctx) => ({ fields: changedFields(rows(b)[0], ctx.body, (k) => ALLOWED_INSTANCE_PARAMS.has(k) && ctx.body[k] !== null) }),
  },
  // Bans
  {
    method: 'DELETE', pattern: `${VS}/bans/:id`,
    read: async (ctx) => rows(await ctx.client.execute(ctx.sid, 'banlist')).find((b) => String(b.banid) === id(ctx)),
    diff: (b) => ({ deleted: asDeleted(b as Row | undefined) }),
  },
  {
    method: 'DELETE', pattern: `${VS}/bans`,
    read: (ctx) => ctx.client.execute(ctx.sid, 'banlist'),
    diff: (b) => {
      const all = rows(b);
      return { deletedList: { count: all.length, items: all.slice(0, DELETED_LIST_MAX).map((r) => asDeleted(r) ?? {}) } };
    },
  },
  // Privilege keys and temporary passwords: found by the secret in the path, which itself is never kept
  {
    method: 'DELETE', pattern: `${VS}/tokens/:token`,
    read: async (ctx) => rows(await ctx.client.execute(ctx.sid, 'privilegekeylist')).find((k) => String(k.token) === ctx.leaf[0]),
    diff: (b) => ({ deleted: asDeleted(b as Row | undefined) }),
  },
  {
    method: 'DELETE', pattern: `${VS}/tokens/temp-passwords/:pw`,
    read: async (ctx) => rows(await ctx.client.execute(ctx.sid, 'servertemppasswordlist')).find((p) => String(p.pw_clear) === ctx.leaf[1]),
    diff: (b) => ({ deleted: asDeleted(b as Row | undefined) }),
  },
];

export function snapshotRuleFor(method: string, pattern: string): SnapshotRule | undefined {
  return SNAPSHOT_RULES.find((r) => r.method === method && r.pattern === pattern);
}

export type Snapshot = { ok: true; state: unknown } | { ok: false; reason: string };

/** Reads the target before the change, giving up after SNAPSHOT_TIMEOUT_MS. Never throws. */
export async function takeSnapshot(rule: SnapshotRule, ctx: SnapshotContext): Promise<Snapshot> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${SNAPSHOT_TIMEOUT_MS / 1000} s`)), SNAPSHOT_TIMEOUT_MS);
    });
    return { ok: true, state: await Promise.race([rule.read(ctx), timeout]) };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message ?? err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** The diff of a successful change as stored: JSON, held under the size cap by trimming the long lists first. */
export function diffJson(rule: SnapshotRule, snapshot: Snapshot, ctx: SnapshotContext): string {
  let diff: UiChangeDiff;
  try {
    diff = snapshot.ok ? rule.diff(snapshot.state, ctx) : { unavailable: snapshot.reason };
  } catch (err: any) {
    diff = { unavailable: `could not be worked out: ${String(err?.message ?? err).slice(0, 150)}` };
  }
  let json = JSON.stringify(diff);
  while (json.length > DIFF_MAX_LENGTH && diff.deletedList && diff.deletedList.items.length > 0) {
    diff.deletedList.items = diff.deletedList.items.slice(0, Math.floor(diff.deletedList.items.length / 2));
    json = JSON.stringify(diff);
  }
  while (json.length > DIFF_MAX_LENGTH && diff.fields && diff.fields.length > 0) {
    diff.fields = diff.fields.slice(0, Math.floor(diff.fields.length / 2));
    json = JSON.stringify(diff);
  }
  return json.length > DIFF_MAX_LENGTH ? JSON.stringify({ unavailable: 'too large to keep' }) : json;
}

/** A bulk action's outcomes as one entry (R9): the counts, and the first targets - the ones that did not go through first. */
export function bulkDiffJson(outcomes: BulkOutcome[]): string {
  const count = (s: BulkOutcome['status']) => outcomes.filter((o) => o.status === s).length;
  const notOk = outcomes.filter((o) => o.status !== 'ok');
  const bulk = {
    ok: count('ok'), skipped: count('skipped'), failed: count('failed'),
    items: [...notOk, ...outcomes.filter((o) => o.status === 'ok')].slice(0, DELETED_LIST_MAX),
  };
  let json = JSON.stringify({ bulk });
  while (json.length > DIFF_MAX_LENGTH && bulk.items.length > 0) {
    bulk.items = bulk.items.slice(0, Math.floor(bulk.items.length / 2));
    json = JSON.stringify({ bulk });
  }
  return json;
}
