import { z } from 'zod';

/** Name of the queue job-service puts jobs on and job-execution-service takes them from. */
export const JOB_QUEUE_NAME = 'jobs';

/** A queue entry carries only the job id; the job itself is read from job-service. */
export const JobQueueMessage = z.object({ jobId: z.uuid() });
export type JobQueueMessage = z.infer<typeof JobQueueMessage>;
