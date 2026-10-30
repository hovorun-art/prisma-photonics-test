import type { Job, JobError, JobType } from '@job-queue/contracts';

/**
 * Runs jobs of one type. An expected failure (e.g. a simulated webhook error) is returned as a
 * `failed` outcome with the job error to store; anything thrown is unexpected (a `DomainError` keeps
 * its code in the job's error, other errors become `HANDLER_ERROR`).
 */
export interface JobHandler {
  run(req: RunJobHandlerRequest): Promise<RunJobHandlerResponse>;
}

export interface RunJobHandlerRequest {
  job: Job;
  /**
   * The attempt being run, from the queue entry. `job.attempts` is read before job-service counts
   * this attempt on start, so it is one lower.
   */
  attempt: number;
  /** Aborted when the worker gives up on running jobs (shutdown grace period over). */
  signal: AbortSignal;
}

export type RunJobHandlerResponse =
  | {
      outcome: 'completed';
      /** Stored as the job's result; job-service checks it against the type's result schema. */
      result: unknown;
    }
  | {
      outcome: 'failed';
      /** Stored as the job's error as is; job-service decides whether another attempt follows. */
      error: JobError;
    };

/** The handler of each job type this worker can run; a type without one cannot run here. */
export type JobHandlers = Readonly<Partial<Record<JobType, JobHandler>>>;

/** Token for `JobHandlers`. */
export const JOB_HANDLERS = Symbol('JobHandlers');
