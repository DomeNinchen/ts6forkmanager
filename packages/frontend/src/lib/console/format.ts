import { isSecretKey, tsEscape } from '@ts6/common';
import type { ConsoleStatus } from '@ts6/common';

/** Consecutive records that have the same fields; the console shows each such run as one table. */
export interface RecordGroup {
  keys: string[];
  records: Record<string, string>[];
}

export function groupRecords(records: Record<string, string>[]): RecordGroup[] {
  const groups: RecordGroup[] = [];
  for (const record of records) {
    const keys = Object.keys(record);
    const signature = keys.join('\u0000');
    const last = groups[groups.length - 1];
    if (last && last.keys.join('\u0000') === signature) last.records.push(record);
    else groups.push({ keys, records: [record] });
  }
  return groups;
}

/** A record's secret fields (by name) that actually hold something. */
export function hasSecret(records: Record<string, string>[]): boolean {
  return records.some((record) => Object.entries(record).some(([key, value]) => value !== '' && isSecretKey(key)));
}

/**
 * The result the way a real ServerQuery connection prints it: `key=value` pairs
 * with ServerQuery escapes, list items separated by `|`, and the closing
 * `error id=... msg=...` line.
 */
export function toRawText(
  records: Record<string, string>[],
  status: ConsoleStatus,
  options: { revealSecrets: boolean },
): string {
  const body = records
    .map((record) =>
      Object.entries(record)
        .map(([key, value]) => {
          if (!options.revealSecrets && value !== '' && isSecretKey(key)) return `${key}=***`;
          return value === '' && key !== '' ? key : `${key}=${tsEscape(value)}`;
        })
        .join(' '),
    )
    .join('|');
  const extra = status.extraMessage ? ` extra_msg=${tsEscape(status.extraMessage)}` : '';
  const error = `error id=${status.code} msg=${tsEscape(status.message)}${extra}`;
  return body ? `${body}\n${error}` : error;
}

export function toJson(records: Record<string, string>[], options: { revealSecrets: boolean }): string {
  const shown = records.map((record) =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, !options.revealSecrets && value !== '' && isSecretKey(key) ? '***' : value]),
    ),
  );
  return JSON.stringify(shown, null, 2);
}
