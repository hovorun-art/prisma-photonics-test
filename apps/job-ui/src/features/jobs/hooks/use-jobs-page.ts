import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useJobsApi } from '../api/use-jobs-api';
import { useUiConfig } from './use-ui-config';

/**
 * One page of jobs, newest first, polled at the configured interval; keeps the last page on errors.
 * A failed first load goes to the page's error boundary (no rows to keep yet).
 */
export function useJobsPage(offset: number) {
  const api = useJobsApi();
  const { pollIntervalMs } = useUiConfig();
  return useQuery({
    queryKey: ['jobs', { offset }],
    queryFn: () => api.query({ offset }),
    refetchInterval: pollIntervalMs,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}
