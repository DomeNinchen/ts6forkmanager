import type { DragEvent } from 'react';

/** Something a drag carries that can be uploaded, as opposed to a dragged piece of text or a link. */
export const dragCarriesFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

/**
 * The files of a drop, and how many folders came along (they are not uploaded).
 * The items have to be read right now, inside the event: the browser empties the
 * list as soon as the handler returns.
 */
export function readDroppedFiles(event: DragEvent): { files: File[]; folders: number } {
  const files: File[] = [];
  let folders = 0;
  for (const item of Array.from(event.dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      folders++;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, folders };
}
