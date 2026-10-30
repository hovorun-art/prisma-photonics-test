import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useJobsApi } from '../api/use-jobs-api';
import { useJobFilters } from './use-job-filters';
import { useUiConfig } from './use-ui-config';

/**
 * The queue statistics with job counts faceted by the list filters of the page URL, polled at the
 * same configured interval as the jobs list. Every caller reads the filters from the same URL, so
 * the cards, the filter buttons and the header pill share one query and one request per poll (on
 * pages without filters, the unfiltered one). A failure never reaches the page's error boundary:
 * `data` keeps the last answer and `isError` tells whether the latest request failed. While the
 * statistics for new filters load, `data` holds the previous answer and `isPlaceholderData` is true.
 */
export function useQueueStats() {
  const api = useJobsApi();
  const { pollIntervalMs } = useUiConfig();
  const { filters } = useJobFilters();
  return useQuery({
    queryKey: ['stats', filters],
    queryFn: async () => (await api.stats(filters)).stats,
    refetchInterval: pollIntervalMs,
    placeholderData: keepPreviousData,
  });
}
