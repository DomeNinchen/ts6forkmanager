// Parser and formatter for a ServerQuery command line as an admin types it into
// the query console:
//
//   command [parameter...] [option...]       e.g.  clientlist -uid -away
//   command key=value key=value|key=value    e.g.  clientkick reasonid=5 clid=1|clid=2
//
// Values use the same escape patterns as the real ServerQuery interface
// (`\s` for a space, `\p` for a pipe, ...), and a literal `|` always separates
// two list items. WebQuery itself takes raw, unescaped values, so the parser
// unescapes them here - the caller never sees escape sequences.
//
// Source of the grammar: TeamSpeak 6 ServerQuery manual, "Command Syntax".

import { tsEscape, tsUnescape } from '../utils/ts-escape.js';

/** Command names: lowercase letters, digits and underscores. */
const COMMAND_PATTERN = /^[a-z][a-z0-9_]*$/;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPTION_PATTERN = /^-[A-Za-z0-9_]+$/;
// Keys that would be dangerous as property names on a plain object. No
// TeamSpeak parameter is called like this, so refusing them costs nothing.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type QueryParseErrorCode = 'empty' | 'invalid_command' | 'invalid_option' | 'invalid_key' | 'empty_block';

export interface QueryParseError {
  code: QueryParseErrorCode;
  /** The word that could not be understood ('' for an empty line). */
  detail: string;
  /** Character offset of that word in the text that was passed in. */
  index: number;
}

export type QueryParseWarningCode = 'bare_word' | 'duplicate_key';

export interface QueryParseWarning {
  code: QueryParseWarningCode;
  detail: string;
  index: number;
}

export interface ParsedQueryLine {
  /** Lowercased command name. */
  command: string;
  /** Options with their leading dash, e.g. `-uid`, in the order typed, without duplicates. */
  options: string[];
  /**
   * One record per pipe-separated list item, with unescaped values. Always at
   * least one: a command without parameters has a single empty record. As in
   * ServerQuery itself, parameters shared by all list items are only written in
   * the first record.
   */
  blocks: Record<string, string>[];
  warnings: QueryParseWarning[];
}

export type QueryParseResult = { ok: true; value: ParsedQueryLine } | { ok: false; error: QueryParseError };

function fail(code: QueryParseErrorCode, detail: string, index: number): QueryParseResult {
  return { ok: false, error: { code, detail, index } };
}

export function parseQueryLine(input: string): QueryParseResult {
  const leading = input.length - input.trimStart().length;
  const text = input.trim();
  if (!text) return fail('empty', '', 0);

  const commandWord = /^\S+/.exec(text)![0];
  const command = commandWord.toLowerCase();
  if (!COMMAND_PATTERN.test(command)) return fail('invalid_command', commandWord, leading);

  const rest = text.slice(commandWord.length);
  const restOffset = leading + commandWord.length;

  const options: string[] = [];
  const blocks: Record<string, string>[] = [];
  const warnings: QueryParseWarning[] = [];

  const parts = rest.split('|');
  let partOffset = restOffset;
  for (const part of parts) {
    // A list needs something on both sides of every pipe. A command without any
    // parameters at all ("whoami") is the one case of an empty block that is fine.
    if (parts.length > 1 && !part.trim()) {
      return fail('empty_block', '|', partOffset);
    }

    const block: Record<string, string> = {};
    const words = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = words.exec(part)) !== null) {
      const word = match[0];
      const wordIndex = partOffset + match.index;

      if (word.startsWith('-')) {
        if (!OPTION_PATTERN.test(word)) return fail('invalid_option', word, wordIndex);
        if (!options.includes(word)) options.push(word);
        continue;
      }

      const eq = word.indexOf('=');
      const key = eq === -1 ? word : word.slice(0, eq);
      if (!KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) return fail('invalid_key', key, wordIndex);

      if (Object.prototype.hasOwnProperty.call(block, key)) {
        warnings.push({ code: 'duplicate_key', detail: key, index: wordIndex });
      }
      if (eq === -1) {
        // "clientlist uid": nearly always a forgotten "=" or a forgotten dash.
        warnings.push({ code: 'bare_word', detail: key, index: wordIndex });
        block[key] = '';
      } else {
        block[key] = tsUnescape(word.slice(eq + 1));
      }
    }

    blocks.push(block);
    partOffset += part.length + 1;
  }

  return { ok: true, value: { command, options, blocks, warnings } };
}

export interface FormatQueryLineOptions {
  /** Return true for a parameter whose value must not appear in the output. */
  maskKey?: (key: string) => boolean;
  /** Longer values are cut to this many characters and end in an ellipsis. */
  maxValueLength?: number;
}

/** What replaces a masked value. */
export const MASKED_VALUE = '***';

/**
 * Writes a parsed command back out in ServerQuery syntax, escaped - the form an
 * admin would have typed, normalized. This is what the audit trail and the
 * TeamSpeak server log record, which is why it can mask secrets and shorten
 * long values on the way.
 */
export function formatQueryLine(
  parsed: Pick<ParsedQueryLine, 'command' | 'options' | 'blocks'>,
  options: FormatQueryLineOptions = {},
): string {
  const { maskKey, maxValueLength } = options;

  const renderValue = (key: string, value: string): string => {
    if (value !== '' && maskKey?.(key)) return MASKED_VALUE;
    if (maxValueLength !== undefined && value.length > maxValueLength) {
      return `${tsEscape(value.slice(0, maxValueLength))}…`;
    }
    return tsEscape(value);
  };

  const renderBlock = (block: Record<string, string>): string =>
    Object.entries(block)
      .map(([key, value]) => `${key}=${renderValue(key, value)}`)
      .join(' ');

  const params = parsed.blocks.map(renderBlock).join('|');
  return [parsed.command, ...parsed.options, params].filter((piece) => piece !== '').join(' ');
}
