// Shape of the generated ServerQuery catalog (src/data/serverquery-catalog.ts).
//
// The catalog holds facts about the ServerQuery interface - which commands
// exist, which parameters they take and whether those are required, optional
// or repeatable, value ranges, enumerated values, the permissions a command
// needs, and the names of the properties the *edit commands accept. It holds
// no explanatory text: that is TeamSpeak's documentation, which is theirs to
// distribute (see scripts/generate-serverquery-catalog.mjs).

export interface CatalogValue {
  /** The value as it is typed, e.g. "1" or "manage". */
  value: string;
  /** A short name for the value when the source names it, e.g. "Client" for targetmode=1. */
  label?: string;
}

export interface CatalogParam {
  name: string;
  required?: true;
  /** The parameter can be given several times (`clid=1|clid=2` or `permvalue={permValue}...`). */
  repeatable?: true;
  /** The placeholder the usage line writes for the value, e.g. "clientID". */
  hint?: string;
  /** "integer" where the source says so. */
  type?: 'integer';
  range?: [number, number];
  values?: CatalogValue[];
  /** Only the listed values are valid (as opposed to "anything, these are the usual ones"). */
  closed?: true;
  default?: string;
}

export type CatalogPropertyGroup = 'instance' | 'virtualserver' | 'channel' | 'client';

export interface CatalogCommand {
  name: string;
  /** This command is another name for the one listed here. */
  aliasOf?: string;
  /** The server's own `help` overview does not list it. */
  hidden?: true;
  /** Flags without the leading dash, e.g. "uid" for -uid. */
  options: string[];
  params: CatalogParam[];
  /** The command accepts the properties of this group as free-form key=value pairs (serveredit, channeledit, ...). */
  properties?: CatalogPropertyGroup;
  /** Permissions the command checks, by name. */
  permissions: string[];
}

export interface CatalogEnumValue {
  value: string;
  /** The identifier the manual gives the value, without its prefix, e.g. "KICK_SERVER". */
  name: string;
}
