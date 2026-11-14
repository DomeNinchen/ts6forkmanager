import type { PrismaClient } from '../generated/prisma/client.js';

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

export type WebhookLimit = keyof typeof WEBHOOK_BOUNDS;

export interface WebhookSettings {
  bodyLimitKb: number;
  validPerMinute: number;
  failedPerMinute: number;
  /** Whether a secret sent as `?secret=` in the address is still accepted (the header is the documented way). */
  allowQuerySecret: boolean;
}

export const WEBHOOK_DEFAULTS: WebhookSettings = {
  bodyLimitKb: 1024,
  validPerMinute: 120,
  failedPerMinute: 10,
  allowQuerySecret: true,
};

const LIMIT_KEYS: Record<WebhookLimit, string> = {
  bodyLimitKb: 'webhook_body_limit_kb',
  validPerMinute: 'webhook_valid_per_minute',
  failedPerMinute: 'webhook_failed_per_minute',
};
const KEY_ALLOW_QUERY_SECRET = 'webhook_allow_query_secret';
export const WEBHOOK_LIMITS = Object.keys(LIMIT_KEYS) as WebhookLimit[];

export function isValidWebhookSetting(name: WebhookLimit, value: unknown): value is number {
  const { min, max } = WEBHOOK_BOUNDS[name];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** What the webhook route checks against; loaded at start and replaced on every save. */
let current: WebhookSettings = { ...WEBHOOK_DEFAULTS };
export const webhookSettings = (): WebhookSettings => current;

export async function loadWebhookSettings(prisma: PrismaClient): Promise<WebhookSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...Object.values(LIMIT_KEYS), KEY_ALLOW_QUERY_SECRET] } } });
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const next = { ...WEBHOOK_DEFAULTS };
  for (const name of WEBHOOK_LIMITS) {
    // A stored value outside the bounds (moved bound, hand-edited row) falls back to the default.
    const value = Number(stored.get(LIMIT_KEYS[name]));
    if (isValidWebhookSetting(name, value)) next[name] = value;
  }
  const allow = stored.get(KEY_ALLOW_QUERY_SECRET);
  if (allow === 'true' || allow === 'false') next.allowQuerySecret = allow === 'true';
  current = next;
  return next;
}

export async function saveWebhookSettings(prisma: PrismaClient, values: WebhookSettings): Promise<WebhookSettings> {
  const pairs: Array<[string, string]> = [
    ...WEBHOOK_LIMITS.map((name): [string, string] => [LIMIT_KEYS[name], String(values[name])]),
    [KEY_ALLOW_QUERY_SECRET, String(values.allowQuerySecret)],
  ];
  await prisma.$transaction(
    pairs.map(([key, value]) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })),
  );
  current = { ...values };
  return current;
}
