import {
  type CreateJobRequest,
  FINISHED_JOB_STATUSES,
  JOB_LIMITS,
  JOB_RESULT_SCHEMAS,
  type Job,
  type JobError,
  type JobStatus,
  STARTABLE_JOB_STATUSES,
} from '@job-queue/contracts';
import {
  type Clock,
  type DepartureDay,
  JobStatusConflictError,
  UtcDepartureDay,
} from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';

import { BulkLimitExceededError } from '../../domain/jobs/errors/bulk-limit-exceeded.error.js';
import {
  InvalidJobFieldError,
  type JobFieldIssue,
} from '../../domain/jobs/errors/invalid-job-field.error.js';
import { InvalidJobPayloadError } from '../../domain/jobs/errors/invalid-job-payload.error.js';
import { InvalidJobResultError } from '../../domain/jobs/errors/invalid-job-result.error.js';
import { QueryLimitExceededError } from '../../domain/jobs/errors/query-limit-exceeded.error.js';
import type { JobQueue } from '../../domain/jobs/job-queue.js';
import type { JobChanges, JobRepository, NewJob } from '../../domain/jobs/job-repository.js';
import type {
  CreateJobServiceRequest,
  CreateJobServiceResponse,
  CreateManyJobServiceRequest,
  CreateManyJobServiceResponse,
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
  /** Most jobs one `createMany` may hold. */
  bulkMaxJobs: number;
}

interface FailureChangesRequest {
  current: Job;
  error: JobError;
  now: string;
}

interface RequireStatusRequest {
  current: Job;
  statuses: readonly JobStatus[];
}

interface RequireValidResultRequest {
  current: Job;
  result: unknown;
}

interface EnqueueRequest {
  jobId: string;
  attempt: number;
  priority: number;
  runAt: string | null;
}

interface NewJobRequest {
  job: CreateJobRequest;
  /** The instant the request is judged by: a later `scheduledAt` makes the job `scheduled`. */
  now: Date;
  /** Set for the jobs of a bulk; otherwise the database's clock sets it. */
  createdAt?: string;
}

interface ScheduleIssuesRequest {
  job: CreateJobRequest;
  now: Date;
}

interface DepartureDayIssuesRequest {
  job: CreateJobRequest;
  /** The rule at the instant the request is judged by. */
  departureDay: DepartureDay;
}

/**
 * The job lifecycle. A job submitted with a future `scheduledAt` is `scheduled` and its entry waits
 * on the queue until then; otherwise it is `pending`. Either can be started. `update` decides the
 * next state from the stored job and writes it only while the job is still in that state, so a
 * concurrent report loses with a status conflict. A failed attempt goes back to pending (and is
 * queued again at once, with the job's priority) while attempts remain, otherwise it fails the job
 * for good. Queueing problems never fail a request: the job keeps its status and is logged.
 */
export class JobServiceImpl implements JobService {
  constructor(
    private readonly d: JobServiceImplDeps,
    private readonly p: JobServiceImplParams,
  ) {}

  /** Judged at one instant, the one that decides whether the job is scheduled. */
  async create(req: CreateJobServiceRequest): Promise<CreateJobServiceResponse> {
    const now = this.d.clock.now().now;
    const departureIssues = this.departureDayIssues({
      job: req.job,
      departureDay: this.departureDayAt(now),
    });
    const scheduleIssues = this.scheduleIssues({ job: req.job, now });
    // Every broken rule is reported; a payload-only problem keeps its own error class.
    if (scheduleIssues.length > 0) {
      throw new InvalidJobFieldError({
        field: [],
        issues: [
          ...departureIssues.map((issue) => ({ ...issue, path: ['payload', ...issue.path] })),
          ...scheduleIssues,
        ],
      });
    }
    if (departureIssues.length > 0) throw new InvalidJobPayloadError({ issues: departureIssues });
    const { job } = await this.d.repository.create({ job: this.newJob({ job: req.job, now }) });
    await this.enqueue({
      jobId: job.id,
      attempt: 1,
      priority: job.priority,
      runAt: job.scheduledAt,
    });
    return { job };
  }

  /**
   * Every item is checked before anything is stored, so a bad item stores nothing. All items are
   * judged at one instant, the one the jobs are stamped from, so a bulk sent at midnight (UTC) is not
   * split across two days. The jobs are stamped one millisecond apart, so the newest-first query
   * keeps the request order.
   */
  async createMany(req: CreateManyJobServiceRequest): Promise<CreateManyJobServiceResponse> {
    if (req.jobs.length > this.p.bulkMaxJobs) {
      throw new BulkLimitExceededError({ maxJobs: this.p.bulkMaxJobs });
    }
    const now = this.d.clock.now().now;
    const departureDay = this.departureDayAt(now);
    const issues = req.jobs.flatMap((job, index) => [
      ...this.scheduleIssues({ job, now }).map((issue) => ({
        ...issue,
        path: [index, ...issue.path],
      })),
      ...this.departureDayIssues({ job, departureDay }).map((issue) => ({
        ...issue,
        path: [index, 'payload', ...issue.path],
      })),
    ]);
    if (issues.length > 0) throw new InvalidJobFieldError({ field: ['jobs'], issues });
    const { jobs } = await this.d.repository.createMany({
      jobs: req.jobs.map((job, index) =>
        this.newJob({ job, now, createdAt: new Date(now.getTime() + index).toISOString() }),
      ),
    });
    await this.enqueueFirstAttempts(jobs);
    return { jobs };
  }

  get(req: GetJobServiceRequest): Promise<GetJobServiceResponse> {
    return this.d.repository.get({ id: req.id });
  }

