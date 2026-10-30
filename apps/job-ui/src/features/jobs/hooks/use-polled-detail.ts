import type { ErrorCode } from '@job-queue/contracts';
import { type QueryKey, useQuery } from '@tanstack/react-query';

import { ApiError } from '../api/api-error';
import { useUiConfig } from './use-ui-config';

/**
 * One item of a details page, polled at the configured interval. An id that is not valid is never
 * sent to the API (`isValidId` false keeps the query idle). A failed first load goes to the page's
 * error boundary, except `notFoundCode`, which the page shows itself.
 */
export function usePolledDetail<T>({
  queryKey,
  isValidId,
  fetch,
  notFoundCode,
}: {
  queryKey: QueryKey;
  isValidId: boolean;
  fetch: () => Promise<T>;
  notFoundCode: ErrorCode;
}) {
  const { pollIntervalMs } = useUiConfig();
  const query = useQuery({
    queryKey,
    queryFn: fetch,
    enabled: isValidId,
    refetchInterval: pollIntervalMs,
    throwOnError: (error, query) =>
      query.state.data === undefined && !(error instanceof ApiError && error.code === notFoundCode),
  });
  return { ...query, isValidId };
}
