import { z } from 'zod';

/** Name of the queue job-service puts jobs on and job-execution-service takes them from. */
export const JOB_QUEUE_NAME = 'jobs';

/** A queue entry carries only the job id; the job itself is read from job-service. */
export const JobQueueMessage = z.object({ jobId: z.uuid() });
export type JobQueueMessage = z.infer<typeof JobQueueMessage>;

/**
 * One attempt of a job on the queue. `run` counts the job's manual retries (1 until the first
 * retry), since a retry starts the attempts again at 1 and each entry id must be new.
 */
export const JobQueueAttempt = z.object({
  jobId: z.uuid(),
  run: z.int().positive(),
  attempt: z.int().positive(),
});
export type JobQueueAttempt = z.infer<typeof JobQueueAttempt>;

/**
 * The queue entry id of a job attempt, `<jobId>_<run>_<attempt>`: one entry per attempt of a run,
 * so the queue ignores a repeated enqueue of the same attempt. `_` because BullMQ rejects `:` in
 * custom ids. Ids queued before runs existed (`<jobId>_<attempt>`) decode as run 1. `encode`
 * builds it (job-service), `decode` reads it back (job-execution-service).
 */
export const JobQueueEntryId = z.codec(
  z.string().regex(/^[^_]+(_\d+)?_\d+$/, 'must be <jobId>_<run>_<attempt>'),
  JobQueueAttempt,
  {
    decode: (id) => {
      const [jobId = '', ...numbers] = id.split('_');
      const [run, attempt] = numbers.length === 1 ? ['1', numbers[0]] : numbers;
      return { jobId, run: Number(run), attempt: Number(attempt) };
    },
    encode: (entry) => `${entry.jobId}_${entry.run}_${entry.attempt}`,
  },
);

/** The Redis channel job-service announces cancelled jobs on, for the workers that run them. */
export const JOB_CANCELLATIONS_CHANNEL = 'job-cancellations';

/** A cancellation announcement: the id of the job that was cancelled. */
export const JobCancellationMessage = z.object({ jobId: z.uuid() });
export type JobCancellationMessage = z.infer<typeof JobCancellationMessage>;
