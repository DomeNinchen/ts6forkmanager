// Paths and timestamps in a TeamSpeak channel's file repository - the things
// `ftgetfilelist`, `ftinitupload` and friends address.
//
// Both sides use these: the frontend to fail early with a readable message,
// the backend as the actual guard before a path ever reaches a ServerQuery
// command. A real TS6 server answers `..` with error 2054 ("invalid file
// path"), verified live, but nothing here relies on the server catching it.

/** A file or folder name may be at most this long. A real TS6 server accepted
 * a 255-character name and rejected 256 with error 2048 ("invalid file
 * name"); the limit is counted in UTF-8 bytes, the stricter reading. */
export const MAX_FILE_NAME_BYTES = 255;

/** Upper bound for a whole repository path. Not a TeamSpeak figure (a real
 * TS6 server took a 262-character path without complaint) - just a ceiling
 * that no real folder tree reaches. */
export const MAX_REPOSITORY_PATH_LENGTH = 2048;

export type RepositoryPathProblem =
  | 'empty'
  | 'not-absolute'
  | 'control-character'
  | 'backslash'
  | 'slash-in-name'
  | 'empty-segment'
  | 'dot-segment'
  | 'name-too-long'
  | 'path-too-long';

/** C0 and C1 controls, DEL, the Unicode line and paragraph separators, and the
 * bidi override/isolate controls. The last group is what lets a name like
 * "photo<RLO>gnp.exe" display as "photoexe.png"; there is no legitimate reason
 * for any of these in a file name.
 *
 * Checked by character code rather than with a regular expression on purpose:
 * the line and paragraph separators (U+2028/U+2029) end a line inside a
 * JavaScript regex literal, which is exactly how a first version of this check
 * broke the compiled package with a syntax error. */
function isForbiddenCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function hasForbiddenCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (isForbiddenCharacter(value.charCodeAt(index))) return true;
  }
  return false;
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Check a single file or folder name. Returns the first problem, or null. */
export function checkFileName(name: string): RepositoryPathProblem | null {
  if (!name) return 'empty';
  if (name === '.' || name === '..') return 'dot-segment';
  if (name.includes('/')) return 'slash-in-name';
  if (name.includes('\\')) return 'backslash';
  if (hasForbiddenCharacter(name)) return 'control-character';
  if (utf8Length(name) > MAX_FILE_NAME_BYTES) return 'name-too-long';
  return null;
}

/** Check an absolute repository path such as `/photos/2024/a.jpg`. The root
 * `/` is only accepted when `allowRoot` is set (listing a directory), never as
 * the target of an upload, download or delete. Returns the first problem, or
 * null. */
export function checkRepositoryPath(path: string, { allowRoot = false } = {}): RepositoryPathProblem | null {
  if (!path) return 'empty';
  if (path[0] !== '/') return 'not-absolute';
  if (path.length > MAX_REPOSITORY_PATH_LENGTH) return 'path-too-long';
  if (path === '/') return allowRoot ? null : 'empty';
  if (hasForbiddenCharacter(path)) return 'control-character';
  if (path.includes('\\')) return 'backslash';
  for (const segment of path.slice(1).split('/')) {
    if (segment === '') return 'empty-segment';
    if (segment === '.' || segment === '..') return 'dot-segment';
    if (utf8Length(segment) > MAX_FILE_NAME_BYTES) return 'name-too-long';
  }
  return null;
}

/** `/` + `a.txt` -> `/a.txt`, `/photos` + `a.txt` -> `/photos/a.txt`. */
export function joinRepositoryPath(directory: string, name: string): string {
  return directory === '/' ? `/${name}` : `${directory}/${name}`;
}

/** `/photos/2024/a.jpg` -> `{ directory: '/photos/2024', name: 'a.jpg' }`. */
export function splitRepositoryPath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf('/');
  return { directory: index <= 0 ? '/' : path.slice(0, index), name: path.slice(index + 1) };
}

/**
 * `ftgetfilelist` reports `datetime` in whatever unit the server build uses:
 * seconds in the TS3 documentation, milliseconds on a real TS6 server
 * (`1790704889930` while the clock read `1790704890` s), and `ftgetfileinfo`
 * on the same server returns nanoseconds. The magnitudes are far enough apart
 * (seconds stay below 1e11 until the year 5138, milliseconds have been above
 * 1e11 since 1973) that the unit can be read off the number itself.
 *
 * Returns milliseconds since the epoch, or 0 when the value is missing.
 */
export function normalizeFileDatetime(raw: number | string | null | undefined): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1e15) return Math.round(value / 1e6); // nanoseconds
  if (value >= 1e11) return Math.round(value); // milliseconds
  return Math.round(value * 1000); // seconds
}
