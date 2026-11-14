import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * How often each flow was called with its webhook secret in the address (`?secret=`) instead of
 * the X-Webhook-Secret header, so an admin can see which callers still need switching over before
 * the address form is turned off. Counted in memory and written at most once a minute per flow
 * (and at shutdown), so a busy webhook costs no extra write per call.
 */
const pending = new Map<number, { count: number; last: Date }>();
let timer: NodeJS.Timeout | null = null;

export function noteQuerySecretUse(flowId: number, at = new Date()): void {
  const entry = pending.get(flowId);
  if (entry) { entry.count++; entry.last = at; } else pending.set(flowId, { count: 1, last: at });
}

export async function flushQuerySecretUses(prisma: PrismaClient): Promise<void> {
  const batch = [...pending];
  pending.clear();
  for (const [flowId, { count, last }] of batch) {
    // updateMany: a flow deleted in the meantime is simply skipped.
    await prisma.botFlow.updateMany({
      where: { id: flowId },
      data: { querySecretCalls: { increment: count }, querySecretLastAt: last },
    }).catch((err: unknown) => console.error('[BotEngine] Could not store ?secret= calls:', err));
  }
}

export function startQuerySecretFlusher(prisma: PrismaClient): void {
  timer ??= setInterval(() => { void flushQuerySecretUses(prisma); }, 60_000);
  timer.unref();
}

export async function stopQuerySecretFlusher(prisma: PrismaClient): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  await flushQuerySecretUses(prisma);
}
