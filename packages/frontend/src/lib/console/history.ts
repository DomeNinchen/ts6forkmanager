import { isSecretKey, parseQueryLine } from '@ts6/common';

// The command history behind the up and down arrow keys. It lives in this
// browser only (localStorage, one list per user account), and a command that
// carries a password, key or token is never stored at all - this is a
// convenience for retyping, not a place for credentials to end up.

const MAX_ENTRIES = 200;
const storageKey = (userId: number) => `ts6-console-history-${userId}`;

export function loadHistory(userId: number): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '[]');
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string').slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function save(userId: number, history: string[]): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(history.slice(-MAX_ENTRIES)));
  } catch {
    // Storage full or blocked: the history then only lasts while the page is open.
  }
}

/** Whether the line has a non-empty value for a parameter that holds a secret. */
export function carriesSecret(line: string): boolean {
  const parsed = parseQueryLine(line);
  // A line that does not even parse is kept out as well - it may be a half-typed credential.
  if (!parsed.ok) return true;
  return parsed.value.blocks.some((block) => Object.entries(block).some(([key, value]) => value !== '' && isSecretKey(key)));
}

/** Adds a command to the end of the history (unless it is a repeat of the last one or carries a secret). */
export function rememberCommand(userId: number, history: string[], line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || carriesSecret(trimmed) || history[history.length - 1] === trimmed) return history;
  const next = [...history, trimmed].slice(-MAX_ENTRIES);
  save(userId, next);
  return next;
}

export function clearHistory(userId: number): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // Nothing to do: there was nothing stored that could be removed.
  }
}
