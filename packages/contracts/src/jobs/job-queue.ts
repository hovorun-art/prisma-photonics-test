import { z } from 'zod';

/** Name of the queue job-service puts jobs on and job-execution-service takes them from. */
export const JOB_QUEUE_NAME = 'jobs';

/** A queue entry carries only the job id; the job itself is read from job-service. */
export const JobQueueMessage = z.object({ jobId: z.uuid() });
export type JobQueueMessage = z.infer<typeof JobQueueMessage>;

/** One attempt of a job on the queue. */
export const JobQueueAttempt = z.object({ jobId: z.uuid(), attempt: z.int().positive() });
export type JobQueueAttempt = z.infer<typeof JobQueueAttempt>;

/**
 * The queue entry id of a job attempt, `<jobId>_<attempt>`: one entry per attempt, so the queue
 * ignores a repeated enqueue of the same attempt. `_` because BullMQ rejects `:` in custom ids.
 * `encode` builds it (job-service), `decode` reads it back (job-execution-service).
 */
export const JobQueueEntryId = z.codec(
  z.string().regex(/^[^_]+_\d+$/, 'must be <jobId>_<attempt>'),
  JobQueueAttempt,
  {
    decode: (id) => {
      const separator = id.lastIndexOf('_');
      return { jobId: id.slice(0, separator), attempt: Number(id.slice(separator + 1)) };
    },
    encode: (entry) => `${entry.jobId}_${entry.attempt}`,
  },
);
