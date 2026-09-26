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

// The last 20 minutes of bandwidth and ping, measured by the backend
// continuously rather than only while a dashboard is open - so the charts show
// a full window on the very first render. This is their only data source: the
// page does not append points of its own, which would mix its own 10s cadence
// into the sampler's 30s one and push real history out of the window. Polled
// at the sampler's own interval, since that is how often a new point exists.
export function useBandwidthHistory() {
  const { selectedConfigId, selectedSid } = useServerStore();
  return useQuery({
    queryKey: ['bandwidth-history', selectedConfigId, selectedSid],
    queryFn: () => dashboardApi.bandwidthHistory(selectedConfigId!, selectedSid!),
    enabled: !!selectedConfigId && !!selectedSid,
    refetchInterval: 30000,
  });
}
