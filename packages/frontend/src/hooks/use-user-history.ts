import { useQuery } from '@tanstack/react-query';
import { statisticsApi, type UserHistoryRange } from '../api/statistics.api';
import { useServerStore } from '../stores/server.store';

// The recorded user count of the selected virtual server, for the Statistics
// -> History tab. The backend measures continuously whether or not this page is
// open, so the chart is already full on first render. A new point exists once
// per sampling interval (a minute by default), so polling faster than that only
// re-downloads the same picture.
export function useUserHistory(range: UserHistoryRange) {
  const { selectedConfigId, selectedSid } = useServerStore();
  return useQuery({
    queryKey: ['user-history', selectedConfigId, selectedSid, range],
    queryFn: () => statisticsApi.userHistory(selectedConfigId!, selectedSid!, range),
    enabled: !!selectedConfigId && !!selectedSid,
    refetchInterval: 60_000,
    // Switching the range keeps the current chart on screen until the new one
    // arrives instead of flashing the page loader - but only within the same
    // virtual server, so picking another server never shows the previous one's
    // numbers under the new name.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === selectedConfigId && previousQuery?.queryKey[2] === selectedSid
        ? previous
        : undefined,
  });
}
