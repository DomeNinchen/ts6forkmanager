import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ytCookieCheckApi } from '../api/yt-cookie-check.api';

export function useYtCookieCheck() {
  return useQuery({
    queryKey: ['yt-cookie-check'],
    queryFn: ytCookieCheckApi.get,
    staleTime: 60 * 60 * 1000, // backend itself only re-checks every 6h - no point polling more often than this
    refetchOnWindowFocus: false,
  });
}

export function useRecheckYtCookies() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ytCookieCheckApi.recheck,
    onSuccess: (data) => qc.setQueryData(['yt-cookie-check'], data),
  });
}
