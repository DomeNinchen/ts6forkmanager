import type { PrismaClient, TemporaryServerGroup } from '../generated/prisma/client.js';
import {
  TEMP_GROUP_EXPIRED_NOTICE_WAIT_MS,
  TEMP_GROUP_NOTICE_DEFAULTS,
  TEMP_GROUP_POKE_MAX,
  TEMP_GROUP_SUBJECT_MAX,
  TEMP_GROUP_TEXT_MAX,
  clipNotice,
  dueWarning,
  renderNoticeText,
  type TempGroupNoticeChannel,
  type TempGroupNoticeKind,
  type TempGroupNoticeRecord,
  type TempGroupNoticeSettings,
} from '@ts6/common';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { WebQueryClient } from '../ts-client/webquery-client.js';

// Notices to clients about their temporary memberships (R13 stage 3): warnings before the expiry and a
// note when the group was taken away. Measured on TeamSpeak 6: a query login reaches an online client by
// private message (sendtextmessage targetmode=1) or poke (max 100 characters), and an offline one only by
// offline message (messageadd, body max 4096) - which TeamSpeak does NOT announce when the client connects
// again. So an offline client gets the offline message at once and the private message/poke as soon as it
// is online again (the entry keeps it as pendingNotice).

// ---- settings ---------------------------------------------------------------

export async function getNoticeSettings(prisma: PrismaClient, serverConfigId: number, sid: number): Promise<TempGroupNoticeSettings> {
  const row = await prisma.temporaryGroupNoticeSettings.findUnique({ where: { serverConfigId_sid: { serverConfigId, sid } } });
  if (!row) return { ...TEMP_GROUP_NOTICE_DEFAULTS };
  try {
    return { ...TEMP_GROUP_NOTICE_DEFAULTS, ...JSON.parse(row.settings) };
  } catch {
    return { ...TEMP_GROUP_NOTICE_DEFAULTS };
  }
}

export async function setNoticeSettings(prisma: PrismaClient, serverConfigId: number, sid: number, settings: TempGroupNoticeSettings): Promise<void> {
  const value = JSON.stringify(settings);
  await prisma.temporaryGroupNoticeSettings.upsert({
    where: { serverConfigId_sid: { serverConfigId, sid } },
    create: { serverConfigId, sid, settings: value },
    update: { settings: value },
  });
}

/** Whether these settings send anything at all for this kind of notice. */
export function noticeWanted(s: TempGroupNoticeSettings, kind: TempGroupNoticeKind): boolean {
  if (!s.enabled || !(s.privateMessage || s.offlineMessage || s.poke)) return false;
  return kind === 'expired' ? s.notifyExpired : s.warnBeforeMs.length > 0;
}

// ---- delivery ---------------------------------------------------------------

export interface NoticeTarget {
  client: WebQueryClient;
  sid: number;
  /** clid of the client when it is online right now. */
  clid: number | undefined;
  uid: string;
  text: string;
}

/**
 * Sends one notice the ways the settings allow. `onlyOnlineWays`: the offline message already went out
 * earlier; now only the private message/poke for a client that has come online.
 */
export async function deliverNotice(t: NoticeTarget, s: TempGroupNoticeSettings, onlyOnlineWays: boolean): Promise<{ sent: TempGroupNoticeChannel[]; waitingForOnline: boolean; error?: string }> {
  const sent: TempGroupNoticeChannel[] = [];
  const errors: string[] = [];
  const attempt = async (channel: TempGroupNoticeChannel, run: () => Promise<unknown>) => {
    try {
      await run();
      sent.push(channel);
    } catch (err: any) {
      errors.push(`${channel}: ${err?.code ? `${err.code} ` : ''}${err?.message ?? err}`);
    }
  };
  if (t.clid !== undefined) {
    if (s.privateMessage) await attempt('message', () => t.client.execute(t.sid, 'sendtextmessage', { targetmode: 1, target: t.clid, msg: clipNotice(t.text, TEMP_GROUP_TEXT_MAX) }));
    if (s.poke) await attempt('poke', () => t.client.execute(t.sid, 'clientpoke', { clid: t.clid, msg: clipNotice(t.text, TEMP_GROUP_POKE_MAX) }));
    return { sent, waitingForOnline: false, ...(errors.length ? { error: errors.join('; ') } : {}) };
  }
  if (s.offlineMessage && !onlyOnlineWays) {
    await attempt('offline', () => t.client.execute(t.sid, 'messageadd', { cluid: t.uid, subject: clipNotice(t.text, TEMP_GROUP_SUBJECT_MAX), message: t.text }));
  }
  return { sent, waitingForOnline: s.privateMessage || s.poke, ...(errors.length ? { error: errors.join('; ') } : {}) };
}

// ---- the pass ---------------------------------------------------------------

const NOTICES_PER_PASS = 50;

/** What one pass needs per connection and virtual server: who is online, the group names, the settings. */
interface ServerView {
  settings: TempGroupNoticeSettings;
  online: Map<string, number>;
  groupNames: Map<number, string>;
}

export function parseNoticeRecord(json: string | null): TempGroupNoticeRecord | null {
  if (!json) return null;
  try { return JSON.parse(json) as TempGroupNoticeRecord; } catch { return null; }
}

/**
 * Decides what each entry should hear now: a warning that has come due (it becomes pendingNotice), or a
 * pending notice that is still worth sending. Pure, so the rules are testable without a server.
 */
