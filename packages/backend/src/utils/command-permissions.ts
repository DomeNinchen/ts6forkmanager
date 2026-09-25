import type { PrismaClient } from '../generated/prisma/client.js';
import { OPEN_BY_DEFAULT_COMMANDS } from '@ts6/common';
import { commaListsIntersect } from './group-match.js';

/**
 * Whether a client may run `command` on `serverConfigId`
 * (DomeNinchen/ts6forkmanager#184).
 *
 * A command with no BotCommandPermission row, or one with an empty
 * `allowedGroupIds`, falls back to its built-in default: OPEN_BY_DEFAULT_COMMANDS
 * (!play, !stream, !np) stay usable by everyone, every other command is
 * unusable by anyone until an admin explicitly assigns a group. Either way,
 * BotCommandAdminGroup members bypass the restriction.
 *
 * `getClientGroupsCsv` is only called (and so only pays for a WebQuery
 * round-trip to look up the caller's TeamSpeak server groups) when it's
 * actually needed to decide - an open-by-default command with no
 * restriction configured is a single indexed DB lookup and nothing else.
 * It resolves to `null` when the caller's groups couldn't be determined at
 * all (e.g. the bot has no WebQuery connection configured), in which case
 * anything short of "open to everyone" is denied rather than silently
 * ignored.
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
  const configuredGroupIds = perm?.allowedGroupIds || '';

  if (!configuredGroupIds && OPEN_BY_DEFAULT_COMMANDS.has(command)) return true;

  const clientGroupsCsv = await getClientGroupsCsv();
  if (clientGroupsCsv === null) return false;

  const adminGroups = await prisma.botCommandAdminGroup.findMany({ where: { serverConfigId } });
  if (adminGroups.length > 0) {
    const adminIdsCsv = adminGroups.map((g) => g.groupId).join(',');
    if (commaListsIntersect(clientGroupsCsv, adminIdsCsv)) return true;
  }

  if (!configuredGroupIds) return false; // restricted by default, caller isn't an admin
  return commaListsIntersect(clientGroupsCsv, configuredGroupIds);
}
