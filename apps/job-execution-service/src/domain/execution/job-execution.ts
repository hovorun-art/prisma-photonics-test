import type { JobQueueEntry } from '../queue/job-queue-consumer.js';

/**
 * Runs one queued job attempt: reads the job, starts it, runs its handler and reports the outcome
 * to job-service. Every outcome is settled here; `execute` never rejects.
 */
export interface JobExecution {
  execute(req: ExecuteJobExecutionRequest): Promise<ExecuteJobExecutionResponse>;
  /**
   * Stops every running job where it is: handlers are aborted and nothing more is reported, so the
   * jobs keep the state job-service last accepted. Used when the shutdown grace period runs out.
   */
  abort(): AbortJobExecutionResponse;
}

export type AbortJobExecutionResponse = Record<string, never>;

export type ExecuteJobExecutionRequest = JobQueueEntry;

export interface ExecuteJobExecutionResponse {
  /** What happened to the entry. */
  outcome: 'completed' | 'failed' | 'skipped' | 'abandoned';
}

export const JOB_EXECUTION = Symbol('JobExecution');
