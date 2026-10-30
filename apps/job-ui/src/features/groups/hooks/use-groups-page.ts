import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useUiConfig } from '../../jobs/hooks/use-ui-config';
import { useGroupsApi } from '../api/use-groups-api';

/**
 * One page of groups, newest first, polled at the configured interval; keeps the last page on
 * errors and while another page loads. A failed first load goes to the page's error boundary (no
 * rows to keep yet).
 */
export function useGroupsPage({ offset }: { offset: number }) {
  const api = useGroupsApi();
  const { pollIntervalMs } = useUiConfig();
  return useQuery({
    queryKey: ['groups', { offset }],
    queryFn: () => api.query({ offset }),
    refetchInterval: pollIntervalMs,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}
