import type { Job } from '@job-queue/contracts';
import { useQuery } from '@tanstack/react-query';

import { useJobsApi } from '../../jobs/api/use-jobs-api';
import { useUiConfig } from '../../jobs/hooks/use-ui-config';

/**
 * Every job of a group, oldest first, polled at the configured interval. job-service returns the
 * jobs newest first a page at a time, so this reads page after page of the configured size until
 * it has the total (or a page comes back empty), drops a job that a shifted page repeats, and
 * reverses the order. Keeps the last jobs when a poll fails; `enabled` is false for an id that is
 * not a UUID, so no request is made.
 */
export function useGroupJobs(groupId: string, { enabled = true }: { enabled?: boolean } = {}) {
  const api = useJobsApi();
  const { pollIntervalMs, groupJobsPageSize } = useUiConfig();
  return useQuery({
    queryKey: ['group-jobs', groupId, groupJobsPageSize],
    queryFn: async () => {
      const jobs = new Map<string, Job>();
      let offset = 0;
      for (;;) {
        const page = await api.query({ offset, groupId, limit: groupJobsPageSize });
        for (const job of page.items) if (!jobs.has(job.id)) jobs.set(job.id, job);
        offset += page.items.length;
        if (page.items.length === 0 || offset >= page.total) break;
      }
      return [...jobs.values()].reverse();
    },
    enabled,
    refetchInterval: pollIntervalMs,
  });
}
