import type { PrismaClient, SupportCase } from '../generated/prisma/client.js';
import {
  SUPPORT_ESTIMATE_SAMPLE,
  SUPPORT_POKE_MAX,
  SUPPORT_TEXT_MAX,
  renderSupportText,
  supportEstimateMin,
  type SupportPerson,
  type SupportQueueSettings,
} from '@ts6/common';
import type { WebQueryClient } from '../ts-client/webquery-client.js';
import type { ListedClient } from './support-queue.js';

// Messages of the support queue (R14 stage 3): a private message to the waiting client on entering
// (position, usual waiting time) and when taken, optionally the position again every N minutes; a poke
// to the available supporters for each new case and, optionally, once more when it waits too long.
// What went out is kept on the case, so a restart sends nothing twice.

/** Times in ms; stored as JSON in SupportCase.notices. */
export interface SupportNotices {
  enter?: number;
  /** Last message with the position (enter or repeat). */
  last?: number;
  taken?: number;
  poked?: boolean;
  reminded?: boolean;
}

export function parseNotices(json: string | null): SupportNotices {
  try {
    const v = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export type NoticeSend =
  | { to: 'client'; kind: 'enter' | 'repeat' | 'taken'; clid: number; text: string }
  | { to: 'supporters'; kind: 'poke' | 'remind'; clids: number[]; text: string };

export interface CaseForNotices {
  id: number;
  state: string;
  clientUid: string;
  nickname: string;
  arrivedAt: number;
  takenBy: SupportPerson[];
  /** 1-based among the waiting cases; null when taken. */
  position: number | null;
  notices: SupportNotices;
}

/** TeamSpeak commands a set of sends costs (a poke goes to each supporter on its own). */
export function sendCost(sends: NoticeSend[]): number {
  return sends.reduce((n, s) => n + (s.to === 'client' ? 1 : s.clids.length), 0);
}

/**
 * What one case should hear now, and its notices afterwards. Pure: the job does the sending.
 * `available`: the supporters who can take a case right now (not away, not in an AFK channel).
 * `estimateMin`: the usual waiting time, null while there are too few taken cases.
 */
export function noticesFor(
  k: CaseForNotices,
  s: SupportQueueSettings,
  ctx: { channelId: number; clients: ListedClient[]; available: ListedClient[]; waitingCount: number; estimateMin: number | null; now: number },
): { sends: NoticeSend[]; next: SupportNotices } {
  const { now } = ctx;
  const mine = ctx.clients.filter((c) => c.uid === k.clientUid);
  const client = mine.find((c) => c.cid === ctx.channelId) ?? mine[0];
  const n = { ...k.notices };
  const sends: NoticeSend[] = [];
  const supporterClids = ctx.available.map((c) => c.clid);
  const vars = {
    client: k.nickname,
    position: k.position ?? '',
    waiting: ctx.waitingCount,
    estimate: ctx.estimateMin === null || !s.estimateText ? '' : renderSupportText(s.estimateText, { minutes: ctx.estimateMin }, SUPPORT_TEXT_MAX),
    supporter: k.takenBy.map((p) => p.nickname).join(', '),
    waited: Math.floor((now - k.arrivedAt) / 60_000),
  };
  const positionText = () => renderSupportText(ctx.available.length ? s.enterText : s.noSupporterText, vars, SUPPORT_TEXT_MAX);

  if (k.state === 'waiting') {
    const inChannel = client && client.cid === ctx.channelId;
    if (n.enter === undefined) {
      // Marked even with messages off, so switching them on later does not greet everyone at once.
      if (inChannel) {
        if (s.clientMessages) sends.push({ to: 'client', kind: 'enter', clid: client.clid, text: positionText() });
        n.enter = now;
        n.last = now;
      }
    } else if (s.clientMessages && s.repeatMin > 0 && inChannel && now - (n.last ?? n.enter) >= s.repeatMin * 60_000) {
      sends.push({ to: 'client', kind: 'repeat', clid: client.clid, text: positionText() });
      n.last = now;
    }
    // Waits for a supporter to become available when there is none yet.
    if (!n.poked && supporterClids.length) {
      if (s.pokeSupporters) sends.push({ to: 'supporters', kind: 'poke', clids: supporterClids, text: renderSupportText(s.supporterPokeText, vars, SUPPORT_POKE_MAX) });
      n.poked = true;
    }
    if (s.remind && !n.reminded && supporterClids.length && now - k.arrivedAt >= s.remindAfterMin * 60_000) {
      sends.push({ to: 'supporters', kind: 'remind', clids: supporterClids, text: renderSupportText(s.remindText, vars, SUPPORT_POKE_MAX) });
      n.reminded = true;
    }
  } else if (k.state === 'in-progress' && n.taken === undefined && n.enter !== undefined && client) {
    // Only cases this stage greeted: a case from before the update gets no late "taken" message.
    if (s.clientMessages) sends.push({ to: 'client', kind: 'taken', clid: client.clid, text: renderSupportText(s.takenText, vars, SUPPORT_TEXT_MAX) });
    n.taken = now;
  }
  return { sends, next: n };
}

/** The usual waiting time of a queue from its last taken cases with a known arrival. */
export async function estimateFor(prisma: PrismaClient, queueId: number): Promise<number | null> {
  const rows = await prisma.supportCase.findMany({
    where: { queueId, takenAt: { not: null }, arrivalUnknown: false },
    orderBy: { takenAt: 'desc' },
    take: SUPPORT_ESTIMATE_SAMPLE,
    select: { arrivedAt: true, takenAt: true },
  });
  return supportEstimateMin(rows.map((r) => r.takenAt!.getTime() - r.arrivedAt.getTime()));
}

/** Sends one notice; a failure is logged and not retried (the client may have left in between). */
export async function deliver(client: WebQueryClient, sid: number, send: NoticeSend, caseId: number): Promise<void> {
  const targets = send.to === 'client' ? [send.clid] : send.clids;
  for (const clid of targets) {
    try {
      if (send.to === 'client') await client.execute(sid, 'sendtextmessage', { targetmode: 1, target: clid, msg: send.text });
      else await client.execute(sid, 'clientpoke', { clid, msg: send.text });    } catch (err: any) {
      console.warn(`[SupportQueue] Case #${caseId}: ${send.kind} to clid ${clid} failed: ${err?.code ? `${err.code} ` : ''}${err?.message ?? err}`);
    }
  }
}

/** The order of the line: VIPs before everyone else (stage 4), then by arrival, then id. */
export function byQueueOrder(a: Pick<SupportCase, 'vip' | 'arrivedAt' | 'id'>, b: Pick<SupportCase, 'vip' | 'arrivedAt' | 'id'>): number {
  return Number(b.vip) - Number(a.vip) || a.arrivedAt.getTime() - b.arrivedAt.getTime() || a.id - b.id;
}

/** Commands per pass and virtual server; what is left over goes out on the next pass (flood protection). */
export const NOTICES_PER_PASS = 10;

/**
 * The notice pass of one queue, right after its reconcile. Cases are handled in queue order; a case whose
 * sends do not fit the remaining budget waits for the next pass (nothing is marked as sent for it).
 */
export async function processQueueNotices(
  prisma: PrismaClient,
  client: WebQueryClient,
  q: { id: number; sid: number; channelId: number },
  settings: SupportQueueSettings,
  rows: SupportCase[],
  clients: ListedClient[],
  available: ListedClient[],
  budget: { left: number },
  now: number,
): Promise<void> {
  const waiting = rows.filter((r) => r.state === 'waiting').sort(byQueueOrder);
  const ordered = [...waiting, ...rows.filter((r) => r.state === 'in-progress').sort(byQueueOrder)];
  let estimate: number | null | undefined;
  for (const r of ordered) {
    const position = r.state === 'waiting' ? waiting.indexOf(r) + 1 : null;
    const notices = parseNotices(r.notices);
    // The estimate costs a query; only look it up for a case that is about to get a position message.
    if (estimate === undefined && r.state === 'waiting' && settings.clientMessages && (notices.enter === undefined || settings.repeatMin > 0)) {
      estimate = await estimateFor(prisma, q.id);
    }
    const { sends, next } = noticesFor(
      { id: r.id, state: r.state, clientUid: r.clientUid, nickname: r.nickname, arrivedAt: r.arrivedAt.getTime(), takenBy: parseTakenBy(r.takenBy), position, notices },
      settings,
      { channelId: q.channelId, clients, available, waitingCount: waiting.length, estimateMin: estimate ?? null, now },
    );
    if (JSON.stringify(next) === JSON.stringify(notices)) continue;
    const cost = sendCost(sends);
    if (cost > budget.left) return;
    budget.left -= cost;
    for (const send of sends) await deliver(client, q.sid, send, r.id);
    // Only while the case is still in the state it was read in; a change meanwhile is picked up next pass.
    await prisma.supportCase.updateMany({ where: { id: r.id, state: r.state }, data: { notices: JSON.stringify(next) } });
  }
}

function parseTakenBy(json: string | null): SupportPerson[] {
  try {
    const v = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
