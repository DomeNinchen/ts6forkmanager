#!/usr/bin/env node
// Generates src/data/serverquery-catalog.ts - the facts the query console's
// autocomplete and parameter help run on - from the documentation that ships
// with a TeamSpeak 6 server:
//
//   --docs <dir>      the server's `serverquerydocs` folder: one <command>.txt per
//                     command, exactly what the server's own `help` command prints
//                     (its path is the server's `serverquerydocs_path` setting)
//   --manual <file>   the server's ServerQuery manual, `doc/server/serverquery/serverquery.html`
//                     (for the property names of the *edit commands and the enums)
//   --out <file>      where to write; default: src/data/serverquery-catalog.ts
//
// Only facts are taken over: command and parameter names, what is required,
// optional or repeatable, value ranges, enumerated values with their short
// names, the permission names a command checks, and which commands are aliases
// or missing from the server's own help overview. No documentation text is
// copied - that is TeamSpeak's to distribute, not this repository's. To cover a
// newer server, point the script at that server's folders and run it again:
//
//   node packages/frontend/scripts/generate-serverquery-catalog.mjs \
//        --docs /path/to/serverquerydocs --manual /path/to/serverquery.html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { out: path.resolve(here, '../src/data/serverquery-catalog.ts') };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--docs') args.docs = argv[++i];
    else if (flag === '--manual') args.manual = argv[++i];
    else if (flag === '--out') args.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!args.docs || !args.manual) {
    throw new Error('Usage: generate-serverquery-catalog.mjs --docs <serverquerydocs dir> --manual <serverquery.html> [--out <file>]');
  }
  return args;
}

const warnings = [];
const warn = (message) => warnings.push(message);

// ---------------------------------------------------------------------------
// The docs folder
// ---------------------------------------------------------------------------

/** The `help` overview: which commands it lists, and which ones it calls an alias of another. */
function parseOverview(helpText) {
  const listed = new Set();
  const aliases = new Map();
  for (const line of helpText.split(/\r?\n/)) {
    const match = /^\s{2,}([a-z0-9_]+)\s+\|\s*(.*)$/.exec(line);
    if (!match) continue;
    listed.add(match[1]);
    const alias = /^alias for ([a-z0-9_]+)/i.exec(match[2].trim());
    if (alias) aliases.set(match[1], alias[1].toLowerCase());
  }
  return { listed, aliases };
}

const HEADING = /^(Usage|Permissions|Description|Parameters|Example|Examples):\s*(.*)$/;

