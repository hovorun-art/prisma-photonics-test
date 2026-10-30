import {
  FINISHED_JOB_STATUSES,
  JOB_RESULT_SCHEMAS,
  type Job,
  type JobError,
  type JobStatus,
} from '@job-queue/contracts';
import { type Clock, JobStatusConflictError } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';

import { InvalidJobResultError } from '../../domain/jobs/errors/invalid-job-result.error.js';
import { QueryLimitExceededError } from '../../domain/jobs/errors/query-limit-exceeded.error.js';
import type { JobQueue } from '../../domain/jobs/job-queue.js';
import type { JobChanges, JobRepository } from '../../domain/jobs/job-repository.js';
import type {
  CreateJobServiceRequest,
  CreateJobServiceResponse,
  DeleteJobServiceRequest,
  DeleteJobServiceResponse,
  GetJobServiceRequest,
  GetJobServiceResponse,
  JobService,
  QueryJobServiceRequest,
  QueryJobServiceResponse,
  UpdateJobServiceRequest,
  UpdateJobServiceResponse,
} from '../../domain/jobs/job-service.js';

export interface JobServiceImplDeps {
  repository: JobRepository;
  queue: JobQueue;
  clock: Clock;
  logger: Pick<LoggerService, 'warn'>;
}

export interface JobServiceImplParams {
  /** Page size of a query without `limit`. */
  queryDefaultLimit: number;
  /** Largest `limit` a query may ask for. */
  queryMaxLimit: number;
}

interface FailureChangesRequest {
  current: Job;
  error: JobError;
  now: string;
}

interface RequireStatusRequest {
  current: Job;
  status: JobStatus;
}

interface RequireValidResultRequest {
  current: Job;
  result: unknown;
}

interface EnqueueRequest {
  jobId: string;
  attempt: number;
}

/**
 * The job lifecycle. `update` decides the next state from the stored job and writes it only while
 * the job is still in that state, so a concurrent report loses with a status conflict. A failed
 * attempt goes back to pending (and is queued again) while attempts remain, otherwise it fails the
 * job for good. Queueing problems never fail a request: the job stays pending and is logged.
 */
export class JobServiceImpl implements JobService {
  constructor(
    private readonly d: JobServiceImplDeps,
    private readonly p: JobServiceImplParams,
  ) {}

  async create(req: CreateJobServiceRequest): Promise<CreateJobServiceResponse> {
    const { job } = await this.d.repository.create({
      job: {
        type: req.job.type,
        payload: req.job.payload,
        status: 'pending',
        priority: req.job.priority,
        attempts: 0,
        maxAttempts: req.job.maxAttempts,
        result: null,
        error: null,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
      },
    });
    await this.enqueue({ jobId: job.id, attempt: 1 });
    return { job };
  }

  get(req: GetJobServiceRequest): Promise<GetJobServiceResponse> {
    return this.d.repository.get({ id: req.id });
  }

  async query(req: QueryJobServiceRequest): Promise<QueryJobServiceResponse> {
    const limit = req.limit ?? this.p.queryDefaultLimit;
    if (limit > this.p.queryMaxLimit) {
      throw new QueryLimitExceededError({ maxLimit: this.p.queryMaxLimit });
    }
    return this.d.repository.query({ limit, offset: req.offset });
  }

  async update(req: UpdateJobServiceRequest): Promise<UpdateJobServiceResponse> {
    const { job: current } = await this.d.repository.get({ id: req.id });
    let changes: JobChanges;

    switch (req.update.status) {
      case 'processing':
        this.requireStatus({ current, status: 'pending' });
        changes = {
          status: 'processing',
          attempts: current.attempts + 1,
          startedAt: this.now(),
        };
        break;
      case 'completed':
        this.requireStatus({ current, status: 'processing' });
        this.requireValidResult({ current, result: req.update.result });
        changes = {
          status: 'completed',
          result: req.update.result,
          error: null,
          completedAt: this.now(),
        };
        break;
      case 'failed':
        this.requireStatus({ current, status: 'processing' });
        changes = this.failureChanges({ current, error: req.update.error, now: this.now() });
        break;
    }

    const { job } = await this.d.repository.update({
      id: req.id,
      expected: { status: current.status, attempts: current.attempts },
      changes,
    });
    // A failure does not change attempts, so the retry is the attempt after the loaded one.
    if (job.status === 'pending')
      await this.enqueue({ jobId: job.id, attempt: current.attempts + 1 });
    return { job };
  }

  async delete(req: DeleteJobServiceRequest): Promise<DeleteJobServiceResponse> {
    await this.d.repository.delete({ id: req.id, allowedStatuses: FINISHED_JOB_STATUSES });
    return {};
  }

  /** Retry while attempts remain (the attempt was counted on start), otherwise fail for good. */
  private failureChanges({ current, error, now }: FailureChangesRequest): JobChanges {
    return current.attempts < current.maxAttempts
      ? { status: 'pending', error, completedAt: null }
      : { status: 'failed', error, completedAt: now };
  }

  private requireStatus({ current, status }: RequireStatusRequest): void {
    if (current.status !== status) {
      throw new JobStatusConflictError({ id: current.id, status: current.status });
    }
  }

  private requireValidResult({ current, result }: RequireValidResultRequest): void {
    const parsed = JOB_RESULT_SCHEMAS[current.type].safeParse(result);
    if (!parsed.success) throw new InvalidJobResultError({ issues: parsed.error.issues });
  }

  /** The job stays pending when this fails; the sweep in `crash-recovery` queues it later. */
  private async enqueue({ jobId, attempt }: EnqueueRequest): Promise<void> {
    try {
      await this.d.queue.enqueue({ jobId, attempt });
    } catch (err) {
      this.d.logger.warn({ err, jobId, attempt }, 'Job stays pending: it could not be queued');
    }
  }

  private now(): string {
    return this.d.clock.now().now.toISOString();
  }
}
