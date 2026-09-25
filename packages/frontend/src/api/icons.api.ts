import api from './client';
import type { IconUsageMap, ServerIcon } from '@ts6/common';

const base = (configId: number, sid: number) =>
  `/servers/${configId}/vs/${sid}/icons`;

export interface IconPoolResponse {
  icons: ServerIcon[];
  /** The server's own `i_max_icon_filesize` in bytes, or null if it could not be read. */
  maxFileSize: number | null;
  /** Whether the query identity holds `b_icon_manage`. */
  canManage: boolean;
}

export interface IconUploadResult {
  iconId: number;
  /** True when an icon with these exact bytes was already in the pool. */
  alreadyExisted: boolean;
}

export const iconsApi = {
  list: (configId: number, sid: number): Promise<IconPoolResponse> =>
    api.get(base(configId, sid)).then((r) => r.data),
  usage: (configId: number, sid: number): Promise<IconUsageMap> =>
    api.get(`${base(configId, sid)}/usage`).then((r) => r.data),
  // Icon images are fetched as blobs rather than pointed at with a plain <img
  // src>, because the API requires the Authorization header that only the
  // axios instance carries.
  image: (configId: number, sid: number, iconId: number): Promise<Blob> =>
    api.get(`${base(configId, sid)}/${iconId}/image`, { responseType: 'blob' }).then((r) => r.data),
  upload: (configId: number, sid: number, file: File): Promise<IconUploadResult> => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post(base(configId, sid), form, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },
  delete: (configId: number, sid: number, iconId: number) =>
    api.delete(`${base(configId, sid)}/${iconId}`).then((r) => r.data),
  bulkDelete: (configId: number, sid: number, iconIds: number[]): Promise<{ succeeded: number; failed: number }> =>
    api.post(`${base(configId, sid)}/bulk/delete`, { iconIds }).then((r) => r.data),
};