function splitSections(text) {
  const sections = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = heading[1];
      sections[current] = heading[2] ? [heading[2]] : [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  return sections;
}

/** Splits at `separator`, but only outside of {...}, (...) and [...]. */
function splitOutside(text, isSeparator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if ('{(['.includes(ch)) depth++;
    else if ('})]'.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && isSeparator(ch)) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

const LITERAL = /^[a-z0-9*_]+$/;

/** `{1|0}`, `{manage|write|read}`, `{1-3}`, `{clientID}`, `({mytsid}|empty)`, `0-1`, `secret` ... */
function parseValueSpec(spec) {
  const result = {};
  let rest = spec;
  if (rest.endsWith('...')) {
    result.repeatable = true;
    rest = rest.slice(0, -3);
  }

  let inner = rest;
  let match;
  if ((match = /^\{(.*)\}$/.exec(rest))) {
    inner = match[1];
  } else if ((match = /^\((.*)\)$/.exec(rest))) {
    inner = match[1];
  }

  const range = /^(\d+)-(\d+)$/.exec(inner);
  if (range) {
    result.range = [Number(range[1]), Number(range[2])];
    return result;
  }

  const alternatives = splitOutside(inner, (ch) => ch === '|');
  if (alternatives.length === 0) return result;

  const values = [];
  const hints = [];
  for (const alternative of alternatives) {
    const wasBraced = /^\{.*\}$/.test(alternative);
    const text = wasBraced ? alternative.slice(1, -1) : alternative;
    // One alternative on its own is always a placeholder ("text"), and a braced
    // one inside a larger group is too; literal values need company.
    if (!wasBraced && alternatives.length > 1 && LITERAL.test(text)) values.push({ value: text });
    else hints.push(text);
  }
  if (values.length) result.values = values;
  // A number is an example value (`cid=123`), not a name for the parameter.
  if (hints.length && !hints.every((hint) => /^\d+$/.test(hint))) result.hint = hints.join('|');
  // Only literals in the whole group: that is the complete list of valid values.
  if (values.length && !hints.length) result.closed = true;
  // `{1|0}` / `{4|5}` style groups are numbers.
  if (values.length && values.every((v) => /^\d+$/.test(v.value))) result.type = 'integer';
  return result;
}

/**
 * One usage form (everything after the command name) into options and parameters.
 * Returns { options: Set, params: Map(name -> spec), properties? }.
 */
function parseForm(tokens, commandName) {
  const form = { options: new Set(), params: new Map(), properties: undefined };

  const addParam = (name, valueSpec, optional, occurrencesInToken) => {
    const spec = valueSpec === undefined ? {} : parseValueSpec(valueSpec);
    const existing = form.params.get(name);
    const param = existing ?? { name, required: !optional };
    if (existing) {
      // The same parameter twice in one usage form is the list notation: `sgid={groupID}|sgid={groupID}`.
      param.repeatable = true;
    }
    if (spec.repeatable || occurrencesInToken > 1) param.repeatable = true;
    for (const key of ['hint', 'range', 'values', 'closed', 'type']) {
      if (spec[key] !== undefined && param[key] === undefined) param[key] = spec[key];
    }
    form.params.set(name, param);
  };

  const handleTerm = (term, optional) => {
    if (term.startsWith('[') && term.endsWith(']')) {
      for (const inner of splitOutside(term.slice(1, -1), (ch) => /\s/.test(ch))) handleTerm(inner, true);
      return;
    }
    if (/^-[A-Za-z0-9_]+$/.test(term)) {
      form.options.add(term.slice(1));
      return;
    }
    const group = /^([a-z]+)_properties\.\.\.$/.exec(term);
    if (group) {
      form.properties = group[1];
      return;
    }
    if (/^\{.*\}$/.test(term)) return; // positional placeholder of a legacy form: `login {username} {password}`
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(term)) {
      addParam(term, undefined, optional, 1); // a bare key such as `virtualserver_snapshot`
      return;
    }

    // key=value terms, possibly several joined by pipes: `cid={channelID}|scid={special channelID}`
    const pieces = splitOutside(term, (ch) => ch === '|');
    const counts = new Map();
    for (const piece of pieces) {
      const eq = piece.indexOf('=');
      if (eq === -1) {
        warn(`${commandName}: could not read usage term "${piece}"`);
        continue;
      }
      const key = piece.slice(0, eq);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const seen = new Set();
    for (const piece of pieces) {
      const eq = piece.indexOf('=');
      if (eq === -1) continue;
      const key = piece.slice(0, eq);
      if (seen.has(key)) continue;
      seen.add(key);
      // Different keys joined by a pipe are alternatives: neither is required on its own.
      addParam(key, piece.slice(eq + 1), optional || counts.size > 1, counts.get(key));
    }
  };

  for (const token of tokens) handleTerm(token, false);
  return form;
}

function parseUsage(name, usageLines) {
  // Forms: the first line, plus every further line that starts over with the command name.
  const forms = [];
  usageLines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const startsForm = line === name || line.startsWith(`${name} `);
    if (startsForm) {
      forms.push(line.slice(name.length).trim());
    } else if (index === 0) {
      warn(`${name}: usage does not start with the command name: "${line}"`);
      forms.push(line);
    } else if (forms.length) {
      forms[forms.length - 1] += ` ${line}`;
    }
  });

  const parsed = forms.map((text) => parseForm(splitOutside(text, (ch) => /\s/.test(ch)), name));

  // A parameter is required only if every form requires it.
  const params = new Map();
  for (const form of parsed) {
    for (const [paramName, param] of form.params) {
      const merged = params.get(paramName) ?? { ...param, required: true };
      if (params.has(paramName)) {
        if (param.repeatable) merged.repeatable = true;
        for (const key of ['hint', 'range', 'values', 'closed', 'type']) {
          if (param[key] !== undefined && merged[key] === undefined) merged[key] = param[key];
        }
      }
      params.set(paramName, merged);
    }
  }
  for (const [paramName, merged] of params) {
    merged.required = parsed.every((form) => form.params.get(paramName)?.required === true);
    params.set(paramName, merged);
  }

  const options = new Set();
  let properties;
  for (const form of parsed) {
    for (const option of form.options) options.add(option);
    if (form.properties) properties = form.properties;
  }
  return { options: [...options], params: [...params.values()], properties };
}

