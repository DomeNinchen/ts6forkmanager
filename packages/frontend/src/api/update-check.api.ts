import api from './client';
import type { UpdateCheckResult } from '@ts6/common';

export const updateCheckApi = {
  get: (): Promise<UpdateCheckResult> => api.get('/update-check').then((r) => r.data),
  recheck: (): Promise<UpdateCheckResult> => api.post('/update-check/recheck').then((r) => r.data),
};
