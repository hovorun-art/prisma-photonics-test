import { keepPreviousData, type QueryKey, useQuery } from '@tanstack/react-query';

import { useUiConfig } from './use-ui-config';

/**
 * One page of a list, polled at the configured interval; keeps the last page on errors and while
 * another page loads. A failed first load goes to the page's error boundary (no rows to keep yet).
 */
export function usePolledPage<T>({
  queryKey,
  fetch,
}: {
  queryKey: QueryKey;
  fetch: () => Promise<T>;
}) {
  const { pollIntervalMs } = useUiConfig();
  return useQuery({
    queryKey,
    queryFn: fetch,
    refetchInterval: pollIntervalMs,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}
