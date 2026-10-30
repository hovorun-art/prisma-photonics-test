import { useQuery } from '@tanstack/react-query';

import { useJobsApi } from '../api/use-jobs-api';
import { useUiConfig } from './use-ui-config';

/**
 * The queue statistics, polled at the same configured interval as the jobs list. Every caller shares
 * one query, so the cards and the header pill cost one request per poll. A failure never reaches
 * the page's error boundary: `data` keeps the last answer and `isError` tells whether the latest
 * request failed.
 */
export function useQueueStats() {
  const api = useJobsApi();
  const { pollIntervalMs } = useUiConfig();
  return useQuery({
    queryKey: ['stats'],
    queryFn: async () => (await api.stats()).stats,
    refetchInterval: pollIntervalMs,
  });
}
