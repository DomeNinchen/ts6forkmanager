// TeamSpeak ServerQuery string escaping/unescaping
// The query protocol requires special character encoding.
// The table below is the one from the TeamSpeak 6 ServerQuery manual ("Escaping").

const ESCAPE_MAP: [string, string][] = [
  // Must stay first: every replacement below introduces backslashes of its own
  // which must not be escaped a second time.
  ['\\', '\\\\'],
  ['/', '\\/'],
  [' ', '\\s'],
  ['|', '\\p'],
  ['\x07', '\\a'],
  ['\b', '\\b'],
  ['\f', '\\f'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
  ['\x0b', '\\v'],
];

// What the character after a backslash stands for. Keyed by that single
// character, so it is the escape table above read the other way round.
const UNESCAPE_MAP: Record<string, string> = {
  '\\': '\\',
  '/': '/',
  s: ' ',
  p: '|',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\x0b',
};

export function tsEscape(str: string): string {
  let result = str;
  for (const [char, escaped] of ESCAPE_MAP) {
    result = result.split(char).join(escaped);
  }
  return result;
}

/**
 * Reverses tsEscape in a single left-to-right pass. Replacing one escape after
 * another instead (the way this used to work) misreads an escaped backslash
 * followed by a letter: `\\s` is a backslash and an "s", but a later `\s` ->
 * space replacement would happily turn its second half into a space.
 * A backslash followed by anything that is not part of the table, or one at the
 * very end, is left exactly as it is.
 */
export function tsUnescape(str: string): string {
  return str.replace(/\\([\s\S])/g, (match, next: string) => UNESCAPE_MAP[next] ?? match);
}

// Parse a ServerQuery response line into key-value pairs
export function parseQueryResponse(line: string): Record<string, string>[] {
  return line.split('|').map((entry) => {
    const params: Record<string, string> = {};
    for (const part of entry.split(' ')) {
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) {
        params[part] = '';
      } else {
        const key = part.substring(0, eqIndex);
        const value = tsUnescape(part.substring(eqIndex + 1));
        params[key] = value;
      }
    }
    return params;
  });
}
