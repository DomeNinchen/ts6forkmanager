import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from './generated/prisma/client.js';

// TypeScript >= 6 no longer reports unknown fields in Prisma's nested query args once a valid one sits
// beside them (microsoft/TypeScript#62722, prisma/orm#29519), so the backend stays on TypeScript 5.9.
// If a compiler bump loses that check again, this directive turns unused and `pnpm typecheck` fails.
// @ts-expect-error -- `bogusField` is not a BotExecution column
export const unknownSelectFieldCanary = (p: PrismaClient) => p.botExecution.findMany({ select: { id: true, bogusField: true } });

// Guards against editing prisma/schema.prisma without committing a matching migration
// (several chats work on the schema in parallel). Runs in `pnpm test` and in CI.
// `migrate diff --from-migrations --to-schema` needs no shadow database for SQLite.
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaBin = path.join(backendDir, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');

test('schema.prisma matches the committed migrations (run `pnpm db:migrate` if this fails)', () => {
  const r = spawnSync(
    prismaBin,
    ['migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema', 'prisma/schema.prisma', '--exit-code'],
    { cwd: backendDir, encoding: 'utf8' },
  );
  // --exit-code: 0 = in sync, 2 = schema.prisma has changes no migration captures, 1 = error.
  assert.equal(
    r.status,
    0,
    `schema.prisma differs from prisma/migrations (exit ${r.status}). Generate a migration with \`pnpm db:migrate\`.\n${r.stdout ?? ''}${r.stderr ?? ''}`,
  );
});
