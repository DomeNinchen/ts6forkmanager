import { checkFileName, checkRepositoryPath, joinRepositoryPath, type RepositoryPathProblem } from '@ts6/common';
import { asciiName } from './ascii-name';
import { hasNonAscii } from './file-errors';

// What the upload window works with once a folder can be part of an upload. A
// folder is not an item of its own: it is the path in front of the files in it.
// Everything here is plain data in, plain data out, so the window and the
// transfer store can share it and it can be tried without a browser.

/**
 * Most files and empty folders one upload takes. The upload window lists every one
 * of them and the page works through them one by one, so this is about keeping the
 * page usable, not a limit of TeamSpeak's.
 */
export const MAX_UPLOAD_ITEMS = 2000;

/** One file - or one folder with nothing in it - somewhere in what was picked. */
export interface PickedItem {
  /**
   * The names from the topmost folder down to the item itself: `['photos', '2024',
   * 'a.jpg']`. A file picked on its own is just `['a.jpg']`.
   */
  segments: string[];
  /** The file; missing for a folder with nothing in it. */
  file?: File;
}

/** Is the item inside a folder, or a folder itself, rather than a file picked on its own? */
export const isFolderItem = (item: PickedItem) => item.segments.length > 1 || !item.file;

/**
 * What a file input gives back as items. A plain file is just its name; a file
 * from the folder picker (`webkitdirectory`) knows where it sat in the chosen
 * folder, as `photos/2024/a.jpg`.
 */
export function itemsFromFiles(files: File[]): PickedItem[] {
  return files.map((file) => {
    const segments = (file.webkitRelativePath || '').split('/').filter(Boolean);
    return { segments: segments.length > 0 ? segments : [file.name], file };
  });
}

/** Same name, same place, same file - the one that is added twice by accident. */
const itemId = (item: PickedItem) =>
  `${item.segments.join('/')}\u0000${item.file ? `${item.file.size}:${item.file.lastModified}` : 'folder'}`;

/**
 * What the window shows as one row: a file picked on its own, or a folder with
 * everything in it. The choice to upload under plain ASCII names is made per row -
 * for a folder it covers the folder's own name and every name inside it, so that
 * what was one folder stays one folder.
 */
export interface PickGroup {
  key: number;
  /** The topmost name: the file itself, or the folder everything else is in. */
  name: string;
  folder: boolean;
  items: PickedItem[];
  /** Upload under plain ASCII names (only matters where a name has umlauts or the like). */
  adjust: boolean;
}

/** Number of files and empty folders in the groups. */
export const countItems = (groups: PickGroup[]) => groups.reduce((sum, group) => sum + group.items.length, 0);

/**
 * The groups with `picked` added. Items already in the list (same path, size and
 * date) are not added twice, and a folder with the name of one already there is
 * merged into it - dropping a folder again after it grew adds what is new.
 */
export function addToGroups(groups: PickGroup[], picked: PickedItem[], adjust: boolean, newKey: () => number): PickGroup[] {
  const result = groups.map((group) => ({ ...group, items: [...group.items] }));
  const known = new Map<PickGroup, Set<string>>();
  const idsOf = (group: PickGroup) => {
    let ids = known.get(group);
    if (!ids) {
      ids = new Set(group.items.map(itemId));
      known.set(group, ids);
    }
    return ids;
  };

  for (const item of picked) {
    const folder = isFolderItem(item);
    const name = item.segments[0];
    const id = itemId(item);
    let group = result.find((candidate) => (
      candidate.folder === folder && candidate.name === name && (folder || itemId(candidate.items[0]) === id)
    ));
    if (!group) {
      group = { key: newKey(), name, folder, items: [], adjust };
      result.push(group);
    }
    const ids = idsOf(group);
    if (ids.has(id)) continue;
    ids.add(id);
    group.items.push(item);
  }
  return result;
}

