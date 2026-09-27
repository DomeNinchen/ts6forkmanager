import type { TFunction } from 'i18next';

// TeamSpeak ServerQuery error codes worth surfacing with a specific message
// instead of the backend's generic "TeamSpeak API Error". Sourced from the
// TS3 ServerQuery error list (https://yat.qa/resources/server-error-codes/,
// dated 2015) - TS6 has not been confirmed to use identical numeric codes,
// so this is a best-effort mapping with a safe fallback to whatever text the
// server actually returned, not an authoritative table.
const KNOWN_TS_ERROR_KEYS: Record<number, string> = {
  1282: 'errors.ts.groupNameExists',
  2560: 'errors.ts.invalidGroup',
  2561: 'errors.ts.permAlreadySet',
  2562: 'errors.ts.unknownPermission',
  2564: 'errors.ts.cannotModifyDefaultGroup',
  2565: 'errors.ts.invalidPermValueSize',
  2566: 'errors.ts.invalidPermValue',
  2569: 'errors.ts.insufficientModifyPower',
  2570: 'errors.ts.insufficientModifyPower',
};

/** Extracts a human-readable message from an axios error against this app's API. */
export function tsErrorMessage(err: any, fallback: string, t: TFunction): string {
  const code = err?.response?.data?.code;
  if (typeof code === 'number' && KNOWN_TS_ERROR_KEYS[code]) {
    return t(KNOWN_TS_ERROR_KEYS[code]);
  }
  return err?.response?.data?.details || err?.response?.data?.error || fallback;
}
