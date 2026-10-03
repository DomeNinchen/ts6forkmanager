import { getDangerReason, tsEscape } from '@ts6/common';
import type { CatalogCommand, CatalogParam } from './catalog-types';
import { COMMANDS, describeConstraint, editableProperties, getCommand, getParam, paramPlaceholder } from './catalog';
import { enumValuesFor } from './explain';
import { entityOfField, type EntityItem, type EntityKind } from './entities';

// Autocomplete for the console's input line: which word the caret is in, and
// what could go there - a command, an option, a parameter name, or a value.

export type SuggestionBadge = 'hidden' | 'alias' | 'danger' | 'required' | 'repeatable';

export interface Suggestion {
  kind: 'command' | 'option' | 'param' | 'property' | 'value';
  /** What is listed. */
  label: string;
  /** What goes into the input in place of the word being completed. */
  insert: string;
  /** A short remark next to it: what a parameter takes, or what a value stands for. */
  detail?: string;
  badges?: SuggestionBadge[];
}

export interface Completion {
  /** The part of the input a chosen suggestion replaces. */
  from: number;
  to: number;
  context: 'command' | 'option' | 'param' | 'value' | 'none';
  /** The command being typed or, once it is complete, the one the line is for. */
  command?: CatalogCommand;
  /** The parameter the caret is in the value of. */
  param?: { key: string; spec?: CatalogParam };
  suggestions: Suggestion[];
  /** Values for this parameter can be offered from the server's own data. */
  entity?: EntityKind;
  /** What has been typed of the word so far (for filtering values that arrive later). */
  prefix: string;
}

const MAX_COMMAND_SUGGESTIONS = 60;
const MAX_PROPERTY_SUGGESTIONS = 40;

const isBreak = (ch: string): boolean => /\s/.test(ch) || ch === '|';

/** Prefix matches first, then matches anywhere in the word; both alphabetical. */
function rank<T>(items: readonly T[], text: (item: T) => string, prefix: string): T[] {
  const needle = prefix.toLowerCase();
  if (!needle) return [...items];
  const starts: T[] = [];
  const contains: T[] = [];
  for (const item of items) {
    const haystack = text(item).toLowerCase();
    if (haystack.startsWith(needle)) starts.push(item);
    else if (haystack.includes(needle)) contains.push(item);
  }
  return [...starts, ...contains];
}

function commandSuggestion(command: CatalogCommand): Suggestion {
  const badges: SuggestionBadge[] = [];
  if (command.hidden) badges.push('hidden');
  if (command.aliasOf) badges.push('alias');
  if (getDangerReason(command.name)) badges.push('danger');
  const required = command.params.filter((param) => param.required).map((param) => `${param.name}=`);
  return {
    kind: 'command',
    label: command.name,
    insert: command.name,
    detail: command.aliasOf ? `= ${command.aliasOf}` : required.join(' ') || undefined,
    badges,
  };
}

function paramSuggestion(param: CatalogParam): Suggestion {
  const constraint = describeConstraint(param);
  const badges: SuggestionBadge[] = [];
  if (param.required) badges.push('required');
  if (param.repeatable) badges.push('repeatable');
  return {
    kind: 'param',
    label: `${param.name}=`,
    insert: `${param.name}=`,
    detail: constraint && param.closed ? constraint : `{${paramPlaceholder(param)}}`,
    badges,
  };
}

function valueSuggestions(values: readonly { value: string; label?: string }[], prefix: string): Suggestion[] {
  return rank(values, (entry) => `${entry.value} ${entry.label ?? ''}`, prefix).map((entry) => ({
    kind: 'value' as const,
    label: entry.value,
    insert: tsEscape(entry.value),
    detail: entry.label,
  }));
}

/** Turns the server's own list (channels, clients, groups ...) into suggestions for the value being typed. */
export function entitySuggestions(items: readonly EntityItem[], prefix: string, key: string): Suggestion[] {
  const needle = prefix.toLowerCase();
  const matches = items.filter(
    (item) => !needle || item.id.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle),
  );
  return matches.slice(0, 200).map((item) => {
    // `permid` takes the number, every other kind of id the item's own id.
    const value = key === 'permid' && item.detail ? item.detail : item.id;
    return {
      kind: 'value' as const,
      label: value,
      insert: tsEscape(value),
      detail: item.name === value ? item.detail : item.name,
    };
  });
}

