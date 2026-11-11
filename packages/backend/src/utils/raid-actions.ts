import type { PrismaClient } from '../generated/prisma/client.js';
import { banRuleValue, renderSupportText, RAID_LIMITS, TEMP_GROUP_OPEN_STATES, type RaidAction, type RaidClient, type RaidOutcomeState, type RaidSettings } from '@ts6/common';
import type { WebQueryClient } from '../ts-client/webquery-client.js';
import { TSApiError } from '../middleware/error-handler.js';
import { parseGroupList } from './raid-detect.js';

// Raid protection (R15) stage 3: carries out one client's action in TeamSpeak. The service decides who and
// when (ladder, per-minute limit, emergency stop); this file only talks to the server.

/** A voice client as `clientlist -uid -groups` shows it. */
export interface OnlineClient {
  clid: number;
  uid: string;
  cldbid: number;
  groups: number[];
}

export function parseOnline(rows: Array<Record<string, unknown>>): OnlineClient[] {
  return rows
    .filter((r) => String(r.client_type) === '0' && r.client_unique_identifier)
    .map((r) => ({ clid: Number(r.clid), uid: String(r.client_unique_identifier), cldbid: Number(r.client_database_id), groups: parseGroupList(String(r.client_servergroups ?? '')) }));
}

export interface ActionContext {
  prisma: PrismaClient;
  client: WebQueryClient;
  via: 'bot' | 'main';
  configId: number;
  sid: number;
  settings: RaidSettings;
  serverName: string;
  /** Exempt by now (configured, protected, supporter groups): checked again right before acting. */
  exemptGroups: Set<number>;
  online: OnlineClient[];
}

export interface ActionResult {
  state: Extract<RaidOutcomeState, 'done' | 'failed' | 'gone' | 'skipped'>;
  note: string | null;
  /** TeamSpeak refused for lack of power (2568): shown as the server's error state. */
  noPower?: boolean;
}

/** The note for a refusal: the missing permission when TeamSpeak names it. */
function refusal(err: unknown): ActionResult {
  if (err instanceof TSApiError) {
    if (err.code === 2568) return { state: 'failed', note: `2568 insufficient permissions${err.failedPermission ? `: ${err.failedPermission}` : ''}`, noPower: true };
    return { state: 'failed', note: `${err.code} ${err.message}` };
  }
  return { state: 'failed', note: err instanceof Error ? err.message : String(err) };
}

export async function carryOut(ctx: ActionContext, c: RaidClient, action: RaidAction): Promise<ActionResult> {
  const { client, sid, settings: s } = ctx;
  const here = ctx.online.filter((o) => o.uid === c.uid);
  // Someone gave the client an exempt group meanwhile (a supporter vouched for them): leave it alone.
  if (here.some((o) => o.groups.some((g) => ctx.exemptGroups.has(g)))) return { state: 'skipped', note: 'exempt by now' };
  const fill = (text: string, max: number) => renderSupportText(text, { server: ctx.serverName }, max);
  try {
    switch (action) {
      case 'warn':
        if (!here.length) return { state: 'gone', note: null };
        for (const o of here) await client.execute(sid, 'sendtextmessage', { targetmode: 1, target: o.clid, msg: fill(s.warnText, RAID_LIMITS.warnTextMax) });
        return { state: 'done', note: null };
      case 'kick':
        if (!here.length) return { state: 'gone', note: null };
        for (const o of here) await client.execute(sid, 'clientkick', { reasonid: 5, reasonmsg: fill(s.kickReason, RAID_LIMITS.kickReasonMax), clid: o.clid });
        return { state: 'done', note: null };
      case 'ban': {
        // His decision 8: the identity, for a short time; the address only when the admin chose it.
        const base = { time: s.banMinutes * 60, banreason: fill(s.banReason, RAID_LIMITS.banReasonMax) || undefined, lastnickname: c.nickname.slice(0, 100) || undefined };
        await client.executePost(sid, 'banadd', { uid: c.uid, ...base });
        if (s.banIp && c.ip) await client.executePost(sid, 'banadd', { ip: banRuleValue('ip', { uid: '', nickname: '', lastIp: c.ip }), ...base });
        return { state: 'done', note: s.banIp && c.ip ? 'identity and address' : null };
      }
      case 'restrict':
        return await restrict(ctx, c, here[0]);
      default:
        return { state: 'skipped', note: null };
    }
  } catch (err) {
    // 512 (client gone) between the list and the command.
    if (err instanceof TSApiError && err.code === 512) return { state: 'gone', note: null };
    return refusal(err);
  }
}

/** The restricting group until restrictMinutes have passed, as a temporary membership (R13 takes it away again). */
async function restrict(ctx: ActionContext, c: RaidClient, online: OnlineClient | undefined): Promise<ActionResult> {
  const { prisma, client, configId, sid, settings: s } = ctx;
  const sgid = s.restrictGroupId!;
  const cldbid = online?.cldbid ?? c.cldbid;
  if (!cldbid) return { state: 'skipped', note: 'no database id' };
  if (await prisma.temporaryServerGroup.findFirst({ where: { serverConfigId: configId, sid, sgid, cldbid, state: { in: [...TEMP_GROUP_OPEN_STATES] } } })) {
    return { state: 'skipped', note: 'already restricted' };
  }
  const groups = online ? online.groups : (await client.execute(sid, 'servergroupsbyclientid', { cldbid }) as Array<{ sgid: string }>).map((g) => Number(g.sgid));
  if (groups.includes(sgid)) return { state: 'skipped', note: 'already a member of the group' };
  const expiresAt = new Date(Date.now() + s.restrictMinutes * 60_000);
  // The row first (as in R13): a crash right after it leaves a removal that finds nothing, never a group nobody takes away.
  const row = await prisma.temporaryServerGroup.create({
    data: {
      serverConfigId: configId, sid, sgid, cldbid, clientUid: c.uid, clientNickname: c.nickname,
      expiresAt, nextAttemptAt: expiresAt, grantedByUserId: null, grantedBy: 'Raid protection', via: ctx.via, wasMember: false,
    },
  });
  try {
    await client.execute(sid, 'servergroupaddclient', { sgid, cldbid });
  } catch (err) {
    await prisma.temporaryServerGroup.delete({ where: { id: row.id } });
    if (err instanceof TSApiError && err.code === 2561) return { state: 'skipped', note: 'already a member of the group' };
    throw err;
  }
  return { state: 'done', note: null };
}
