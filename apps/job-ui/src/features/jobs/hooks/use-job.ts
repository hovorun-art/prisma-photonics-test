import { JobIdParams } from '@job-queue/contracts';

import { useJobsApi } from '../api/use-jobs-api';
import { usePolledDetail } from './use-polled-detail';

/** One job, polled; a non-UUID id is not sent, and "job not found" is left to the page. */
export function useJob(id: string) {
  const api = useJobsApi();
  return usePolledDetail({
    queryKey: ['job', id],
    isValidId: JobIdParams.safeParse({ id }).success,
    fetch: async () => (await api.get({ id })).job,
    notFoundCode: 'JOB_NOT_FOUND',
  });
}
