import { JOB_ERROR_CODES, type JobError, type JobType } from '@job-queue/contracts';
import { type Clock, JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';

import { JobQueueUnavailableError } from '../../../domain/jobs/errors/job-queue-unavailable.error.js';
import type { EnqueueJobQueueRequest, JobQueue } from '../../../domain/jobs/job-queue.js';
import type { JobRecovery, RunJobRecoveryResponse } from '../../../domain/jobs/job-recovery.js';
import type { JobRepository, StoredJob } from '../../../domain/jobs/job-repository.js';
import type { JobService } from '../../../domain/jobs/job-service.js';

export interface JobRecoveryImplDeps {
  repository: JobRepository;
  queue: JobQueue;
  /** Fails a recovered attempt through the same rule as a worker's failure report. */
  jobs: JobService;
  clock: Clock;
  logger: Pick<LoggerService, 'log' | 'warn'>;
}

export interface JobRecoveryImplParams {
  /** How long a job must have been in its state before a pass looks at it. */
  minAgeMs: number;
  /** Time between passes; a job's time limit is only acted on one interval after it ran out. */
  intervalMs: number;
  /** Most waiting and most processing jobs one pass reads. */
  batchSize: number;
  maxProcessingMs: Readonly<Record<JobType, number>>;
}

interface RecoverRequest {
  stored: StoredJob;
  now: Date;
  counts: RunJobRecoveryResponse;
}

interface FailRequest {
  stored: StoredJob;
  error: JobError;
}

/**
 * One recovery pass. Waiting jobs come first: one with no live entry for its next attempt gets one
 * (a finished entry is replaced, a missing one added). Then processing jobs: one past its type's
 * time limit (plus one interval, so the worker's own `JOB_TIMEOUT` lands first) fails with
 * `JOB_TIMEOUT` whatever its entry; one whose current entry exists but is no longer held fails with
 * `WORKER_LOST`; one without any entry is left to the time limit (Redis lost it while the worker may
 * still run). Failing goes through `JobService.update`, the path of a worker's report, so the same
 * rule decides retry or final failure and a worker or another instance that changed the job first
 * wins with a conflict. When the queue cannot be reached, the pass stops with one warn line.
 */
export class JobRecoveryImpl implements JobRecovery {
  constructor(
    private readonly d: JobRecoveryImplDeps,
    private readonly p: JobRecoveryImplParams,
  ) {}

  async run(): Promise<RunJobRecoveryResponse> {
    const now = this.d.clock.now().now;
    const before = new Date(now.getTime() - this.p.minAgeMs);
    const counts: RunJobRecoveryResponse = { requeued: 0, lostWorkers: 0, timedOut: 0 };
    try {
      const waiting = await this.d.repository.findWaitingSince({
        before,
        limit: this.p.batchSize,
      });
      for (const stored of waiting.jobs) await this.recoverWaiting({ stored, now, counts });
      const processing = await this.d.repository.findProcessingSince({
        before,
        limit: this.p.batchSize,
      });
      for (const stored of processing.jobs) await this.recoverProcessing({ stored, now, counts });
    } catch (err) {
      if (!(err instanceof JobQueueUnavailableError)) throw err;
      this.d.logger.warn({ err }, 'Recovery pass stopped: the job queue cannot be reached');
    }
    return counts;
  }

  private async recoverWaiting({ stored, counts }: RecoverRequest): Promise<void> {
    const { job, run } = stored;
    const entry: EnqueueJobQueueRequest = {
      jobId: job.id,
      run,
      attempt: job.attempts + 1,
      priority: job.priority,
      // A scheduled job is only read once its time has passed, so its entry is available at once.
      runAt: job.status === 'scheduled' ? job.scheduledAt : null,
    };
    const { state } = await this.d.queue.state({ jobId: job.id, run, attempt: entry.attempt });
    if (state === 'finished') await this.d.queue.requeue(entry);
    else if (state === 'missing') await this.d.queue.enqueue(entry);
    else return;
    counts.requeued += 1;
    this.d.logger.warn(
      { jobId: job.id, run, attempt: entry.attempt, reason: 'no live queue entry' },
      'Recovery: waiting job queued again',
    );
  }

  private async recoverProcessing({ stored, now, counts }: RecoverRequest): Promise<void> {
    const { job, run } = stored;
    const maxProcessingMs = this.p.maxProcessingMs[job.type];
    const startedAt = job.startedAt === null ? 0 : Date.parse(job.startedAt);
    if (startedAt + maxProcessingMs + this.p.intervalMs < now.getTime()) {
      const failed = await this.fail({
        stored,
        error: {
          code: JOB_ERROR_CODES.jobTimeout,
          message: 'The attempt ran longer than its maximum processing time',
          details: { maxProcessingMs },
        },
      });
      if (failed) counts.timedOut += 1;
      return;
    }
    const { state } = await this.d.queue.state({ jobId: job.id, run, attempt: job.attempts });
    if (state === 'active' || state === 'missing') return;
    const failed = await this.fail({
      stored,
      error: {
        code: JOB_ERROR_CODES.workerLost,
        message: 'The worker running the attempt stopped holding it',
        details: { entryState: state },
      },
    });
    if (failed) counts.lostWorkers += 1;
  }

  /** `false` when the job changed first (a worker's report, a cancel, a delete, another pass). */
  private async fail({ stored, error }: FailRequest): Promise<boolean> {
    const { job, run } = stored;
    const fields = { jobId: job.id, run, attempt: job.attempts };
    try {
      await this.d.jobs.update({
        id: job.id,
        update: { status: 'failed', error, run, attempt: job.attempts },
      });
    } catch (err) {
      if (err instanceof JobStatusConflictError || err instanceof JobNotFoundError) {
        this.d.logger.log({ ...fields, err }, 'Recovery skipped: the job changed meanwhile');
        return false;
      }
      throw err;
    }
    this.d.logger.warn({ ...fields, reason: error.code }, 'Recovery: attempt failed');
    return true;
  }
}
