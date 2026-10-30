import type { Job, JobType } from '@job-queue/contracts';

/** Runs jobs of one type; a failure is thrown (a `DomainError` keeps its code in the job's error). */
export interface JobHandler {
  run(req: RunJobHandlerRequest): Promise<RunJobHandlerResponse>;
}

export interface RunJobHandlerRequest {
  job: Job;
  /** Aborted when the worker gives up on running jobs (shutdown grace period over). */
  signal: AbortSignal;
}

export interface RunJobHandlerResponse {
  /** Stored as the job's result; job-service checks it against the type's result schema. */
  result: unknown;
}

/** The handler of each job type this worker can run; a type without one cannot run here. */
export type JobHandlers = Readonly<Partial<Record<JobType, JobHandler>>>;

/** Token for `JobHandlers`. */
export const JOB_HANDLERS = Symbol('JobHandlers');