export type ItemProblem =
  | { kind: 'name'; problem: RepositoryPathProblem }
  | { kind: 'size' }
  | { kind: 'duplicate' };

export interface ResolvedItem {
  item: PickedItem;
  /** The names it will have: the picked ones, or their ASCII spelling when its group is set to adjust. */
  names: string[];
  /** `names` as a path below the folder the upload goes into. */
  path: string;
  /** A picked name has umlauts or other non-ASCII characters. */
  flagged: boolean;
  /** Why it cannot be uploaded, if so; it is then left out. */
  problem: ItemProblem | null;
}

export interface ResolvedGroup {
  group: PickGroup;
  /** The group's topmost name as it will be stored. */
  name: string;
  items: ResolvedItem[];
  /** Items with a problem are not among these. */
  ready: ResolvedItem[];
  /** Files among the ready items, as opposed to empty folders. */
  files: number;
  /** Empty folders among the ready items. */
  emptyFolders: number;
  /** Bytes of the ready files. */
  bytes: number;
  /** Items with umlauts or other non-ASCII characters in their picked names. */
  flagged: number;
}

/**
 * Works out, for everything in the list, the names it ends up with and whether it
 * can be uploaded at all: the names must be acceptable to TeamSpeak, the file not
 * larger than the app takes, and no other item may end up at the same path.
 */
export function resolveGroups(
  groups: PickGroup[],
  { directory, maxUploadBytes }: { directory: string; maxUploadBytes?: number },
): ResolvedGroup[] {
  const taken = new Set<string>();

  return groups.map((group) => {
    const items = group.items.map((item): ResolvedItem => {
      const flagged = item.segments.some(hasNonAscii);
      const names = flagged && group.adjust ? item.segments.map(asciiName) : item.segments;
      const path = names.join('/');

      let problem: ItemProblem | null = null;
      // The names one by one first, so the problem named is the name's; the path as a whole catches its length
      const nameProblem = names.map((name) => checkFileName(name)).find((found) => found !== null)
        ?? checkRepositoryPath(joinRepositoryPath(directory, path));
      if (nameProblem) problem = { kind: 'name', problem: nameProblem };
      else if (item.file && maxUploadBytes !== undefined && item.file.size > maxUploadBytes) problem = { kind: 'size' };
      else if (taken.has(path)) problem = { kind: 'duplicate' };
      if (!problem) taken.add(path);

      return { item, names, path, flagged, problem };
    });

    const ready = items.filter((entry) => !entry.problem);
    return {
      group,
      name: items[0]?.names[0] ?? group.name,
      items,
      ready,
      files: ready.filter((entry) => entry.item.file).length,
      emptyFolders: ready.filter((entry) => !entry.item.file).length,
      bytes: ready.reduce((sum, entry) => sum + (entry.item.file?.size ?? 0), 0),
      flagged: items.filter((entry) => entry.flagged).length,
    };
  });
}

/** What the window hands over to start: every ready item with the names it ends up with. */
export function readyItems(resolved: ResolvedGroup[]): PickedItem[] {
  return resolved.flatMap((entry) => entry.ready.map(({ item, names }) => ({ segments: names, file: item.file })));
}

/**
 * Every folder the items sit in or are, each once and parents before children, as
 * the names from the first level down. This is what has to exist before the
 * first file of a folder upload can go up (TeamSpeak's `ftcreatedir` makes one
 * level at a time).
 */
export function foldersNeeded(items: PickedItem[]): string[][] {
  const seen = new Set<string>();
  const folders: string[][] = [];
  for (const { segments, file } of items) {
    const depth = file ? segments.length - 1 : segments.length;
    for (let level = 1; level <= depth; level++) {
      const names = segments.slice(0, level);
      const key = names.join('/');
      if (seen.has(key)) continue;
      seen.add(key);
      folders.push(names);
    }
  }
  // Sorting is stable, so within a level the order the items came in stays
  return folders.sort((a, b) => a.length - b.length);
}