export function analyzeInput(text: string, caret: number, force = false): Completion {
  let start = caret;
  while (start > 0 && !isBreak(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && !isBreak(text[end])) end++;
  const prefix = text.slice(start, caret);

  const lead = text.length - text.trimStart().length;
  let commandEnd = lead;
  while (commandEnd < text.length && !isBreak(text[commandEnd])) commandEnd++;

  // --- The command name itself
  if (caret <= commandEnd) {
    if (!prefix && !force) return { from: start, to: end, context: 'command', suggestions: [], prefix };
    const commandPrefix = prefix.toLowerCase();
    return {
      from: start,
      to: end,
      context: 'command',
      prefix,
      suggestions: rank(COMMANDS, (command) => command.name, commandPrefix)
        .slice(0, MAX_COMMAND_SUGGESTIONS)
        .map(commandSuggestion),
    };
  }

  const command = getCommand(text.slice(lead, commandEnd));
  if (!command) return { from: start, to: end, context: 'none', suggestions: [], prefix };

  // `help clientlist`: the one command whose argument is another command's name.
  if (command.name === 'help') {
    return {
      from: start,
      to: end,
      context: 'command',
      command,
      prefix,
      suggestions: rank(COMMANDS, (candidate) => candidate.name, prefix).slice(0, MAX_COMMAND_SUGGESTIONS).map(commandSuggestion),
    };
  }

  // --- Which block of a `a=1|a=2` list the caret is in, and what that block already has
  const before = text.slice(commandEnd, start);
  const lastPipe = before.lastIndexOf('|');
  const blockIndex = before.split('|').length - 1;
  const blockText = lastPipe === -1 ? before : before.slice(lastPipe + 1);
  const words = blockText.split(/\s+/).filter(Boolean);
  const usedKeys = new Set(words.filter((word) => !word.startsWith('-') && word.includes('=')).map((word) => word.slice(0, word.indexOf('='))));
  const usedOptions = new Set(text.split(/\s+/).filter((word) => word.startsWith('-')));

  // --- An option: -uid
  if (prefix.startsWith('-')) {
    const typed = prefix.slice(1);
    const options = command.options
      .filter((option) => !usedOptions.has(`-${option}`))
      .filter((option) => option.toLowerCase().startsWith(typed.toLowerCase()));
    return {
      from: start,
      to: end,
      context: 'option',
      command,
      prefix,
      suggestions: options.map((option) => ({ kind: 'option' as const, label: `-${option}`, insert: `-${option}` })),
    };
  }

  // --- A value: key=<here>
  const eq = prefix.indexOf('=');
  if (eq !== -1) {
    const key = prefix.slice(0, eq);
    const spec = getParam(command, key);
    const valuePrefix = prefix.slice(eq + 1);
    const base = { from: start + eq + 1, to: end, context: 'value' as const, command, param: { key, spec }, prefix: valuePrefix };

    const values = spec?.values ?? enumValuesFor(key)?.map((entry) => ({ value: entry.value, label: entry.name }));
    if (values && values.length > 0) return { ...base, suggestions: valueSuggestions(values, valuePrefix) };

    const flagValues = /^(?:channel_flag_\w+|channel_forced_silence|client_is_\w+|virtualserver_(?:autostart|weblist_enabled|log_\w+))$/.test(key)
      ? [{ value: '1' }, { value: '0' }]
      : null;
    if (flagValues) return { ...base, suggestions: valueSuggestions(flagValues, valuePrefix) };

    return { ...base, suggestions: [], entity: entityOfField(key) };
  }

  // --- A parameter name
  const params = command.params.filter((param) => !usedKeys.has(param.name) && (blockIndex === 0 || param.repeatable));
  const typedName = prefix.toLowerCase();
  const named = rank(params, (param) => param.name, typedName);
  const required = named.filter((param) => param.required);
  const optional = named.filter((param) => !param.required);

  const suggestions: Suggestion[] = [...required, ...optional].map(paramSuggestion);

  if (blockIndex === 0 && (prefix === '' || force)) {
    for (const option of command.options) {
      if (!usedOptions.has(`-${option}`)) suggestions.push({ kind: 'option', label: `-${option}`, insert: `-${option}` });
    }
  }
  if (command.properties && blockIndex === 0 && (prefix !== '' || force)) {
    const names = editableProperties(command.properties).filter((name) => !usedKeys.has(name));
    for (const name of rank(names, (candidate) => candidate, typedName).slice(0, MAX_PROPERTY_SUGGESTIONS)) {
      suggestions.push({ kind: 'property', label: `${name}=`, insert: `${name}=` });
    }
  }

  return { from: start, to: end, context: 'param', command, prefix, suggestions };
}

/** Puts a chosen suggestion into the input; returns the new text and where the caret goes. */
export function applySuggestion(text: string, completion: Completion, suggestion: Suggestion): { text: string; caret: number } {
  // A command or a finished value is followed by a space, ready for the next word;
  // a parameter name ends in "=" and waits for its value right there.
  const needsSpace = suggestion.kind === 'command' || suggestion.kind === 'option' || suggestion.kind === 'value';
  const after = text.slice(completion.to);
  const gap = needsSpace && !/^[\s|]/.test(after) ? ' ' : '';
  const inserted = suggestion.insert + gap;
  const next = text.slice(0, completion.from) + inserted + after;
  return { text: next, caret: completion.from + inserted.length };
}
