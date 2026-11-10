import type { CommandTriggerData, EventTriggerData, SupportTriggerData } from '@ts6/common';

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
