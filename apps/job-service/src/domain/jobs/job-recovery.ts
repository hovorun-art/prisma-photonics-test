/**
 * Brings stuck jobs back to a state where they run or end, by comparing the stored jobs with the
 * job queue: a waiting job with no live entry is queued again; a processing job whose entry is no
 * longer being run fails its attempt with `WORKER_LOST`, and one past its type's maximum processing
 * time with `JOB_TIMEOUT`. Every change is conditional, so a worker or another instance that
 * changed the job first wins. One call is one pass; a timer calls it.
 */
export interface JobRecovery {
  run(): Promise<RunJobRecoveryResponse>;
}

export interface RunJobRecoveryResponse {
  /** Waiting jobs whose entry was queued again. */
  requeued: number;
  /** Processing jobs failed with `WORKER_LOST`. */
  lostWorkers: number;
  /** Processing jobs failed with `JOB_TIMEOUT`. */
  timedOut: number;
}

export const JOB_RECOVERY = Symbol('JobRecovery');
