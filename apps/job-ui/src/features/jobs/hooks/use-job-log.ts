import type { JobLogEntry, JobLogLevel } from '@job-queue/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useJobsApi } from '../api/use-jobs-api';
import { useUiConfig } from './use-ui-config';

interface JobLogState {
  readonly entries: readonly JobLogEntry[];
  readonly cursor: string | null;
}

export interface UseJobLogRequest {
  readonly id: string;
  /** Only entries of this level; left out means all. */
  readonly level?: JobLogLevel | undefined;
}

/**
 * One job's log, oldest first. Each poll asks only for entries after the last cursor and appends
 * them; pages are followed until one comes back empty so a long log loads completely. A level change starts over
 * (new query key, nothing cached). A failed poll keeps the entries shown; `unavailable` is set only
 * while nothing could be loaded yet.
 */
export function useJobLog({ id, level }: UseJobLogRequest) {
  const api = useJobsApi();
  const client = useQueryClient();
  const { pollIntervalMs } = useUiConfig();
  const queryKey = ['job-log', id, level ?? 'all'];
  const query = useQuery<JobLogState>({
    queryKey,
    gcTime: 0,
    refetchInterval: pollIntervalMs,
    queryFn: async () => {
      const previous = client.getQueryData<JobLogState>(queryKey);
      const entries = [...(previous?.entries ?? [])];
      let cursor = previous?.cursor ?? null;
      let more = true;
      while (more) {
        const page = await api.logs({
          id,
          ...(cursor === null ? {} : { after: cursor }),
          ...(level === undefined ? {} : { level: [level] }),
        });
        entries.push(...page.items);
        cursor = page.nextCursor;
        more = page.items.length > 0;
      }
      return { entries, cursor };
    },
  });
  return {
    entries: query.data?.entries ?? [],
    isLoading: query.data === undefined && !query.isError,
    unavailable: query.data === undefined && query.isError,
  };
}
