// Masking for the query debug log. The list of secret parameter names lives in
// one place (`isSecretKey` in common, shared with the query console); these two
// helpers only apply it to the two shapes the log sees: WebQuery's JSON and raw
// ServerQuery text from SSH. Callers keep the unmasked originals.

import { isSecretKey, MASKED_VALUE } from '@ts6/common';

/** A copy of a WebQuery parameter object or answer with every secret value replaced, at any depth. */
export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, isSecretKey(key) && v !== '' && v != null ? MASKED_VALUE : maskSecrets(v)]),
  );
}

// key=value in a raw ServerQuery line. Escaped values never contain a raw space or pipe.
const PAIR_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)=([^\s|]*)/g;

/** A ServerQuery command or answer line with every secret value replaced. */
export function maskSecretsInLine(line: string): string {
  return line.replace(PAIR_PATTERN, (pair, key: string, value: string) =>
    value !== '' && isSecretKey(key) ? `${key}=${MASKED_VALUE}` : pair,
  );
}
