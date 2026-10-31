import { z } from 'zod';

import { GroupIdFilter, JobStatus, JobType } from './job.js';

export const STATS_ROUTE = '/v1/stats';

const Count = z.number().int().nonnegative();
const WindowMinutes = z.number().int().positive();

/**
 * Query string of `GET /v1/stats`: at most one status and one type. They narrow only `counts`,
 * each the other facet (see `QueueStats`); a repeated or empty value fails the enum. `groupId`
 * narrows both facets of `counts` to one group's jobs, or to the jobs without a group (`null`).
 */
export const QueryStatsRequest = z.object({
  status: JobStatus.optional(),
  type: JobType.optional(),
  groupId: GroupIdFilter.optional(),
});
export type QueryStatsRequest = z.infer<typeof QueryStatsRequest>;

/**
 * Body of `GET /v1/stats`: jobs of every type, read from job state at the moment of the request.
 * `pending`, `processing` and `scheduled` count jobs in that status now; `recent` counts jobs that
 * completed or failed for good within the last `windowMinutes`; `throughput` is the number of jobs
 * completed within its own `windowMinutes`, per minute. `counts` holds every job by status and by
 * type over all time, faceted: `status` counts only jobs of the requested type, `type` only jobs in
 * the requested status; every known key is present. The other fields ignore the filters.
 */
export const QueueStats = z.object({
  pending: Count,
  processing: Count,
  scheduled: Count,
  recent: z.object({ windowMinutes: WindowMinutes, completed: Count, failed: Count }),
  throughput: z.object({ windowMinutes: WindowMinutes, perMinute: z.number().nonnegative() }),
  counts: z.object({
    status: z.record(JobStatus, Count),
    type: z.record(JobType, Count),
  }),
});
export type QueueStats = z.infer<typeof QueueStats>;