export function noticeToSend(
  row: Pick<TemporaryServerGroup, 'state' | 'expiresAt' | 'deadlineSetAt' | 'warnedBeforeMin' | 'pendingNotice' | 'endedAt' | 'lastNotice'>,
  s: TempGroupNoticeSettings,
  now: number,
): { kind: TempGroupNoticeKind; beforeMs?: number; onlyOnlineWays: boolean } | { drop: true } | null {
  const last = parseNoticeRecord(row.lastNotice);
  if (row.pendingNotice === 'warning') {
    // A warning for a deadline that has passed (or ended otherwise) says nothing useful any more.
    if (row.state !== 'active' || now >= row.expiresAt.getTime()) return { drop: true };
    return { kind: 'warning', beforeMs: last?.beforeMs, onlyOnlineWays: !!(last?.kind === 'warning' && last.waitingForOnline) };
  }
  if (row.pendingNotice === 'expired') {
    if (!row.endedAt || now - row.endedAt.getTime() > TEMP_GROUP_EXPIRED_NOTICE_WAIT_MS) return { drop: true };
    return { kind: 'expired', onlyOnlineWays: !!(last?.kind === 'expired' && last.waitingForOnline) };
  }
  if (row.state === 'active' && noticeWanted(s, 'warning')) {
    const before = dueWarning(
      s.warnBeforeMs, row.expiresAt.getTime(), row.deadlineSetAt.getTime(),
      row.warnedBeforeMin === null ? null : row.warnedBeforeMin * 60_000, now,
    );
    if (before !== null) return { kind: 'warning', beforeMs: before, onlyOnlineWays: false };
  }
  return null;
}

/**
 * One pass over the notices: new warnings, the expiry notices the removal job queued, and notices
 * waiting for a client to come online. Runs after the removals, from the same job.
 */
export async function processTempGroupNotices(prisma: PrismaClient, pool: ConnectionPool, now = new Date()): Promise<number> {
  const rows = await prisma.temporaryServerGroup.findMany({
    where: {
      OR: [
        { pendingNotice: { not: null } },
        // Warnings: active entries that end within the longest possible warning time.
        { state: 'active', expiresAt: { gt: now, lte: new Date(now.getTime() + 365 * 86_400_000) } },
      ],
    },
    orderBy: { expiresAt: 'asc' },
  });
  const views = new Map<string, ServerView | null>();
  let sentCount = 0;
  for (const row of rows) {
    if (sentCount >= NOTICES_PER_PASS) break;
    const key = `${row.serverConfigId}:${row.sid}:${row.via}`;
    const settingsKey = `${row.serverConfigId}:${row.sid}`;
    let view = views.get(key);
    const settings = view?.settings ?? await getNoticeSettings(prisma, row.serverConfigId, row.sid);
    const decision = noticeToSend(row, settings, now.getTime());
    if (!decision) continue;
    if ('drop' in decision) {
      await prisma.temporaryServerGroup.update({ where: { id: row.id }, data: { pendingNotice: null } });
      continue;
    }
    if (!noticeWanted(settings, decision.kind)) {
      // Switched off since it was queued.
      await prisma.temporaryServerGroup.update({ where: { id: row.id }, data: { pendingNotice: null } });
      continue;
    }
    const client = row.via === 'bot' ? pool.getBotClient(row.serverConfigId) : pool.tryGetClient(row.serverConfigId);
    if (!client) continue; // connection off: try again on a later pass
    if (view === undefined) {
      try {
        const [list, groups] = await Promise.all([
          client.execute(row.sid, 'clientlist', { '-uid': '' }) as Promise<Array<{ clid: string; client_unique_identifier: string; client_type: string }>>,
          client.execute(row.sid, 'servergrouplist') as Promise<Array<{ sgid: string; name: string }>>,
        ]);
        view = {
          settings,
          online: new Map(list.filter((c) => String(c.client_type) === '0').map((c) => [c.client_unique_identifier, Number(c.clid)])),
          groupNames: new Map(groups.map((g) => [Number(g.sgid), g.name])),
        };
      } catch (err: any) {
        console.warn(`[TempGroups] Notices for ${settingsKey} skipped this pass: ${err.message}`);
        view = null;
      }
      views.set(key, view);
    }
    if (!view) continue;
    const clid = view.online.get(row.clientUid);
    // Waiting for the client: nothing to do until it shows up.
    if (decision.onlyOnlineWays && clid === undefined) continue;
    const text = renderNoticeText(decision.kind === 'warning' ? settings.warningText : settings.expiredText, {
      client: row.clientNickname || `#${row.cldbid}`,
      group: view.groupNames.get(row.sgid) ?? `#${row.sgid}`,
      expiresAt: row.expiresAt.getTime(),
      now: now.getTime(),
      timeZone: settings.timeZone,
    });
    const result = await deliverNotice({ client, sid: row.sid, clid, uid: row.clientUid, text }, settings, decision.onlyOnlineWays);
    const record: TempGroupNoticeRecord = {
      kind: decision.kind,
      ...(decision.beforeMs !== undefined ? { beforeMs: decision.beforeMs } : {}),
      at: now.toISOString(),
      // A later private message adds to what the offline message already did.
      sent: decision.onlyOnlineWays ? [...new Set([...(parseNoticeRecord(row.lastNotice)?.sent ?? []), ...result.sent])] : result.sent,
      ...(result.waitingForOnline ? { waitingForOnline: true } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
    await prisma.temporaryServerGroup.update({
      where: { id: row.id },
      data: {
        lastNotice: JSON.stringify(record),
        pendingNotice: result.waitingForOnline ? decision.kind : null,
        ...(decision.kind === 'warning' && decision.beforeMs !== undefined ? { warnedBeforeMin: Math.round(decision.beforeMs / 60_000) } : {}),
      },
    });
    console.log(`[TempGroups] #${row.id} ${decision.kind} notice: ${record.sent.join('+') || 'nothing sent'}${record.waitingForOnline ? ', waiting for the client to come online' : ''}${record.error ? ` (${record.error})` : ''}`);
    sentCount++;
  }
  return sentCount;
}
