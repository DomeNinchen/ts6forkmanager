import type { PrismaClient } from '../generated/prisma/client.js';
import { encrypt, decrypt } from './crypto.js';

/**
 * A personal access token used only to authenticate the update-checker's own
 * GitHub API calls (see update-check.ts), raising its rate limit from 60/hour
 * (unauthenticated) to 5000/hour. Needs no scopes - it only ever reads public
 * repository contents.
 */

const DB_KEY = 'github_token';

export async function getGithubToken(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: DB_KEY } });
  if (!row) return null;
  try {
    return decrypt(row.value);
  } catch {
    return null;
  }
}

export async function setGithubToken(prisma: PrismaClient, token: string | null): Promise<void> {
  if (!token) {
    await prisma.appSetting.deleteMany({ where: { key: DB_KEY } });
    return;
  }
  const encrypted = encrypt(token);
  await prisma.appSetting.upsert({
    where: { key: DB_KEY },
    create: { key: DB_KEY, value: encrypted },
    update: { value: encrypted },
  });
}
