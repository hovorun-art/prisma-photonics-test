import { usePolledPage } from '../../jobs/hooks/use-polled-page';
import { useGroupsApi } from '../api/use-groups-api';

/** One page of groups, newest first, polled (see `usePolledPage`). */
export function useGroupsPage({ offset }: { offset: number }) {
  const api = useGroupsApi();
  return usePolledPage({ queryKey: ['groups', { offset }], fetch: () => api.query({ offset }) });
}
