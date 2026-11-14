// Pure matching and ranking for the global search. No imports, so `node --test` can run it as is.

/** Lower case, accents dropped, ß as ss and spelled-out umlauts (ae/oe/ue) as plain vowels - "uber", "ueber" and "Über" all match. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([aou])e/g, '$1');
}

export interface SearchEntry {
  /** What the entry is found by: the first term is its visible name, the rest (English name, section) count less. */
  terms: string[];
}

/** How well one word of the query fits one term: whole term, start of the term, start of a word in it, anywhere. */
function wordScore(term: string, word: string): number {
  if (term === word) return 4;
  if (term.startsWith(word)) return 3;
  if (term.includes(' ' + word) || term.includes('-' + word)) return 2;
  return term.includes(word) ? 1 : 0;
}

/**
 * The entries every word of the query matches, best first (ties keep their order), at most `limit`.
 * A word counts fully on the visible name and half on the other terms.
 */
export function searchEntries<T extends SearchEntry>(entries: T[], query: string, limit = Infinity): T[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries.slice(0, limit);
  const scored: { entry: T; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const terms = entry.terms.map(foldText);
    let score = 0;
    for (const word of words) {
      const best = Math.max(...terms.map((term, i) => wordScore(term, word) / (i === 0 ? 1 : 2)));
      if (best === 0) return;
      score += best;
    }
    scored.push({ entry, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.entry);
}

/** The recent list after opening `id`: it moves to the front, duplicates go, at most `max` stay. */
export function pushRecent(recent: string[], id: string, max = 5): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}
