// What the manager keeps for one virtual server, after TeamSpeak deleted it. TeamSpeak never hands a
// deleted sid out again (measured on 6.0.0-beta13.1), so nothing here could attach to a new server:
// the settings go, flows stop instead of failing on every run, and history stays for its retention.
import type { PrismaClient } from '../generated/prisma/client.js';
import { TEMP_GROUP_OPEN_STATES, type VirtualServerCleanup, type VirtualServerDeleteResult } from '@ts6/common';
import type { BotEngine } from '../bot-engine/engine.js';
import type { RaidProtectionService } from './raid-protection.js';
import { resetQueueState } from './support-queue.js';
import { readBackupSnapshot } from './backups.js';
import { readSnapshot } from './ts-snapshot.js';

/**
 * The change-log entry's part from the handler: the backup, what its snapshot held (channels and
 * groups; read from the backup, since a stopped server answers no channellist) and the clean-up.
 */
export function changeLogResultOf(result: VirtualServerDeleteResult, configId: number, sid: number): Record<string, unknown> {
  const out: Record<string, unknown> = { backup: result.backup ?? 'skipped' };
  if (result.backup) {
    try {
      const snap = readSnapshot(readBackupSnapshot('before-bulk', result.backup, configId, sid));
      Object.assign(out, { channels: snap.channels.size, server_groups: snap.serverGroups.size, channel_groups: snap.channelGroups.size });
    } catch { /* the counts are a nicety; the entry stands without them */ }
  }
  const c = result.cleanup;
  if (!c) return { ...out, cleanup_error: result.cleanupError };
  return {
    ...out,
    removed_access_grants: c.accessGrants,
    removed_protected_groups: c.protectedGroups,
    ended_temporary_groups: c.temporaryGroups,
    disabled_support_queues: c.supportQueues,
    removed_raid_protection: c.raidProtection ? 'yes' : 'no',
    disabled_flows: c.flowsDisabled.map((f) => f.name).join(', '),
    widgets_left: c.widgets.map((w) => w.name).join(', '),
  };
}

export interface CleanupDeps {
  prisma: PrismaClient;
  botEngine?: Pick<BotEngine, 'disableFlow'>;
  raid?: Pick<RaidProtectionService, 'reload'>;
}

export async function cleanUpDeletedVirtualServer({ prisma, botEngine, raid }: CleanupDeps, configId: number, sid: number, now = new Date()): Promise<VirtualServerCleanup> {
  const vs = { serverConfigId: configId, sid };
  const flows = await prisma.botFlow.findMany({ where: { serverConfigId: configId, virtualServerId: sid, enabled: true }, select: { id: true, name: true } });
  const queues = await prisma.supportQueue.findMany({ where: { ...vs, enabled: true }, select: { id: true } });

  const [access, protectedGroups, temporaryGroups, , supportQueues, raidProtection] = await prisma.$transaction([
    prisma.userVirtualServerAccess.deleteMany({ where: { sid, access: { serverConfigId: configId } } }),
    prisma.protectedServerGroup.deleteMany({ where: vs }),
    // The group went with the server: an open deadline ends here, the row stays as history.
    prisma.temporaryServerGroup.updateMany({
      where: { ...vs, state: { in: [...TEMP_GROUP_OPEN_STATES] } },
      data: { state: 'already-removed', error: 'The virtual server was deleted', nextAttemptAt: null, endedAt: now },
    }),
    prisma.temporaryGroupNoticeSettings.deleteMany({ where: vs }),
    // Switched off, not deleted: deleting a queue would take its cases (history) with it.
    prisma.supportQueue.updateMany({ where: { ...vs, enabled: true }, data: { enabled: false } }),
    prisma.raidProtection.deleteMany({ where: vs }),
    prisma.botFlow.updateMany({ where: { id: { in: flows.map((f) => f.id) } }, data: { enabled: false } }),
  ]);

  for (const q of queues) resetQueueState(q.id);
  for (const f of flows) await botEngine?.disableFlow(f.id);
  // Without its row the service drops the server and closes an open incident.
  if (raidProtection.count > 0) await raid?.reload(configId, sid);

  const widgets = await prisma.widget.findMany({ where: { serverConfigId: configId, virtualServerId: sid }, select: { id: true, name: true } });
  return {
    accessGrants: access.count,
    protectedGroups: protectedGroups.count,
    temporaryGroups: temporaryGroups.count,
    supportQueues: supportQueues.count,
    raidProtection: raidProtection.count > 0,
    flowsDisabled: flows,
    widgets,
  };
}
