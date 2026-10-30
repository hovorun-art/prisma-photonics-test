import type { ChangeJobStatusRequest } from '@job-queue/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useJobsApi } from '../api/use-jobs-api';

/**
 * Cancels or retries a job. The answered job replaces the cached one, so the page shows it at once
 * without waiting for the next poll; the list and the statistics are refreshed.
 */
export function useChangeJobStatus(id: string, status: ChangeJobStatusRequest['status']) {
  const api = useJobsApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.changeStatus({ id, status }),
    onSuccess: ({ job }) => {
      queryClient.setQueryData(['job', id], job);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
