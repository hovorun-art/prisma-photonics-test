import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../api/api-error';
import { useJobsApi } from '../api/use-jobs-api';

/**
 * Deletes a job. A job that is already gone counts as deleted: either way the job's cached data
 * is dropped, the list is refreshed and `onDeleted` runs.
 */
export function useDeleteJob(id: string, onDeleted: () => void) {
  const api = useJobsApi();
  const queryClient = useQueryClient();
  const deleted = () => {
    queryClient.removeQueries({ queryKey: ['job', id] });
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    onDeleted();
  };
  return useMutation({
    mutationFn: () => api.delete({ id }),
    onSuccess: deleted,
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'JOB_NOT_FOUND') deleted();
    },
  });
}
