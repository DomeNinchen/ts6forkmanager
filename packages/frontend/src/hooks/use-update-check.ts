import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { updateCheckApi } from '../api/update-check.api';

export function useUpdateCheck() {
  return useQuery({
    queryKey: ['update-check'],
    queryFn: updateCheckApi.get,
    staleTime: 60 * 60 * 1000, // backend itself only re-checks GitHub every 6h - no point polling more often than this
    refetchOnWindowFocus: false,
  });
}

export function useRecheckUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateCheckApi.recheck,
    onSuccess: (data) => qc.setQueryData(['update-check'], data),
  });
}
