import type { PrismaClient } from '../generated/prisma/client.js';

const KEY_BODY_LIMIT_KB = 'webhook_body_limit_kb';
const KEY_VALID_PER_MINUTE = 'webhook_valid_per_minute';
const KEY_FAILED_PER_MINUTE = 'webhook_failed_per_minute';

/**
 * Limits on the unauthenticated webhook route, checked before its body is parsed. Valid calls
 * (a secret that matched) and failed ones (unknown path or wrong secret) are counted apart per
 * address, so somebody guessing secrets runs into the strict limit long before a real caller
 * from another address notices anything.
 */
export const WEBHOOK_BOUNDS = {
  bodyLimitKb: { min: 1, max: 10_240 },
  validPerMinute: { min: 1, max: 10_000 },
  failedPerMinute: { min: 1, max: 1_000 },
} as const;

export const WEBHOOK_DEFAULTS = {
  bodyLimitKb: 1024,
  validPerMinute: 120,
  failedPerMinute: 10,
} as const;

export type WebhookSettings = { -readonly [K in keyof typeof WEBHOOK_DEFAULTS]: number };

const KEYS: Record<keyof WebhookSettings, string> = {
  bodyLimitKb: KEY_BODY_LIMIT_KB,
  validPerMinute: KEY_VALID_PER_MINUTE,
  failedPerMinute: KEY_FAILED_PER_MINUTE,
};

export function isValidWebhookSetting(name: keyof WebhookSettings, value: unknown): value is number {
  const { min, max } = WEBHOOK_BOUNDS[name];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** What the webhook route checks against; loaded at start and replaced on every save. */
let current: WebhookSettings = { ...WEBHOOK_DEFAULTS };
export const webhookSettings = (): WebhookSettings => current;

export async function loadWebhookSettings(prisma: PrismaClient): Promise<WebhookSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const stored = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const next = { ...WEBHOOK_DEFAULTS } as WebhookSettings;
  for (const name of Object.keys(KEYS) as Array<keyof WebhookSettings>) {
    // A stored value outside the bounds (moved bound, hand-edited row) falls back to the default.
    const value = stored.get(KEYS[name]);
    if (isValidWebhookSetting(name, value)) next[name] = value;
  }
  current = next;
  return next;
}

export async function saveWebhookSettings(prisma: PrismaClient, values: WebhookSettings): Promise<WebhookSettings> {
  await prisma.$transaction(
    (Object.keys(KEYS) as Array<keyof WebhookSettings>).map((name) => {
      const key = KEYS[name];
      const value = String(values[name]);
      return prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }),
  );
  current = { ...values };
  return current;
}
