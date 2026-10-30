import { z } from 'zod';

export const STATS_ROUTE = '/v1/stats';

const Count = z.number().int().nonnegative();
const WindowMinutes = z.number().int().positive();

/**
 * Body of `GET /v1/stats`: jobs of every type, read from job state at the moment of the request.
 * `pending`, `processing` and `scheduled` count jobs in that status now; `recent` counts jobs that
 * completed or failed for good within the last `windowMinutes`; `throughput` is the number of jobs
 * completed within its own `windowMinutes`, per minute.
 */
export const QueueStats = z.object({
  pending: Count,
  processing: Count,
  scheduled: Count,
  recent: z.object({ windowMinutes: WindowMinutes, completed: Count, failed: Count }),
  throughput: z.object({ windowMinutes: WindowMinutes, perMinute: z.number().nonnegative() }),
});
export type QueueStats = z.infer<typeof QueueStats>;
