import type { PrismaClient } from '../generated/prisma/client.js';
import { commaListsIntersect } from './group-match.js';

/**
 * Whether a client may run `command` on `serverConfigId`
 * (DomeNinchen/ts6forkmanager#184).
 *
 * A command with no BotCommandPermission row, or one with an empty
 * `allowedGroupIds`, defaults to "everyone can use it" - the default the
 * feature request asked for. BotCommandAdminGroup members bypass every
 * restriction.
 *
 * `getClientGroupsCsv` is only called (and so only pays for a WebQuery
 * round-trip to look up the caller's TeamSpeak server groups) once a
 * restriction is actually configured for this command - the common case,
 * an unrestricted command, is a single indexed DB lookup. It resolves to
 * `null` when the caller's groups couldn't be determined at all (e.g. the
 * bot has no WebQuery connection configured), in which case a *configured*
 * restriction is denied rather than silently ignored.
 */
export async function canRunCommand(
  prisma: PrismaClient,
  serverConfigId: number,
  command: string,
  getClientGroupsCsv: () => Promise<string | null>,
): Promise<boolean> {
  const perm = await prisma.botCommandPermission.findUnique({
    where: { serverConfigId_command: { serverConfigId, command } },
  });
  if (!perm || !perm.allowedGroupIds) return true;

  const clientGroupsCsv = await getClientGroupsCsv();
  if (clientGroupsCsv === null) return false;

  const adminGroups = await prisma.botCommandAdminGroup.findMany({ where: { serverConfigId } });
  if (adminGroups.length > 0) {
    const adminIdsCsv = adminGroups.map((g) => g.groupId).join(',');
    if (commaListsIntersect(clientGroupsCsv, adminIdsCsv)) return true;
  }

  return commaListsIntersect(clientGroupsCsv, perm.allowedGroupIds);
}
