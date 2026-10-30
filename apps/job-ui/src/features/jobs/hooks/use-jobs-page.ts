import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useJobsApi } from '../api/use-jobs-api';
import { useUiConfig } from './use-ui-config';

/** One page of jobs, newest first, polled at the configured interval; keeps the last page on errors. */
export function useJobsPage(offset: number) {
  const api = useJobsApi();
  const { pollIntervalMs } = useUiConfig();
  return useQuery({
    queryKey: ['jobs', { offset }],
    queryFn: () => api.query({ offset }),
    refetchInterval: pollIntervalMs,
    placeholderData: keepPreviousData,
  });
}
