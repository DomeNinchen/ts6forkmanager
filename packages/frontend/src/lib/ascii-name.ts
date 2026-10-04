// A file name with umlauts or other non-ASCII characters can be uploaded, but a
// TeamSpeak client may then not be able to download it again ("file not found" -
// reproduced with the official client alone). `asciiName` is the offer the upload
// window makes: the same name in plain ASCII.

// Letters whose usual ASCII spelling is not what stripping the accent would give
// (German umlauts: ä is "ae", not "a") or that have nothing to strip at all.
const LETTERS: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss', 'ẞ': 'SS',
  'æ': 'ae', 'Æ': 'Ae', 'œ': 'oe', 'Œ': 'Oe',
  'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th',
  'ł': 'l', 'Ł': 'L', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H',
};

// Punctuation that has a plain counterpart
const PUNCTUATION: Record<string, string> = {
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '«': '"', '»': '"', '‹': "'", '›': "'",
  '©': '(C)', '®': '(R)',
};

const COMBINING_MARKS = /[̀-ͯ]/g;
const isAscii = (text: string) => {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 0x7f) return false;
  }
  return true;
};

function asciiOf(character: string): string | null {
  const direct = LETTERS[character] ?? PUNCTUATION[character];
  if (direct !== undefined) return direct;
  // Accents come off (é -> e, ñ -> n, å -> a), and look-alikes fold to what they stand for
  // (superscript two -> 2, a trademark sign -> TM, the ligature fi -> fi, full-width letters)
  const folded = character.normalize('NFKD').replace(COMBINING_MARKS, '');
  return folded.length > 0 && isAscii(folded) ? folded : null;
}

/**
 * The same name with plain ASCII characters only: umlauts become their usual
 * spelling (ä -> ae, ö -> oe, ü -> ue, ß -> ss), other accents are dropped, and what
 * has no ASCII counterpart (other scripts, emoji) becomes an underscore - a run of
 * them one underscore. A name that is ASCII already comes back unchanged.
 */
export function asciiName(name: string): string {
  // Composed first, so "a" followed by a combining dot pair and "ä" are the same thing
  let result = '';
  let replaced = false;
  for (const character of name.normalize('NFC')) {
    const mapped = character.charCodeAt(0) <= 0x7f ? character : asciiOf(character);
    if (mapped === null) {
      if (!replaced) result += '_';
      replaced = true;
    } else {
      result += mapped;
      replaced = false;
    }
  }
  return result;
}
