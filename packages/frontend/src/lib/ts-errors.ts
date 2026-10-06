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

/**
 * The message for a failed change of a channel's icon. A channel's icon is the channel
 * permission `i_icon_id`, so what goes wrong is nearly always a missing right - and
 * TeamSpeak's own "insufficient client permissions" says too little, because two different
 * checks are in play (both reproduced against a real TS6 server with a restricted account):
 *  - 2568 naming `i_channel_needed_permission_modify_power`: the channel itself asks for more
 *    channel permission modify power than the account has. A channel made through ServerQuery
 *    carries the query admin's 100, so even a regular Server Admin with 75 cannot change it.
 *  - 2570: the account's permission modify power is below what `i_icon_id` needs.
 * The backend passes the permission TeamSpeak names on as `failedPermission`.
 */
export function channelIconErrorMessage(err: any, t: TFunction): string {
  const data = err?.response?.data;
  if (data?.code === 2570) return t('errors.ts.channelIconModifyPower');
  if (data?.code === 2568) {
    const permission = typeof data.failedPermission === 'string' ? data.failedPermission : '';
    if (permission === 'i_channel_needed_permission_modify_power') return t('errors.ts.channelIconChannelPower');
    return permission
      ? t('errors.ts.channelIconMissingPermission', { permission })
      : t('errors.ts.channelIconNoRights');
  }
  return tsErrorMessage(err, t('components.editChannelDialog.iconChangeFailed'), t);
}
