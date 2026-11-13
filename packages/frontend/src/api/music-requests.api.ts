import api from './client';

export interface MusicRequest {
    id: number;
    title: string;
    url: string;
    serverConfigId: number;
    requestedAt: string;
    /** The link was a channel that was live then; playing it again needs it to be live now. */
    isLive: boolean;
}

export const musicRequestsApi = {
    list: (configId: number): Promise<MusicRequest[]> =>
        api.get(`/servers/${configId}/music-requests`).then((r) => r.data),
};
