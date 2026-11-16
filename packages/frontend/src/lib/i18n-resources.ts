// Crowdin exports strings nobody has translated yet as empty values ("" or an
// array of "") once untranslated strings are downloaded too. i18next treats ""
// as a real translation and would render blank text instead of falling back
// to English, so drop those entries before handing the resources over.

type Tree = Record<string, unknown>;

function isUntranslated(value: unknown): boolean {
  if (value === '') return true;
  // A list (e.g. a select's options) is only usable when every item is
  // translated - a half-blank list falls back to English as a whole.
  return Array.isArray(value) && value.some((item) => item === '');
}

/** Copy of a translation tree without untranslated entries; branches left
 * empty by that are dropped as well. */
export function pruneUntranslated(tree: Tree): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(tree)) {
    if (isUntranslated(value)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const child = pruneUntranslated(value as Tree);
      if (Object.keys(child).length > 0) out[key] = child;
      continue;
    }
    out[key] = value;
  }
  return out;
}
