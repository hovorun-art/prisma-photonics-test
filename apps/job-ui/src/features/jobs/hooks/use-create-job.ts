import type { CreateJobRequest } from '@job-queue/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useJobsApi } from '../api/use-jobs-api';

/** Submits a job; on success the jobs list is refreshed. */
export function useCreateJob() {
  const api = useJobsApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: CreateJobRequest) => (await api.create({ request })).job,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
