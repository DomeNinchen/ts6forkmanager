import type { PrismaClient } from '../generated/prisma/client.js';

const DB_KEY = 'privacy_notice_enabled';

/**
 * Whether the web interface shows its storage notice (a dismissible info bar saying
 * the app only keeps technically necessary data in the browser). On unless an admin
 * switched it off - the notice is informational only, nothing is gated behind it.
 * Readable without a login (see public-config.routes.ts), since the login page shows
 * it too.
 */
export async function getPrivacyNoticeEnabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: DB_KEY } });
  if (!row) return true;
  return row.value !== 'false';
}

export async function setPrivacyNoticeEnabled(prisma: PrismaClient, value: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: DB_KEY },
    create: { key: DB_KEY, value: String(value) },
    update: { value: String(value) },
  });
}
