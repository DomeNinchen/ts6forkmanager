// TeamSpeak ServerQuery error codes worth surfacing with a specific message
// instead of the backend's generic "TeamSpeak API Error". Sourced from the
// TS3 ServerQuery error list (https://yat.qa/resources/server-error-codes/,
// dated 2015) - TS6 has not been confirmed to use identical numeric codes,
// so this is a best-effort mapping with a safe fallback to whatever text the
// server actually returned, not an authoritative table.
const KNOWN_TS_ERROR_MESSAGES: Record<number, string> = {
  1282: 'A group with this name already exists',
  2560: 'Invalid group - it may have been deleted',
  2561: 'That permission is already set on this group',
  2562: 'This server does not recognize one of the permissions in the file',
  2564: 'Cannot modify permissions on a default/template group',
  2565: 'Invalid permission value size in the file',
  2566: 'Invalid permission value in the file',
  2569: 'Insufficient permission modify power for one of the imported values',
  2570: 'Insufficient permission modify power for one of the imported values',
};

/** Extracts a human-readable message from an axios error against this app's API. */
export function tsErrorMessage(err: any, fallback: string): string {
  const code = err?.response?.data?.code;
  if (typeof code === 'number' && KNOWN_TS_ERROR_MESSAGES[code]) {
    return KNOWN_TS_ERROR_MESSAGES[code];
  }
  return err?.response?.data?.details || err?.response?.data?.error || fallback;
}
