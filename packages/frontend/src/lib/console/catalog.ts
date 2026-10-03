import type { CatalogCommand, CatalogEnumValue, CatalogParam, CatalogPropertyGroup } from './catalog-types';
import { SERVERQUERY_COMMANDS, SERVERQUERY_ENUMS, SERVERQUERY_PROPERTIES } from '@/data/serverquery-catalog';

// Lookups over the generated catalog (src/data/serverquery-catalog.ts).

export const COMMANDS: readonly CatalogCommand[] = SERVERQUERY_COMMANDS;

const byName = new Map(COMMANDS.map((command) => [command.name, command]));

export function getCommand(name: string): CatalogCommand | undefined {
  return byName.get(name.toLowerCase());
}

export function getParam(command: CatalogCommand, name: string): CatalogParam | undefined {
  return command.params.find((param) => param.name === name);
}

export function editableProperties(group: CatalogPropertyGroup): readonly string[] {
  return SERVERQUERY_PROPERTIES[group].editable;
}

export function getEnum(name: string): readonly CatalogEnumValue[] | undefined {
  return SERVERQUERY_ENUMS[name];
}

/** What a value of this parameter has to look like, in a few characters: `{1|0}`, `1-3`, `integer`. */
export function describeConstraint(param: CatalogParam): string | null {
  if (param.values && param.values.length > 0) {
    return `{${param.values.map((v) => v.value).join('|')}}`;
  }
  if (param.range) return `${param.range[0]}–${param.range[1]}`;
  if (param.type === 'integer') return 'integer';
  return null;
}

/** The placeholder a usage line would write for the parameter: `clientID`, or an ellipsis when nothing is known. */
export function paramPlaceholder(param: CatalogParam): string {
  return param.hint ?? '…';
}
