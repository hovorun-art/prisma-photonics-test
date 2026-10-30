import { JobGroupIdParams } from '@job-queue/contracts';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../jobs/api/api-error';
import { useUiConfig } from '../../jobs/hooks/use-ui-config';
import { useGroupsApi } from '../api/use-groups-api';

/**
 * One group, polled at the configured interval. An id that is not a UUID is never sent to the API:
 * `isValidId` is false and the query stays idle. A failed first load goes to the page's error
 * boundary, except "group not found", which the page shows itself.
 */
export function useGroup(id: string) {
  const api = useGroupsApi();
  const { pollIntervalMs } = useUiConfig();
  const isValidId = JobGroupIdParams.safeParse({ id }).success;
  const query = useQuery({
    queryKey: ['group', id],
    queryFn: async () => (await api.get({ id })).group,
    enabled: isValidId,
    refetchInterval: pollIntervalMs,
    throwOnError: (error, query) =>
      query.state.data === undefined &&
      !(error instanceof ApiError && error.code === 'JOB_GROUP_NOT_FOUND'),
  });
  return { ...query, isValidId };
}
