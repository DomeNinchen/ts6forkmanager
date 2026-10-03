import type { TFunction } from 'i18next';
import type { RepositoryPathProblem } from '@ts6/common';

/** Text for a problem the shared path checks (`@ts6/common`) found in a name. */
export function pathProblemMessage(problem: RepositoryPathProblem, t: TFunction): string {
  return t(`pages.files.problem.${problem}`);
}

function hasNonAscii(name: string): boolean {
  for (let index = 0; index < name.length; index++) {
    if (name.charCodeAt(index) > 0x7f) return true;
  }
  return false;
}

/**
 * Readable text for a failed request against the Files API. TeamSpeak's own
 * status numbers arrive as `code` (see the backend's TSApiError) and are the
 * ones seen on a real TS6 server while building this: 2050 "file already
 * exists", 2051 "file not found", 2048 "invalid file name", 2054 "invalid file
 * path" and 2052 "file input/output error".
 *
 * `fileName` lets a refusal of a name with umlauts or other non-ASCII
 * characters be explained as what it almost certainly is: a TS6 server on Linux
 * that cannot store such names (it reports 2054 or 2052 for them, verified live).
 */
export function fileErrorMessage(err: any, t: TFunction, fileName?: string): string {
  const response = err?.response;
  if (!response) return t('pages.files.errors.network');

  const data = response.data;
  const code = typeof data === 'object' ? data?.code : undefined;

  if (code === 2050) return t('pages.files.errors.exists');
  if (code === 2051) return t('pages.files.errors.notFound');
  if ((code === 2048 || code === 2052 || code === 2054) && fileName && hasNonAscii(fileName)) {
    return t('pages.files.errors.nonAscii');
  }
  if (code === 2052) return t('pages.files.errors.io');
  if (code === 2054) return t('pages.files.errors.invalidPath');
  if (code === 2048) return t('pages.files.errors.invalidName');

  // 413 from this app's own API carries a JSON body; a reverse proxy's does not
  if (response.status === 413) {
    return typeof data === 'object' ? t('pages.files.errors.tooLarge') : t('pages.files.errors.proxyTooLarge');
  }

  const message = typeof data === 'object' ? (data?.details || data?.error) : undefined;
  if (typeof message === 'string' && message.includes('SSH credentials are not configured')) {
    return t('pages.files.unavailableSsh');
  }
  return message || t('pages.files.errors.generic');
}

/** Is this the "a file with that name is already there" refusal? */
export function isAlreadyExists(err: any): boolean {
  return err?.response?.data?.code === 2050;
}
