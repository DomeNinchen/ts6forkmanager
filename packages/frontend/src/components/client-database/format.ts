import type { TFunction } from 'i18next';
import i18n from '@/lib/i18n';

/** "Alice, Bob, Carol and 2 more" - the first `max` nicknames and how many were left out. */
export function summarizeNames(profiles: { cldbid: number; nickname: string }[], max: number, t: TFunction): string {
  const names = profiles.slice(0, max).map((p) => p.nickname || `#${p.cldbid}`);
  const rest = profiles.length - names.length;
  return rest > 0 ? `${names.join(', ')} ${t('pages.clientDatabase.andMore', { count: rest })}` : names.join(', ');
}

/** A TeamSpeak unix timestamp (seconds) as the viewer's local date and time; "-" when the server has none. */
export function formatDateTime(seconds: number): string {
  if (!seconds) return '-';
  return new Date(seconds * 1000).toLocaleString(i18n.language);
}

export interface ChannelOption {
  cid: number;
  name: string;
  depth: number;
}

/** The channel list in tree order with each channel's nesting depth, for pickers and name lookups. */
export function orderChannels(channels: any[]): ChannelOption[] {
  const byParent = new Map<number, any[]>();
  for (const channel of channels) {
    const pid = Number(channel.pid);
    const siblings = byParent.get(pid);
    if (siblings) siblings.push(channel);
    else byParent.set(pid, [channel]);
  }
  const ordered: ChannelOption[] = [];
  const walk = (pid: number, depth: number) => {
    for (const channel of byParent.get(pid) ?? []) {
      ordered.push({ cid: Number(channel.cid), name: channel.channel_name, depth });
      walk(Number(channel.cid), depth + 1);
    }
  };
  walk(0, 0);
  return ordered;
}
