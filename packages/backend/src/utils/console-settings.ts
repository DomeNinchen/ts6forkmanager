import type { ConsoleSettings } from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';

const KEY_RETENTION_DAYS = 'console_audit_retention_days';
const KEY_FLOOD_GUARD = 'console_flood_guard';

export const DEFAULT_CONSOLE_SETTINGS: ConsoleSettings = {
  auditRetentionDays: 90,
  floodGuardEnabled: true,
};

export const MIN_AUDIT_RETENTION_DAYS = 1;
export const MAX_AUDIT_RETENTION_DAYS = 3650;

/**
 * App-wide settings of the admin query console (Settings -> Query console):
 * how long the audit trail is kept, and whether the console holds commands back
 * to stay clear of TeamSpeak's query flood limit. Stored in AppSetting like the
 * other installation-wide settings; a missing or unusable value falls back to
 * the default rather than reaching the console as garbage.
 */
export async function getConsoleSettings(prisma: PrismaClient): Promise<ConsoleSettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [KEY_RETENTION_DAYS, KEY_FLOOD_GUARD] } },
  });
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const days = Number(stored.get(KEY_RETENTION_DAYS));
  const guard = stored.get(KEY_FLOOD_GUARD);

  return {
    auditRetentionDays:
      Number.isInteger(days) && days >= MIN_AUDIT_RETENTION_DAYS && days <= MAX_AUDIT_RETENTION_DAYS
        ? days
        : DEFAULT_CONSOLE_SETTINGS.auditRetentionDays,
    floodGuardEnabled: guard === undefined ? DEFAULT_CONSOLE_SETTINGS.floodGuardEnabled : guard === 'true',
  };
}

export async function setConsoleSettings(prisma: PrismaClient, values: ConsoleSettings): Promise<ConsoleSettings> {
  const pairs: Array<[string, string]> = [
    [KEY_RETENTION_DAYS, String(values.auditRetentionDays)],
    [KEY_FLOOD_GUARD, String(values.floodGuardEnabled)],
  ];
  await prisma.$transaction(
    pairs.map(([key, value]) =>
      prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } }),
    ),
  );
  return values;
}
