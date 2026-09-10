import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Standalone on purpose: this script (and the generated client it needs)
// runs directly via tsx against source, both in local dev and via `npx prisma
// db seed` in the production image -- it must not depend on anything under
// src/ other than src/generated/, since that's all the Dockerfile copies
// alongside it. Same DATABASE_URL fallback as src/config.ts and prisma.config.ts.
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./data/ts6webui.db' });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Seed default app settings (no default admin — use /setup wizard instead)
  await prisma.appSetting.upsert({
    where: { key: 'max_music_bots' },
    update: {},
    create: { key: 'max_music_bots', value: '5' },
  });

  console.log('Seed completed: app settings created. Visit /setup to create your admin account.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
