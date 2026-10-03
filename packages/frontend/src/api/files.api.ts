import api from './client';
import type { FileTransferLimits, ServerFileEntry } from '@ts6/common';

const base = (configId: number, sid: number) =>
  `/servers/${configId}/vs/${sid}/files`;

export interface DownloadLink {
  /** Same-origin URL the browser can simply open; good for one use, for about a minute. */
  url: string;
  name: string;
  size: number;
}

export const filesApi = {
  list: (configId: number, sid: number, cid: number, path = '/'): Promise<ServerFileEntry[]> =>
    api.get(`${base(configId, sid)}/${cid}`, { params: { path } }).then((r) => r.data),
  limits: (configId: number, sid: number): Promise<FileTransferLimits> =>
    api.get(`${base(configId, sid)}/limits`).then((r) => r.data),
  createDir: (configId: number, sid: number, cid: number, dirname: string) =>
    api.post(`${base(configId, sid)}/${cid}/mkdir`, { dirname }).then((r) => r.data),
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
  // file in memory first.
  createDownloadLink: (configId: number, sid: number, cid: number, path: string): Promise<DownloadLink> =>
    api.post(`${base(configId, sid)}/${cid}/download-links`, { path }).then((r) => r.data),
};
