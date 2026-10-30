import { JobIdParams } from '@job-queue/contracts';
import { useQuery } from '@tanstack/react-query';

import { useJobsApi } from '../api/use-jobs-api';
import { useUiConfig } from './use-ui-config';

/**
 * One job, polled at the configured interval. An id that is not a UUID is never sent to the API:
 * `isValidId` is false and the query stays idle.
 */
export function useJob(id: string) {
  const api = useJobsApi();
  const { pollIntervalMs } = useUiConfig();
  const isValidId = JobIdParams.safeParse({ id }).success;
  const query = useQuery({
    queryKey: ['job', id],
    queryFn: async () => (await api.get({ id })).job,
    enabled: isValidId,
    refetchInterval: pollIntervalMs,
  });
  return { ...query, isValidId };
}
