import { formatQueryLine, isSecretKey, parseQueryLine, tsEscape } from '@ts6/common';

// The console's target selector: besides raw commands it can send a chat message
// to the server, to a channel or to one client. Those are plain sendtextmessage
// commands underneath, so they go through the same checks, the same audit trail
// and the same flood protection as anything typed in command mode.

export type ConsoleMode = 'command' | 'server' | 'channel' | 'private';

const TARGET_MODE: Record<Exclude<ConsoleMode, 'command'>, number> = { private: 1, channel: 2, server: 3 };

export function buildMessageLine(mode: Exclude<ConsoleMode, 'command'>, text: string, target: string | null): string {
  const parts = ['sendtextmessage', `targetmode=${TARGET_MODE[mode]}`];
  // For a message to the whole server TeamSpeak ignores the target, so none is sent.
  if (target) parts.push(`target=${target}`);
  parts.push(`msg=${tsEscape(text)}`);
  return parts.join(' ');
}

/** What the transcript shows for a command: normalized, with every secret value hidden. */
export function maskedEcho(line: string): string {
  const parsed = parseQueryLine(line);
  if (!parsed.ok) return line;
  return formatQueryLine(parsed.value, { maskKey: isSecretKey, maxValueLength: 400 });
}
