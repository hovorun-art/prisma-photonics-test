import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { JobListFilters } from '../api/jobs-api';
import { useJobsApi } from '../api/use-jobs-api';
import { useUiConfig } from './use-ui-config';

/**
 * One page of jobs under the list filters, newest first, polled at the configured interval; keeps
 * the last page on errors and while another page or filter loads. A failed first load goes to the
 * page's error boundary (no rows to keep yet).
 */
export function useJobsPage({ offset, filters }: { offset: number; filters: JobListFilters }) {
  const api = useJobsApi();
  const { pollIntervalMs } = useUiConfig();
  return useQuery({
    queryKey: ['jobs', { offset, ...filters }],
    queryFn: () => api.query({ offset, ...filters }),
    refetchInterval: pollIntervalMs,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}
