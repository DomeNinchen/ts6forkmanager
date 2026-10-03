import type { CatalogEnumValue } from './catalog-types';
import { getEnum } from './catalog';
import { entityOfField, type EntityKind } from './entities';

// What a value in a result means, beyond the text TeamSpeak sends: a number that
// is really one of a fixed set of choices, a 0/1 flag, a Unix time, a size, or
// the id of a channel, client or group. The console shows this when a value is
// clicked. Only what can be said with confidence is said: a value this file does
// not know is left alone rather than guessed at.

export type ValueMeaning =
  /** One of the manual's enumerations, e.g. reasonid 5 = KICK_SERVER. */
  | { kind: 'enum'; name: string }
  | { kind: 'yesNo'; yes: boolean }
  | { kind: 'clientType'; query: boolean }
  | { kind: 'timestamp'; date: Date }
  | { kind: 'duration'; text: string }
  | { kind: 'bytes'; bytes: number; perSecond: boolean }
  | { kind: 'entity'; entity: EntityKind; ids: string[] };

/** Fields and parameters whose values one of the manual's enumerations defines. */
const ENUM_OF_FIELD: Readonly<Record<string, string>> = {
  targetmode: 'TextMessageTargetMode',
  loglevel: 'LogLevel',
  reasonid: 'ReasonIdentifier',
  tokentype: 'TokenType',
  token_type: 'TokenType',
  virtualserver_hostmessage_mode: 'HostMessageMode',
  virtualserver_hostbanner_mode: 'HostBannerMode',
  virtualserver_codec_encryption_mode: 'CodecEncryptionMode',
  channel_codec: 'Codec',
};

// Field names come from the server, so they are only ever looked up as own keys.
const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** Fields that only ever hold 0 or 1. */
const FLAG_FIELD =
  /^(?:channel_flag_\w+|channel_forced_silence|channel_codec_is_unencrypted|client_is_\w+|client_(?:input|output)_(?:muted|hardware)|client_away|virtualserver_(?:flag_password|autostart|weblist_enabled|ask_for_privilegekey|log_\w+)|permnegated|permskip)$/;

/** Unix time in seconds. */
const TIMESTAMP_FIELDS: ReadonlySet<string> = new Set(['client_created', 'client_lastconnected', 'virtualserver_created', 'host_timestamp_utc']);

const DURATION_SECONDS_FIELDS: ReadonlySet<string> = new Set(['instance_uptime', 'virtualserver_uptime', 'seconds_empty', 'time_left']);
const DURATION_MILLISECONDS_FIELDS: ReadonlySet<string> = new Set(['client_idle_time', 'connection_connected_time']);

const BYTES_FIELD = /_bytes_|_bytes$/;
const BANDWIDTH_FIELD = /_bandwidth_/;

/** The values of the manual's enumeration a field or parameter takes, if it has one. */
export function enumValuesFor(field: string): readonly CatalogEnumValue[] | undefined {
  return has(ENUM_OF_FIELD, field) ? getEnum(ENUM_OF_FIELD[field]) : undefined;
}

function humanDuration(totalSeconds: number): string {
  let rest = Math.floor(totalSeconds);
  const parts: string[] = [];
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60]] as const) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }
  if (rest > 0 || parts.length === 0) parts.push(`${rest}s`);
  return parts.join(' ');
}

const isWhole = (value: string): boolean => /^\d+$/.test(value);

export function explainValue(field: string, value: string, record: Record<string, string>): ValueMeaning | null {
  if (value === '') return null;

  const enumName =
    (has(ENUM_OF_FIELD, field) ? ENUM_OF_FIELD[field] : undefined) ??
    (field === 'type' && (has(record, 'sgid') || has(record, 'cgid')) ? 'PermissionGroupDatabaseTypes' : undefined);
  if (enumName) {
    const hit = getEnum(enumName)?.find((entry) => entry.value === value);
    return hit ? { kind: 'enum', name: hit.name } : null;
  }

  if (field === 'client_type') return value === '0' || value === '1' ? { kind: 'clientType', query: value === '1' } : null;
  if (FLAG_FIELD.test(field)) return value === '0' || value === '1' ? { kind: 'yesNo', yes: value === '1' } : null;

  if (TIMESTAMP_FIELDS.has(field) && isWhole(value) && Number(value) > 0) {
    return { kind: 'timestamp', date: new Date(Number(value) * 1000) };
  }
  if (DURATION_SECONDS_FIELDS.has(field) && isWhole(value)) return { kind: 'duration', text: humanDuration(Number(value)) };
  if (DURATION_MILLISECONDS_FIELDS.has(field) && isWhole(value)) return { kind: 'duration', text: humanDuration(Number(value) / 1000) };
  if ((BYTES_FIELD.test(field) || BANDWIDTH_FIELD.test(field)) && isWhole(value)) {
    return { kind: 'bytes', bytes: Number(value), perSecond: BANDWIDTH_FIELD.test(field) };
  }

  const entity = entityOfField(field);
  // A permission's own name needs no explaining, and an id has to be a number to name anything.
  if (entity && entity !== 'permission') {
    const ids = field === 'client_servergroups' ? value.split(',') : [value];
    if (ids.every(isWhole)) return { kind: 'entity', entity, ids };
  }
  return null;
}
