import type { CommandTriggerData, EventTriggerData, SupportTriggerData } from '@ts6/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// What a trigger node makes of an incoming event, as pure functions: the engine
// uses them on live events, the flow test (FlowRunner.test) on sample data, so
// the two can never drift apart.

/** The first filter of an event trigger the event does not meet, or null when it would start the flow. */
export function eventFilterMismatch(trigger: EventTriggerData, data: Record<string, string>): { key: string; expected: string; actual: string | null } | null {
  for (const [key, value] of Object.entries(trigger.filters || {})) {
    if (data[key] !== value) return { key, expected: value, actual: data[key] ?? null };
  }
  return null;
}

/**
 * The event data a command trigger hands its flow for this text message, or a reason why the
 * message is not this command: 'listener' (it came from the wrong chat), 'command' (other text).
 */
export function matchCommand(trigger: CommandTriggerData, data: Record<string, string>): { data: Record<string, string> } | { mismatch: 'listener' | 'command' } {
  // Backward-compat:
  // - if trigger has NO channelId => only react to base connection events
  // - if trigger HAS channelId => only react if event came from that cmd listener
  const sourceListenerCid = data.__cmd_listener_channel_id;
  if (!trigger.channelId) {
    if (sourceListenerCid) return { mismatch: 'listener' };
  } else if (!sourceListenerCid || sourceListenerCid !== String(trigger.channelId)) {
    return { mismatch: 'listener' };
  }

  const msg = data.msg || '';
  const fullCommand = (trigger.commandPrefix || '!') + trigger.commandName;
  if (!msg.startsWith(fullCommand)) return { mismatch: 'command' };

  const afterCmd = msg.substring(fullCommand.length);
  if (afterCmd.length > 0 && afterCmd[0] !== ' ') return { mismatch: 'command' };

  const args = afterCmd.trim();
  // command_args stays the original plain string (existing flows may
  // already display it directly, e.g. in a reply message) - the
  // indexed form is a separate field, same nested-JSON-access
  // mechanism resolveTemplate() already uses for event.webhook_body.*.
  const argsList = args.length > 0 ? args.split(/\s+/) : [];
  const enriched: Record<string, string> = {
    ...data,
    command_args: args,
    command_args_list: JSON.stringify(argsList),
    command_args_length: String(argsList.length),
    command_name: trigger.commandName,
    command_channel_id: data.__cmd_listener_channel_id || trigger.channelId || data.target || '',
  };

  const invoker = data.clid || data.invokerid || data.invoker_id || data.invokerId || data.client_id || data.clientId;
  if (invoker && !data.clid) enriched.clid = String(invoker);

  return { data: enriched };
}

/**
 * Whether the secret a webhook call sent is the trigger's. Both sides are hashed first, so the
 * constant-time comparison always sees two equally long values and the time taken says nothing
 * about the secret's length. A trigger without a secret never matches.
 */
export function webhookSecretMatches(expected: string, provided: string): boolean {
  if (!expected) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(expected), digest(provided));
}

/** How far a signed call's timestamp may lie from the server's clock, either way; also how long a used signature is remembered. */
export const WEBHOOK_SIGNATURE_WINDOW_MS = 5 * 60_000;

export type WebhookSignatureResult = 'ok' | 'bad' | 'stale';

/**
 * Checks a signed webhook call: X-Webhook-Signature must be `sha256=` and the hex HMAC-SHA256,
 * keyed with the trigger's secret, of `<X-Webhook-Timestamp>.<raw body>`; the timestamp (Unix
 * seconds) must lie within WEBHOOK_SIGNATURE_WINDOW_MS of now. 'stale' only for a signature that
 * is right but too old or too new (a clock problem worth logging); anything else wrong is 'bad'.
 */
export function webhookSignatureCheck(
  secret: string, timestamp: unknown, signature: unknown, rawBody: Buffer, nowMs: number,
): WebhookSignatureResult {
  if (!secret || typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp) || typeof signature !== 'string') return 'bad';
  const given = /^sha256=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!given) return 'bad';
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  // Both are 32 bytes here, so the comparison takes the same time whatever was sent.
  if (!timingSafeEqual(expected, Buffer.from(given[1], 'hex'))) return 'bad';
  return Math.abs(nowMs - Number(timestamp) * 1000) <= WEBHOOK_SIGNATURE_WINDOW_MS ? 'ok' : 'stale';
}

/**
 * Signatures already used, per trigger, for as long as their timestamp is accepted: a call
 * recorded and sent again is refused. In memory only, so the first window after a restart
 * accepts a repeat once (his decision: no table for this).
 */
export class SignatureReplayGuard {
  private used = new Map<string, number>();

  /** True the first time this key is seen within the window, false for a repeat. */
  firstUse(key: string, nowMs: number): boolean {
    for (const [k, until] of this.used) if (until <= nowMs) this.used.delete(k);
    if (this.used.has(key)) return false;
    // Long enough to outlive the timestamp: up to one window ahead of now, plus one behind.
    this.used.set(key, nowMs + 2 * WEBHOOK_SIGNATURE_WINDOW_MS);
    return true;
  }
}

/**
 * The secret a webhook call sent and whether it came from the address (`?secret=`). The
 * X-Webhook-Secret header wins when both are there; the address is read only while allowed.
 */
export function webhookSecretFrom(header: unknown, query: unknown, allowQuery: boolean): { secret: string; viaQuery: boolean } {
  const fromHeader = typeof header === 'string' ? header : '';
  if (fromHeader) return { secret: fromHeader, viaQuery: false };
  const fromQuery = allowQuery && typeof query === 'string' ? query : '';
  return { secret: fromQuery, viaQuery: fromQuery !== '' };
}

/** The event data of a webhook call. The secret, when sent as `?secret=`, is not part of it: it would end up in the execution's stored trigger data. */
export function webhookEventData(path: string, method: string, body: unknown, query: Record<string, unknown>): Record<string, string> {
  const { secret: _secret, ...rest } = query || {};
  return {
    webhook_path: path,
    webhook_method: method,
    webhook_body: JSON.stringify(body || {}),
    webhook_query: JSON.stringify(rest),
  };
}

/** A support trigger bound to one queue ignores the others: the mismatch, or null when it would start the flow. */
export function supportQueueMismatch(trigger: SupportTriggerData, data: Record<string, string>): { key: string; expected: string; actual: string | null } | null {
  const want = String(trigger.queueId ?? '').trim();
  return want && data.queue_id !== want ? { key: 'queue_id', expected: want, actual: data.queue_id ?? null } : null;
}
