import type { Writable } from 'node:stream';
import { splitRepositoryPath, joinRepositoryPath, type ServerFileEntry } from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import { ftDownloadStream } from '../ts-client/file-transfer.js';
import { initDownload, listDirectory, type RepositoryScope } from './file-repository.js';
import { ZIP_MAX_ENTRIES, ZipLimitError, ZipWriter, archiveSize } from './zip-stream.js';

// "Download a folder": the folder's tree, walked once to plan the archive, then
// streamed into a ZIP file by file (see zip-stream.ts).

/** Deepest nesting of folders inside the one that is downloaded. */
const MAX_DEPTH = 32;
/** Most folders listed for one archive - every one is a round trip to the TeamSpeak server. */
const MAX_DIRECTORIES = 10_000;

export interface ArchiveEntry {
  /** Where it goes in the archive; a folder's name ends in a slash. */
  name: string;
  /** Where it is in the channel's repository. */
  path: string;
  isDirectory: boolean;
  /** Bytes; 0 for a folder. */
  size: number;
  /** Milliseconds since the epoch, 0 when unknown. */
  modified: number;
}

export interface ArchivePlan {
  entries: ArchiveEntry[];
  files: number;
  folders: number;
  /** The archive's size to the byte - the `Content-Length`. */
  bytes: number;
}

/**
 * A folder too big, too full or too deep to become a ZIP: the request is fine, the
 * archive format (and the time it takes to walk the folder) is not. `details` says
 * which limit it ran into.
 */
export class ArchiveLimitError extends AppError {
  constructor(details: string) {
    super(413, 'This folder is too large to download as a ZIP', details);
  }
}

// What the app itself leaves in a folder while an upload is on its way (see
// tempUploadPath in file-repository.ts): half a file, not part of anybody's folder
const IN_FLIGHT_UPLOAD = /^\.ts6m-upload-[0-9a-f]{12}\.part$/;

/** What a file or folder name may be inside an archive: no separators or control
 * characters that an unzip tool could read as a path (`..\..\x`), and never empty. */
export function zipSegment(name: string): string {
  let result = '';
  for (const character of name) {
    const code = character.codePointAt(0)!;
    const unsafe =
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      character === '\\' ||
      character === '/';
    result += unsafe ? '_' : character;
  }
  return result === '' || result === '.' || result === '..' ? '_' : result;
}

/** `photo.jpg` -> `photo_2.jpg`; a name without an extension just gets the suffix. */
function withSuffix(name: string, number: number, isDirectory: boolean): string {
  const dot = isDirectory ? -1 : name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}_${number}${name.slice(dot)}` : `${name}_${number}`;
}

/**
 * Walk the folder and work out what its archive will hold and how big it will be.
 * Throws {@link ArchiveLimitError} when it cannot be a ZIP at all, so a caller can
 * say so before it has promised anybody a download. `list` is how a folder is read;
 * only a test has a reason to pass another.
 */
export async function planFolderArchive(
  scope: RepositoryScope,
  rootPath: string,
  list: (scope: RepositoryScope, path: string) => Promise<ServerFileEntry[]> = listDirectory,
): Promise<ArchivePlan> {
  const rootName = `${zipSegment(splitRepositoryPath(rootPath).name)}/`;
  const entries: ArchiveEntry[] = [{ name: rootName, path: rootPath, isDirectory: true, size: 0, modified: 0 }];
  const taken = new Set<string>([rootName]);
  let directories = 0;

  const visit = async (path: string, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw new ArchiveLimitError(`Folders nested more than ${MAX_DEPTH} deep`);
    if (++directories > MAX_DIRECTORIES) throw new ArchiveLimitError(`More than ${MAX_DIRECTORIES} folders`);
    for (const child of await list(scope, path)) {
      if (!child.isDirectory && IN_FLIGHT_UPLOAD.test(child.name)) continue;

      // Two names that come out the same after cleaning would overwrite each other when unpacked
      let segment = zipSegment(child.name);
      for (let number = 2; taken.has(`${prefix}${segment}${child.isDirectory ? '/' : ''}`); number++) {
        segment = withSuffix(zipSegment(child.name), number, child.isDirectory);
      }
      const name = `${prefix}${segment}${child.isDirectory ? '/' : ''}`;
      taken.add(name);

      const childPath = joinRepositoryPath(path, child.name);
      entries.push({ name, path: childPath, isDirectory: child.isDirectory, size: child.isDirectory ? 0 : child.size, modified: child.modified });
      if (entries.length > ZIP_MAX_ENTRIES) throw new ArchiveLimitError(`More than ${ZIP_MAX_ENTRIES} files and folders`);
      if (child.isDirectory) await visit(childPath, name, depth + 1);
    }
  };
  await visit(rootPath, rootName, 1);

  let bytes: number;
  try {
    bytes = archiveSize(entries);
  } catch (err) {
    if (err instanceof ZipLimitError) throw new ArchiveLimitError(err.message);
    throw err;
  }
  const folders = entries.filter((entry) => entry.isDirectory).length;
  return { entries, files: entries.length - folders, folders, bytes };
}

/**
 * Write the planned archive into `output` (the HTTP response), one file after the
 * other. A file whose size is not what the plan says has changed since it was
 * listed; the archive was promised at a size, so that is an error, not something to
 * paper over.
 */
export async function streamFolderArchive(scope: RepositoryScope, plan: ArchivePlan, output: Writable): Promise<void> {
  const zip = new ZipWriter(output);
  for (const entry of plan.entries) {
    if (entry.isDirectory) {
      await zip.addDirectory(entry.name, entry.modified);
      continue;
    }
    await zip.addFile(entry.name, entry.size, entry.modified, async (sink) => {
      // A ticket is only good for a few seconds, so each one is asked for right when its file is next
      const { ticket, host } = await initDownload(scope, entry.path);
      if (ticket.size !== entry.size) {
        throw new Error(`${entry.path} changed while the archive was being made (${ticket.size} bytes instead of ${entry.size})`);
      }
      await ftDownloadStream(host, ticket.port, ticket.ftkey, ticket.size, sink);
    });
  }
  await zip.finish();
}
