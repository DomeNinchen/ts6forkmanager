import api from './client';
import type { FileTransferLimits, ServerFileEntry } from '@ts6/common';

const base = (configId: number, sid: number) =>
  `/servers/${configId}/vs/${sid}/files`;

export interface DownloadLink {
  /** Same-origin URL the browser can simply open; good for one use, for about a minute. */
  url: string;
  /** What the browser saves it as: the file's name, or `<folder>.zip`. */
  name: string;
  /** Bytes of the file, or of the ZIP of a folder. */
  size: number;
  /** For a folder: how many files and folders the ZIP holds. */
  files?: number;
  folders?: number;
}

/** The answer for one folder of `ensureDirectories`. */
export interface DirectoryResult {
  dirname: string;
  ok: boolean;
  /** Whether it was made now (false: it was already there). */
  created?: boolean;
  /** TeamSpeak's own status code, when it refused. */
  code?: number;
  error?: string;
}

export const filesApi = {
  list: (configId: number, sid: number, cid: number, path = '/'): Promise<ServerFileEntry[]> =>
    api.get(`${base(configId, sid)}/${cid}`, { params: { path } }).then((r) => r.data),
  limits: (configId: number, sid: number): Promise<FileTransferLimits> =>
    api.get(`${base(configId, sid)}/limits`).then((r) => r.data),
  createDir: (configId: number, sid: number, cid: number, dirname: string) =>
    api.post(`${base(configId, sid)}/${cid}/mkdir`, { dirname }).then((r) => r.data),
  // A whole tree of folders in one request, parents first; every folder gets its own
  // answer (see the backend's /mkdirs), so one that cannot be made does not stop the rest
  ensureDirectories: (configId: number, sid: number, cid: number, dirnames: string[], signal?: AbortSignal): Promise<DirectoryResult[]> =>
    api
      .post(`${base(configId, sid)}/${cid}/mkdirs`, { dirnames }, { signal, timeout: 120_000 })
      .then((r) => r.data.results),
  delete: (configId: number, sid: number, cid: number, name: string) =>
    api.delete(`${base(configId, sid)}/${cid}/file`, { data: { name } }).then((r) => r.data),
  move: (configId: number, sid: number, cid: number, name: string, targetCid: number) =>
    api.post(`${base(configId, sid)}/${cid}/move`, { name, targetCid }).then((r) => r.data),

  // An upload is two requests. The first asks the server to agree to the file, so
  // that a name it will not take or a file that is already there is reported
  // before any bytes have been sent; the second carries the bytes themselves.
  prepareUpload: (
    configId: number,
    sid: number,
    cid: number,
    path: string,
    size: number,
    overwrite: boolean,
    signal?: AbortSignal,
  ): Promise<{ uploadId: string }> =>
    api.post(`${base(configId, sid)}/${cid}/uploads`, { path, size, overwrite }, { signal }).then((r) => r.data),
  sendUpload: (
    configId: number,
    sid: number,
    cid: number,
    uploadId: string,
    file: Blob,
    onProgress: (loaded: number) => void,
    signal?: AbortSignal,
  ): Promise<{ path: string; size: number }> =>
    api
      .put(`${base(configId, sid)}/${cid}/uploads/${uploadId}`, file, {
        headers: { 'Content-Type': 'application/octet-stream' },
        // The default 15 s is for small JSON answers; a file takes as long as it takes
        timeout: 0,
        signal,
        onUploadProgress: (event) => onProgress(event.loaded),
      })
      .then((r) => r.data),

  // A download is a link the browser opens itself (see file-downloads.routes.ts
  // in the backend): it streams the file straight to disk, which a request
  // carrying an Authorization header could not do without holding the whole
  // file in memory first. For a folder the answer waits for the backend to look
  // through it (it says how large the ZIP will be), so it gets more than 15 s.
  createDownloadLink: (configId: number, sid: number, cid: number, path: string): Promise<DownloadLink> =>
    api.post(`${base(configId, sid)}/${cid}/download-links`, { path }, { timeout: 120_000 }).then((r) => r.data),

  // The picture itself, for the preview window. It is fetched with the app's own
  // login (an <img> tag cannot send one) and shown from an object URL. The backend
  // only ever sends one of the five browser image formats, recognised by its bytes.
  preview: async (configId: number, sid: number, cid: number, path: string, signal?: AbortSignal): Promise<Blob> => {
    try {
      const response = await api.get<Blob>(`${base(configId, sid)}/${cid}/preview`, {
        params: { path },
        responseType: 'blob',
        // The default 15 s is for small JSON answers; the picture is read from TeamSpeak first
        timeout: 60_000,
        signal,
      });
      return response.data;
    } catch (err: any) {
      // With responseType 'blob' an error answer arrives as a Blob too; read it, so that
      // the usual error texts (they look at `code` and `error`) keep working
      const data = err?.response?.data;
      if (data instanceof Blob) {
        const text = await data.text();
        try {
          err.response.data = JSON.parse(text);
        } catch {
          err.response.data = text;
        }
      }
      throw err;
    }
  },
};