  async query(req: QueryJobServiceRequest): Promise<QueryJobServiceResponse> {
    const limit = req.limit ?? this.p.queryDefaultLimit;
    if (limit > this.p.queryMaxLimit) {
      throw new QueryLimitExceededError({ maxLimit: this.p.queryMaxLimit });
    }
    return this.d.repository.query({
      limit,
      offset: req.offset,
      statuses: req.statuses,
      types: req.types,
      groupId: req.groupId,
    });
  }

  async update(req: UpdateJobServiceRequest): Promise<UpdateJobServiceResponse> {
    const { job: current } = await this.d.repository.get({ id: req.id });
    let changes: JobChanges;

    switch (req.update.status) {
      case 'processing':
        this.requireStatus({ current, statuses: STARTABLE_JOB_STATUSES });
        changes = {
          status: 'processing',
          attempts: current.attempts + 1,
          startedAt: this.now(),
        };
        break;
      case 'completed':
        this.requireStatus({ current, statuses: ['processing'] });
        this.requireValidResult({ current, result: req.update.result });
        changes = {
          status: 'completed',
          result: req.update.result,
          error: null,
          completedAt: this.now(),
        };
        break;
      case 'failed':
        this.requireStatus({ current, statuses: ['processing'] });
        changes = this.failureChanges({ current, error: req.update.error, now: this.now() });
        break;
    }

    const { job } = await this.d.repository.update({
      id: req.id,
      expected: { status: current.status, attempts: current.attempts },
      changes,
    });
    // A failure does not change attempts, so the retry is the attempt after the loaded one. It
    // keeps the job's priority and runs at once: the job's scheduled time has passed.
    if (job.status === 'pending')
      await this.enqueue({
        jobId: job.id,
        attempt: current.attempts + 1,
        priority: current.priority,
        runAt: null,
      });
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

  /**
   * A new job as submitted: scheduled when its execution time is after `now`, otherwise pending;
   * nothing run yet, in no group unless the request names one.
   */
  private newJob({ job, now, createdAt }: NewJobRequest): NewJob {
    const scheduledAt = job.scheduledAt ?? null;
    return {
      ...job,
      status:
        scheduledAt !== null && Date.parse(scheduledAt) > now.getTime() ? 'scheduled' : 'pending',
      attempts: 0,
      result: null,
      error: null,
      groupId: job.groupId ?? null,
      scheduledAt,
      startedAt: null,
      completedAt: null,
      ...(createdAt === undefined ? {} : { createdAt }),
    };
  }

  /**
   * A flight transit may be submitted until its departure day (in UTC) is over at job-service's
   * time. The issue paths are relative to the payload.
   */
  private departureDayIssues({ job, departureDay }: DepartureDayIssuesRequest): JobFieldIssue[] {
    if (job.type !== 'flight-transit') return [];
    const { today, over } = departureDay.check({ departureDate: job.payload.departureDate });
    if (!over) return [];
    return [
      {
        code: 'custom',
        path: ['departureDate'],
        message: `The departure day is over: ${job.payload.departureDate} is before ${today} (UTC)`,
      },
    ];
  }

  /**
   * A job may be scheduled at most the contract's maximum ahead of `now` (exactly the maximum is
   * allowed). The issue path is relative to the job.
   */
  private scheduleIssues({ job, now }: ScheduleIssuesRequest): JobFieldIssue[] {
    if (job.scheduledAt === undefined) return [];
    const { maxAheadDays } = JOB_LIMITS.scheduledAt;
    const latest = new Date(now.getTime() + maxAheadDays * 24 * 60 * 60 * 1000);
    if (Date.parse(job.scheduledAt) <= latest.getTime()) return [];
    return [
      {
        code: 'too_big',
        path: ['scheduledAt'],
        message: `The execution time may be at most ${String(maxAheadDays)} days ahead: ${job.scheduledAt} is after ${latest.toISOString()}`,
      },
    ];
  }

  /** The UTC day rule job-ui's form applies too, shared through the kernel, fixed at `now`. */
  private departureDayAt(now: Date): DepartureDay {
    return new UtcDepartureDay({ clock: { now: () => ({ now }) } });
  }

  private requireStatus({ current, statuses }: RequireStatusRequest): void {
    if (!statuses.includes(current.status)) {
      throw new JobStatusConflictError({ id: current.id, status: current.status });
    }
  }

  private requireValidResult({ current, result }: RequireValidResultRequest): void {
    const parsed = JOB_RESULT_SCHEMAS[current.type].safeParse(result);
    if (!parsed.success) throw new InvalidJobResultError({ issues: parsed.error.issues });
  }

  /** The job keeps its status when this fails; the sweep in `crash-recovery` queues it later. */
  private async enqueue({ jobId, attempt, priority, runAt }: EnqueueRequest): Promise<void> {
    try {
      await this.d.queue.enqueue({ jobId, attempt, priority, runAt });
    } catch (err) {
      this.d.logger.warn({ err, jobId, attempt }, 'Job keeps its status: it could not be queued');
    }
  }

  /** Like `enqueue`, for the first attempts of a bulk in one call. */
  private async enqueueFirstAttempts(jobs: readonly Job[]): Promise<void> {
    try {
      await this.d.queue.enqueueMany({
        entries: jobs.map((job) => ({
          jobId: job.id,
          attempt: 1,
          priority: job.priority,
          runAt: job.scheduledAt,
        })),
      });
    } catch (err) {
      this.d.logger.warn(
        { err, jobIds: jobs.map((job) => job.id) },
        'Jobs keep their status: they could not be queued',
      );
    }
  }

  private now(): string {
    return this.d.clock.now().now.toISOString();
  }
}