function parsePermissions(lines) {
  const names = [];
  for (const line of lines) {
    if (!line.trim()) break;
    const words = line.trim().split(/\s+/);
    if (!/^[a-z]_[a-z0-9_]+$/.test(words[0])) continue;
    // Some lines leave a gap where the name varies: `i_ft_needed_file_ download _power`.
    // Joined up, that is the name of the permission for downloads.
    let name = words[0];
    let next = 1;
    while (name.endsWith('_') && next < words.length) name += words[next++];
    while (next < words.length && words[next].startsWith('_')) name += words[next++];
    names.push(name);
  }
  return names;
}

/** Type, enumerated values and default out of one entry of a `Parameters:` section. */
function parseParamFacts(text) {
  const facts = {};
  let rest = text.trim();

  const type = /^integer\s*:\s*/i.exec(rest);
  if (type) {
    facts.type = 'integer';
    rest = rest.slice(type[0].length);
  }

  // A list of backticked values right at the start is the set of valid values.
  // A backticked word further into a sentence ("default `14`") is not.
  if (rest.startsWith('`')) {
    const values = [];
    // No greedy whitespace after the closing backtick: " or " needs its leading space to be matched as a separator.
    const item = /^\s*`([^`]+)`(?:\s*\(([^)]*)\))?(?:\s*,\s*|\s*;\s*|\s+or\s+|\s+and\s+)?/;
    let match;
    while (/^\s*`/.test(rest) && (match = item.exec(rest))) {
      values.push(match[2] ? { value: match[1], label: match[2].trim() } : { value: match[1] });
      rest = rest.slice(match[0].length);
    }
    if (values.length) {
      facts.values = values;
      facts.closed = true;
    }
  }

  const fallback = /Default\s*:\s*`([^`]*)`/i.exec(text) ?? /\bdefault\s+`([^`]*)`/.exec(text);
  if (fallback) facts.default = fallback[1];
  return facts;
}

function applyParameterFacts(command, parameterLines) {
  const entries = [];
  for (const line of parameterLines) {
    const entry = /^\s{2}(-?[A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (entry) entries.push({ name: entry[1], text: entry[2] });
  }
  for (const { name, text } of entries) {
    const param = command.params.find((candidate) => candidate.name === name);
    if (!param) continue; // an option, or a property of a *edit command: those come from the manual
    const facts = parseParamFacts(text);
    if (facts.type && !param.type) param.type = facts.type;
    if (facts.values) {
      param.values = facts.values;
      param.closed = true;
      // "{1-3}" plus a named list of exactly those values: the names say more than the range does.
      delete param.range;
    }
    if (facts.default !== undefined) param.default = facts.default;
  }
}

function readCommand(name, text, overview) {
  const sections = splitSections(text);
  const usageLines = [];
  for (const line of sections.Usage ?? []) {
    if (!line.trim()) break;
    usageLines.push(line);
  }
  if (usageLines.length === 0) warn(`${name}: no Usage line found`);

  const usage = parseUsage(name, usageLines);
  const command = {
    name,
    ...(overview.aliases.has(name) ? { aliasOf: overview.aliases.get(name) } : {}),
    ...(overview.listed.has(name) ? {} : { hidden: true }),
    options: usage.options,
    params: usage.params,
    ...(usage.properties ? { properties: usage.properties } : {}),
    permissions: parsePermissions(sections.Permissions ?? []),
  };
  applyParameterFacts(command, sections.Parameters ?? []);

  // Tidy: drop the `required: false` noise and order the keys the same way every time.
  command.params = command.params.map((param) => {
    const ordered = { name: param.name };
    if (param.required) ordered.required = true;
    if (param.repeatable) ordered.repeatable = true;
    for (const key of ['hint', 'type', 'range', 'values', 'closed', 'default']) {
      if (param[key] !== undefined) ordered[key] = param[key];
    }
    return ordered;
  });
  return command;
}

// ---------------------------------------------------------------------------
// The manual
// ---------------------------------------------------------------------------

const PROPERTY_SECTIONS = {
  instance: 'server_instance_properties',
  virtualserver: 'virtual_server_properties',
  channel: 'channel_properties',
  client: 'client_properties',
};

// The manual does not match the server in a few places. Both lists below were
// established against a running TeamSpeak 6 server, 6.0.0-beta13.1 (build 1790080330):
// the names from what instanceinfo / serverinfo actually report, and the additions
// by "editing" the property to the value it already had and getting code 0 back.

/** Names the manual misspells or has wrong, as the server reports them. */
const PROPERTY_NAME_CORRECTIONS = {
  serverinstance_max_download_total_bandwitdh: 'serverinstance_max_download_total_bandwidth',
  serverinstance_max_upload_total_bandwitdh: 'serverinstance_max_upload_total_bandwidth',
  serverinstance_serverquery_flood_ban_time: 'serverinstance_serverquery_ban_time',
  virtualserver_unique_identifer: 'virtualserver_unique_identifier',
};

/** Properties the manual does not list although the edit commands accept them. */
const PROPERTY_ADDITIONS = {
  virtualserver: [
    'virtualserver_log_channel',
    'virtualserver_log_client',
    'virtualserver_log_filetransfer',
    'virtualserver_log_permissions',
    'virtualserver_log_query',
    'virtualserver_log_server',
  ],
  channel: ['channel_banner_gfx_url', 'channel_banner_mode', 'channel_codec', 'channel_codec_latency_factor'],
};

/**
 * "PermGroupDBTypeTemplate", "PermGroupDBTypeRegular", ... -> "Template", "Regular", ...:
 * a CamelCase prefix every name of an enum shares says nothing about the single value.
 * Only cut where the next letter starts a new word, and never a prefix that ends in an
 * underscore - "KICK_CHANNEL" / "KICK_SERVER" say more than "CHANNEL" / "SERVER".
 */
function stripSharedPrefix(values) {
  if (values.length < 2) return values;
  const names = values.map((v) => v.name);
  let length = 0;
  while (names.every((n) => n[length] !== undefined && n[length] === names[0][length])) length++;
  while (length > 0 && !names.every((n) => /[A-Z]/.test(n[length] ?? ''))) length--;
  if (length < 4 || names[0][length - 1] === '_') return values;
  return values.map((v) => ({ ...v, name: v.name.slice(length) }));
}

function parseManual(html) {
  const properties = {};
  for (const [group, id] of Object.entries(PROPERTY_SECTIONS)) {
    const start = html.indexOf(`<h1 id="${id}">`);
    if (start === -1) {
      warn(`manual: section ${id} not found`);
      properties[group] = { editable: [], readOnly: [] };
      continue;
    }
    const end = html.indexOf('<h1 id="', start + 10);
    const section = html.slice(start, end === -1 ? undefined : end);
    const editable = [];
    const readOnly = [];
    const row = /<p class="property_name">\s*([A-Za-z0-9_]+)\s*<\/p>[\s\S]*?<p class="property_changable">\s*(Yes|No)\s*<\/p>/g;
    let match;
    while ((match = row.exec(section))) {
      const name = match[1].toLowerCase();
      (match[2] === 'Yes' ? editable : readOnly).push(PROPERTY_NAME_CORRECTIONS[name] ?? name);
    }
    editable.push(...(PROPERTY_ADDITIONS[group] ?? []));
    properties[group] = { editable: [...new Set(editable)].sort(), readOnly: [...new Set(readOnly)].sort() };
  }

  const enums = {};
  const enumBlock = /<p class="enum_name">enum\s+(\w+)\s*\{<\/p>([\s\S]*?)<p class="enum_name">\};<\/p>/g;
  let block;
  while ((block = enumBlock.exec(html))) {
    const values = [];
    let next = 0;
    const option = /<p class="enum_option_name">\s*([A-Za-z0-9_]+)\s*(?:=\s*(-?\d+))?\s*,?\s*<\/p>/g;
    let match;
    while ((match = option.exec(block[2]))) {
      const value = match[2] !== undefined ? Number(match[2]) : next;
      next = value + 1;
      // "HostMessageMode_LOG" -> "LOG"; a name without any underscore stays whole.
      values.push({ value: String(value), name: match[1].replace(/^[A-Za-z]+_/, '') });
    }
    enums[block[1]] = stripSharedPrefix(values);
  }
  return { properties, enums };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function emit({ commands, properties, enums }) {
  const lines = [];
  lines.push('// GENERATED FILE - do not edit by hand.');
  lines.push('// Regenerate with packages/frontend/scripts/generate-serverquery-catalog.mjs (see its header).');
  lines.push('//');
  lines.push('// Facts about the TeamSpeak 6 ServerQuery interface, read from the documentation that ships with the');
  lines.push('// server: command and parameter names, what is required, optional or repeatable, value ranges,');
  lines.push('// enumerated values, the permissions a command checks, and the property names of the *edit commands.');
  lines.push('// It contains no documentation text.');
  lines.push('');
  lines.push("import type { CatalogCommand, CatalogEnumValue, CatalogPropertyGroup } from '@/lib/console/catalog-types';");
  lines.push('');
  lines.push('export const SERVERQUERY_COMMANDS: CatalogCommand[] = [');
  for (const command of commands) lines.push(`  ${JSON.stringify(command)},`);
  lines.push('];');
  lines.push('');
  lines.push('/** Property names by group; editable ones can be set with the matching *edit command. */');
  lines.push('export const SERVERQUERY_PROPERTIES: Record<CatalogPropertyGroup, { editable: string[]; readOnly: string[] }> = {');
  for (const [group, lists] of Object.entries(properties)) lines.push(`  ${group}: ${JSON.stringify(lists)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** The enumerations of the manual\'s "Definitions" chapter, by name. */');
  lines.push('export const SERVERQUERY_ENUMS: Record<string, CatalogEnumValue[]> = {');
  for (const [name, values] of Object.entries(enums)) lines.push(`  ${name}: ${JSON.stringify(values)},`);
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);

  const files = fs.readdirSync(args.docs).filter((file) => file.endsWith('.txt')).sort();
  const helpFile = path.join(args.docs, 'help.txt');
  if (!fs.existsSync(helpFile)) throw new Error(`No help.txt in ${args.docs} - is this the serverquerydocs folder?`);
  const overview = parseOverview(fs.readFileSync(helpFile, 'utf8'));

  const commands = [];
  for (const file of files) {
    const name = file.replace(/\.txt$/, '');
    if (name === 'help') {
      // `help` itself is a command too; its doc file is the overview, so it has no usage section of its own.
      commands.push({ name, options: [], params: [{ name: 'command' }], permissions: [] });
      continue;
    }
    commands.push(readCommand(name, fs.readFileSync(path.join(args.docs, file), 'utf8'), overview));
  }

  const { properties, enums } = parseManual(fs.readFileSync(args.manual, 'utf8'));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, emit({ commands, properties, enums }), 'utf8');

  const hidden = commands.filter((c) => c.hidden).map((c) => c.name);
  const aliases = commands.filter((c) => c.aliasOf).map((c) => `${c.name}->${c.aliasOf}`);
  console.log(`${commands.length} commands written to ${args.out}`);
  console.log(`hidden from help (${hidden.length}): ${hidden.join(', ')}`);
  console.log(`aliases (${aliases.length}): ${aliases.join(', ')}`);
  for (const [group, lists] of Object.entries(properties)) {
    console.log(`properties ${group}: ${lists.editable.length} editable, ${lists.readOnly.length} read-only`);
  }
  console.log(`enums (${Object.keys(enums).length}): ${Object.keys(enums).join(', ')}`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const message of warnings) console.log(`  - ${message}`);
  }
}

main();
