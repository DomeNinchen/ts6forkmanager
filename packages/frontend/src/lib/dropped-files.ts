import type { DragEvent } from 'react';
import { MAX_UPLOAD_ITEMS, type PickedItem } from './upload-tree';

/** Something a drag carries that can be uploaded, as opposed to a dragged piece of text or a link. */
export const dragCarriesFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

export interface DroppedFiles {
  items: PickedItem[];
  /** There were more files and folders than one upload takes; what is in `items` is only the beginning. */
  tooMany: boolean;
}

type Root = { entry: FileSystemEntry } | { file: File };

// A directory reader hands out its entries in batches (Chrome: at most 100 at a
// time) and says it is through with an empty one
const readAll = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => {
    const entries: FileSystemEntry[] = [];
    const next = () => reader.readEntries((batch) => {
      if (batch.length === 0) resolve(entries);
      else {
        entries.push(...batch);
        next();
      }
    }, reject);
    next();
  });

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function walk(entry: FileSystemEntry, parents: string[], found: PickedItem[], budget: { left: number }): Promise<void> {
  if (budget.left <= 0) return;
  const segments = [...parents, entry.name];
  if (entry.isFile) {
    budget.left--;
    found.push({ segments, file: await fileOf(entry as FileSystemFileEntry) });
    return;
  }
  const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
  if (children.length === 0) {
    // A folder with nothing in it is still part of what was dropped
    budget.left--;
    found.push({ segments });
    return;
  }
  for (const child of children) await walk(child, segments, found, budget);
}

async function readRoots(roots: Root[]): Promise<DroppedFiles> {
  const found: PickedItem[] = [];
  // One more than fits, to tell "exactly this many" from "more than this"
  const budget = { left: MAX_UPLOAD_ITEMS + 1 };
  for (const root of roots) {
    if ('file' in root) {
      budget.left--;
      found.push({ segments: [root.file.name], file: root.file });
    } else {
      await walk(root.entry, [], found, budget);
    }
  }
  return { items: found.slice(0, MAX_UPLOAD_ITEMS), tooMany: found.length > MAX_UPLOAD_ITEMS };
}

/**
 * The files and folders of a drop, folders read all the way down: every file with
 * the names of the folders it sits in, and a folder with nothing in it as such.
 *
 * What the drop carries has to be taken out right now, inside the event: the
 * browser empties the list as soon as the handler returns. Reading the inside of
 * a folder takes longer, which is why this answers later.
 */
export function readDroppedFiles(event: DragEvent): Promise<DroppedFiles> {
  const roots: Root[] = [];
  for (const item of Array.from(event.dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.() ?? null;
    if (entry?.isDirectory) {
      roots.push({ entry });
      continue;
    }
    const file = item.getAsFile();
    if (file) roots.push({ file });
  }
  return readRoots(roots);
}
