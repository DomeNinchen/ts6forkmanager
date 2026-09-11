import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/dashboard.api';
import { useServerStore } from '../stores/server.store';

export function useDashboard() {
  const { selectedConfigId, selectedSid } = useServerStore();
  return useQuery({
    queryKey: ['dashboard', selectedConfigId, selectedSid],
    queryFn: () => dashboardApi.get(selectedConfigId!, selectedSid!),
    enabled: !!selectedConfigId && !!selectedSid,
    refetchInterval: 10000,
  });
}

// One-time fetch of the backend's rolling bandwidth buffer, to seed the
// dashboard's chart with real history instead of starting empty on every
// mount. Not polled - the live 10s useDashboard() poll keeps appending to it.
export function useBandwidthHistory() {
  const { selectedConfigId, selectedSid } = useServerStore();
  return useQuery({
    queryKey: ['bandwidth-history', selectedConfigId, selectedSid],
    queryFn: () => dashboardApi.bandwidthHistory(selectedConfigId!, selectedSid!),
    enabled: !!selectedConfigId && !!selectedSid,
  });
}
