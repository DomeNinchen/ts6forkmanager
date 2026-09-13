import { useQuery } from '@tanstack/react-query';
import { updateCheckApi } from '../api/update-check.api';

export function useUpdateCheck() {
  return useQuery({
    queryKey: ['update-check'],
    queryFn: updateCheckApi.get,
    staleTime: 60 * 60 * 1000, // backend itself only re-checks GitHub every 6h - no point polling more often than this
    refetchOnWindowFocus: false,
  });
}
