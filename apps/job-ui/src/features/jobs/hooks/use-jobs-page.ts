import type { JobListFilters } from '../api/jobs-api';
import { useJobsApi } from '../api/use-jobs-api';
import { usePolledPage } from './use-polled-page';

/**
 * One page of the jobs submitted without a group, under the list filters, newest first, polled
 * (see `usePolledPage`). A group's jobs are shown on its own page.
 */
export function useJobsPage({ offset, filters }: { offset: number; filters: JobListFilters }) {
  const api = useJobsApi();
  return usePolledPage({
    queryKey: ['jobs', { offset, ...filters, groupId: null }],
    fetch: () => api.query({ offset, ...filters, groupId: null }),
  });
}
