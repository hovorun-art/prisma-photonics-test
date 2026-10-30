import { JobGroupIdParams } from '@job-queue/contracts';

import { usePolledDetail } from '../../jobs/hooks/use-polled-detail';
import { useGroupsApi } from '../api/use-groups-api';

/** One group, polled; a non-UUID id is not sent, and "group not found" is left to the page. */
export function useGroup(id: string) {
  const api = useGroupsApi();
  return usePolledDetail({
    queryKey: ['group', id],
    isValidId: JobGroupIdParams.safeParse({ id }).success,
    fetch: async () => (await api.get({ id })).group,
    notFoundCode: 'JOB_GROUP_NOT_FOUND',
  });
}
