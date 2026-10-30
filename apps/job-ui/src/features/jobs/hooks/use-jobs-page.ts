import type { JobListFilters } from '../api/jobs-api';
import { useJobsApi } from '../api/use-jobs-api';
import { usePolledPage } from './use-polled-page';

/** One page of jobs under the list filters, newest first, polled (see `usePolledPage`). */
export function useJobsPage({ offset, filters }: { offset: number; filters: JobListFilters }) {
  const api = useJobsApi();
  return usePolledPage({
    queryKey: ['jobs', { offset, ...filters }],
    fetch: () => api.query({ offset, ...filters }),
  });
}
