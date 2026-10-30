import {
  CANCELLABLE_JOB_STATUSES,
  type CreateJobRequest,
  FINISHED_JOB_STATUSES,
  JOB_LIMITS,
  JOB_RESULT_SCHEMAS,
  type Job,
  type JobError,
  type JobStatus,
  type UpdateJobRequest,
  STARTABLE_JOB_STATUSES,
} from '@job-queue/contracts';
import {
  type Clock,
  DaysAheadScheduleLimit,
  type DepartureDay,
  JobStatusConflictError,
  type ScheduleLimit,
  UtcDepartureDay,
} from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';

import { BulkLimitExceededError } from '../../domain/jobs/errors/bulk-limit-exceeded.error.js';
import { IdempotencyKeyConflictError } from '../../domain/jobs/errors/idempotency-key-conflict.error.js';
import { IdempotencyKeyTakenError } from '../../domain/jobs/errors/idempotency-key-taken.error.js';
import {
  InvalidJobFieldError,
  type JobFieldIssue,
} from '../../domain/jobs/errors/invalid-job-field.error.js';
import { InvalidJobPayloadError } from '../../domain/jobs/errors/invalid-job-payload.error.js';
import { InvalidJobResultError } from '../../domain/jobs/errors/invalid-job-result.error.js';
import type { PageLimit } from '@job-queue/kernel';
import type { JobQueue } from '../../domain/jobs/job-queue.js';
import type {
  JobChanges,
  JobRepository,
  NewJob,
  StoredJob,
} from '../../domain/jobs/job-repository.js';
import type { JobRequestFingerprint } from '../../domain/jobs/job-request-fingerprint.js';
import type { RetryDelay } from '../../domain/jobs/retry-delay.js';
import type {
  ChangeStatusJobServiceRequest,
  ChangeStatusJobServiceResponse,
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
  logger: Pick<LoggerService, 'log' | 'warn' | 'error'>;
  /** The configured page size rule of the job query. */
  pageLimit: PageLimit;
  /** How long a failed job waits before its next attempt. */
  retryDelay: RetryDelay;
  /** Tells a replayed submission from a different one under the same idempotency key. */
  fingerprint: JobRequestFingerprint;
}

/**
 * How often a bulk reads its keys and inserts its new jobs before it gives up: each loss to a
 * concurrent submission of the same key makes the next read find that key.
 */
export const BULK_INSERT_TRIES = 3;

export interface JobServiceImplParams {
  /** Most jobs one `createMany` may hold. */
  bulkMaxJobs: number;
}

interface FailureChangesRequest {
  current: Job;
  error: JobError;
  now: string;
}

interface KeyedRequest {
  /** The submission's idempotency key. */
  key: string;
  fingerprint: string;
}

interface FindReplayRequest {
  keyed: KeyedRequest;
}

interface FindReplaysRequest {
  /** One per keyed item of the bulk. */
  keyed: readonly KeyedRequest[];
}

interface SubmitRequest {
  job: CreateJobRequest;
  /** Stored with the key; `null` for a job without one. */
  fingerprint: string | null;
}

/** One item of a bulk with its position in the request. */
interface BulkItem {
  job: CreateJobRequest;
  position: number;
  /** The fingerprint of the item's request; `null` for an item without a key. */
  fingerprint: string | null;
}

interface StoreBulkRequest {
  items: readonly BulkItem[];
  now: Date;
}

interface StoreBulkResponse {
  jobs: Job[];
  created: boolean;
}

interface LogUpdateRequest {
  /** The job as it was before the report. */
  current: Job;
  /** The job after the report. */
  job: Job;
  update: UpdateJobRequest;
}

interface FindStartRequest {
  id: string;
  run: number;
  attempt: number;
}

interface RequireAttemptRequest {
  current: Job;
  /** The attempt the worker reports about. */
  attempt: number;
  /** The attempt the job's state calls for. */
  expected: number;
}

interface RequireStatusRequest {
  current: Job;
  /** The statuses the change is allowed from. */
  statuses: readonly JobStatus[];
}

interface RequireValidResultRequest {
  current: Job;
  result: unknown;
}

interface EnqueueRequest {
  jobId: string;
  run: number;
  attempt: number;
  priority: number;
  runAt: string | null;
}

interface CancelRequest {
  current: Job;
}

interface RetryRequest {
  current: Job;
  run: number;
}

interface NewJobRequest {
  job: CreateJobRequest;
  /** The instant the request is judged by: a later `scheduledAt` makes the job `scheduled`. */
  now: Date;
  /** Set for the jobs of a bulk; otherwise the database's clock sets it. */
  createdAt?: string;
  /** Stored with the job's idempotency key; `null` without one. */
  fingerprint: string | null;
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
 * concurrent report loses with a status conflict; a report for another run or attempt than the
 * job's current one is refused the same way. A failed attempt becomes `scheduled` for the retry
 * time the backoff gives (and its next attempt is queued for then, with the job's priority) while
 * attempts remain, otherwise it fails the job for good. A submission with an idempotency key
 * answers the job the key belongs to instead of storing another. `changeStatus` is the client's side: cancel or retry, written the same conditional
 * way. Queueing problems never fail a request: the job keeps its status (a cancel whose
 * announcement fails stays cancelled) and is logged.
 */
export class JobServiceImpl implements JobService {
  constructor(
    private readonly d: JobServiceImplDeps,
    private readonly p: JobServiceImplParams,
  ) {}

  /**
   * A submission with a key first looks the key up: the same request answers the existing job
   * before the time rules are checked. Losing the race to store the key re-reads once, since the
   * winner has committed by then.
   */
  async create(req: CreateJobServiceRequest): Promise<CreateJobServiceResponse> {
    const key = req.job.idempotencyKey;
    if (key === undefined) return this.submit({ job: req.job, fingerprint: null });
    const keyed = { key, fingerprint: this.d.fingerprint.of({ job: req.job }).fingerprint };
    const replay = await this.findReplay({ keyed });
    if (replay !== undefined) return { job: replay, created: false };
    try {
      return await this.submit({ job: req.job, fingerprint: keyed.fingerprint });
    } catch (err) {
      if (!(err instanceof IdempotencyKeyTakenError)) throw err;
      const winner = await this.findReplay({ keyed });
      if (winner === undefined) throw err;
      return { job: winner, created: false };
    }
  }

  /**
   * Every new item is checked before anything is stored, so a bad item stores nothing. Items whose
   * key belongs to a job submitted with the same request are answered with that job and left out of
   * the insert; a key that belongs to another request refuses the whole bulk. Losing the race for a
   * key restarts the read and the insert, up to `BULK_INSERT_TRIES` times.
   */
  async createMany(req: CreateManyJobServiceRequest): Promise<CreateManyJobServiceResponse> {
    if (req.jobs.length > this.p.bulkMaxJobs) {
      throw new BulkLimitExceededError({ maxJobs: this.p.bulkMaxJobs });
    }
    const now = this.d.clock.now().now;
    const items = req.jobs.map((job, position) => ({
      job,
      position,
      fingerprint:
        job.idempotencyKey === undefined ? null : this.d.fingerprint.of({ job }).fingerprint,
    }));
    for (let tries = 1; ; tries += 1) {
      try {
        return await this.storeBulk({ items, now });
      } catch (err) {
        if (!(err instanceof IdempotencyKeyTakenError)) throw err;
        if (tries >= BULK_INSERT_TRIES) {
          this.d.logger.error(
            { err, tries },
            'Bulk not stored: its idempotency keys kept being taken by concurrent submissions',
          );
          throw err;
        }
      }
    }
  }

  async get(req: GetJobServiceRequest): Promise<GetJobServiceResponse> {
    const { job } = await this.d.repository.get({ id: req.id });
    return { job };
  }

  async query(req: QueryJobServiceRequest): Promise<QueryJobServiceResponse> {
    const { limit } = this.d.pageLimit.resolve({ limit: req.limit });
    return this.d.repository.query({
      limit,
      offset: req.offset,
      statuses: req.statuses,
      types: req.types,
      groupId: req.groupId,
    });
  }

  async update(req: UpdateJobServiceRequest): Promise<UpdateJobServiceResponse> {
    const { job: current, run } = await this.d.repository.get({ id: req.id });
    const { update } = req;
    if (update.run !== run) throw this.conflict(current);
    let changes: JobChanges;

    switch (update.status) {
      case 'processing':
        // The same attempt reporting its start again (its first answer was lost): nothing to do.
        if (current.status === 'processing' && current.attempts === update.attempt) {
          return { job: current };
        }
        this.requireStatus({ current, statuses: STARTABLE_JOB_STATUSES });
        this.requireAttempt({ current, attempt: update.attempt, expected: current.attempts + 1 });
        changes = {
          status: 'processing',
          attempts: current.attempts + 1,
          startedAt: this.now(),
        };
        break;
      case 'completed':
        this.requireStatus({ current, statuses: ['processing'] });
        this.requireAttempt({ current, attempt: update.attempt, expected: current.attempts });
        this.requireValidResult({ current, result: update.result });
        changes = {
          status: 'completed',
          result: update.result,
          error: null,
          completedAt: this.now(),
        };
        break;
      case 'failed':
        this.requireStatus({ current, statuses: ['processing'] });
        this.requireAttempt({ current, attempt: update.attempt, expected: current.attempts });
        changes = this.failureChanges({ current, error: update.error, now: this.now() });
        break;
    }

    let job: Job;
    try {
      ({ job } = await this.d.repository.update({
        id: req.id,
        expected: { status: current.status, attempts: current.attempts },
        changes,
      }));
    } catch (err) {
      const startedMeanwhile =
        update.status === 'processing' && err instanceof JobStatusConflictError
          ? await this.findStartOf({ id: req.id, run: update.run, attempt: update.attempt })
          : undefined;
      if (startedMeanwhile === undefined) throw err;
      return { job: startedMeanwhile };
    }
    this.logUpdate({ current, job, update });
    // A failure does not change attempts, so the retry is the attempt after the loaded one. It
    // keeps the job's priority and waits for the backoff time the job now carries.
    if (job.status === 'scheduled')
      await this.enqueue({
        jobId: job.id,
        run,
        attempt: current.attempts + 1,
        priority: current.priority,
        runAt: job.scheduledAt,
      });
    return { job };
  }

  async changeStatus(req: ChangeStatusJobServiceRequest): Promise<ChangeStatusJobServiceResponse> {
    const { job: current, run } = await this.d.repository.get({ id: req.id });
    switch (req.change.status) {
      case 'cancelled':
        return this.cancel({ current });
      case 'pending':
        return this.retry({ current, run });
    }
  }

  async delete(req: DeleteJobServiceRequest): Promise<DeleteJobServiceResponse> {
    await this.d.repository.delete({ id: req.id, allowedStatuses: FINISHED_JOB_STATUSES });
    return {};
  }

  /** The job log line of an accepted report (a failure that retries is logged before its queueing). */
  private logUpdate({ current, job, update }: LogUpdateRequest): void {
    const jobId = job.id;
    switch (update.status) {
      case 'processing':
        this.d.logger.log({ jobId, attempt: current.attempts + 1 }, 'Attempt started');
        break;
      case 'completed':
        this.d.logger.log({ jobId, attempt: current.attempts }, 'Job completed');
        break;
      case 'failed': {
        const fields = {
          jobId,
          attempt: current.attempts,
          code: update.error.code,
          message: update.error.message,
        };
        if (job.status === 'scheduled')
          this.d.logger.warn(fields, 'Attempt failed, retry scheduled');
        else this.d.logger.error(fields, 'Job failed for good');
        break;
      }
    }
  }

  /**
   * Cancels a waiting or running job, then announces it so the worker running it stops. A failed
   * announcement is only logged: the job is cancelled, and a late report from the worker is refused.
   * Announced for a pending job too, since a worker may have started it since it was read.
   */
  private async cancel({ current }: CancelRequest): Promise<ChangeStatusJobServiceResponse> {
    this.requireStatus({ current, statuses: CANCELLABLE_JOB_STATUSES });
    const { job } = await this.d.repository.update({
      id: current.id,
      expected: { status: current.status, attempts: current.attempts },
      changes: { status: 'cancelled', completedAt: this.now() },
    });
    try {
      await this.d.queue.cancel({ jobId: job.id });
    } catch (err) {
      this.d.logger.warn({ err, jobId: job.id }, 'Cancelled job could not be announced to workers');
    }
    return { job };
  }

  /** Starts a failed job again as if newly submitted, in a new run so its queue entries are new. */
  private async retry({ current, run }: RetryRequest): Promise<ChangeStatusJobServiceResponse> {
    this.requireStatus({ current, statuses: ['failed'] });
    const { job } = await this.d.repository.update({
      id: current.id,
      expected: { status: current.status, attempts: current.attempts },
      changes: {
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
        scheduledAt: null,
        run: run + 1,
      },
    });
    // A retry runs at once, with the job's own priority, even for a job once scheduled.
    await this.enqueue({
      jobId: job.id,
      run: run + 1,
      attempt: 1,
      priority: job.priority,
      runAt: null,
    });
    return { job };
  }

  /**
   * Retry while attempts remain (the attempt was counted on start): the job waits as `scheduled`
   * until the backoff time, which grows with the number of attempts made. Otherwise fail for good.
   */
  private failureChanges({ current, error, now }: FailureChangesRequest): JobChanges {
    if (current.attempts >= current.maxAttempts) {
      return { status: 'failed', error, completedAt: now };
    }
    const { delayMs } = this.d.retryDelay.of({ retry: current.attempts });
    return {
      status: 'scheduled',
      error,
      scheduledAt: new Date(Date.parse(now) + delayMs).toISOString(),
      completedAt: null,
    };
  }

  /**
   * A new job as submitted: scheduled when its execution time is after `now`, otherwise pending;
   * nothing run yet, in no group and with no key unless the request names them.
   */
  private newJob({ job, now, createdAt, fingerprint }: NewJobRequest): NewJob {
    const scheduledAt = job.scheduledAt ?? null;
    return {
      ...job,
      status:
        scheduledAt !== null && Date.parse(scheduledAt) > now.getTime() ? 'scheduled' : 'pending',
      attempts: 0,
      result: null,
      error: null,
      groupId: job.groupId ?? null,
      idempotencyKey: job.idempotencyKey ?? null,
      requestFingerprint: fingerprint,
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
    const { latest, tooFar } = this.scheduleLimitAt(now).check({
      scheduledAt: new Date(job.scheduledAt),
    });
    if (!tooFar) return [];
    return [
      {
        code: 'too_big',
        path: ['scheduledAt'],
        message: `The execution time may be at most ${String(JOB_LIMITS.scheduledAt.maxAheadDays)} days ahead: ${job.scheduledAt} is after ${latest.toISOString()}`,
      },
    ];
  }

  /** The how-far-ahead rule job-ui's form applies too, shared through the kernel, fixed at `now`. */
  private scheduleLimitAt(now: Date): ScheduleLimit {
    return new DaysAheadScheduleLimit(
      { clock: { now: () => ({ now }) } },
      { maxAheadDays: JOB_LIMITS.scheduledAt.maxAheadDays },
    );
  }

  /** The UTC day rule job-ui's form applies too, shared through the kernel, fixed at `now`. */
  private departureDayAt(now: Date): DepartureDay {
    return new UtcDepartureDay({ clock: { now: () => ({ now }) } });
  }

  /** Checks the time rules, stores a new job and queues its first attempt. */
  private async submit({
    job: request,
    fingerprint,
  }: SubmitRequest): Promise<CreateJobServiceResponse> {
    const now = this.d.clock.now().now;
    const departureIssues = this.departureDayIssues({
      job: request,
      departureDay: this.departureDayAt(now),
    });
    const scheduleIssues = this.scheduleIssues({ job: request, now });
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
    const { job } = await this.d.repository.create({
      job: this.newJob({ job: request, now, fingerprint }),
    });
    this.d.logger.log({ jobId: job.id }, 'Job submitted');
    await this.enqueue({
      jobId: job.id,
      run: 1,
      attempt: 1,
      priority: job.priority,
      runAt: job.scheduledAt,
    });
    return { job, created: true };
  }

  /**
   * One read of the bulk's keys, then the insert of the items without a job. All items are judged
   * at one instant, the one the jobs are stamped from, so a bulk sent at midnight (UTC) is not
   * split across two days. The new jobs are stamped one millisecond apart by their position in the
   * request, so the newest-first query keeps the request order.
   */
  private async storeBulk({ items, now }: StoreBulkRequest): Promise<StoreBulkResponse> {
    const keyed = items.flatMap(({ job, fingerprint }) =>
      job.idempotencyKey === undefined || fingerprint === null
        ? []
        : [{ key: job.idempotencyKey, fingerprint }],
    );
    const replays = await this.findReplays({ keyed });
    const fresh = items.filter(
      ({ job }) => job.idempotencyKey === undefined || !replays.has(job.idempotencyKey),
    );
    const departureDay = this.departureDayAt(now);
    const issues = fresh.flatMap(({ job, position }) => [
      ...this.scheduleIssues({ job, now }).map((issue) => ({
        ...issue,
        path: [position, ...issue.path],
      })),
      ...this.departureDayIssues({ job, departureDay }).map((issue) => ({
        ...issue,
        path: [position, 'payload', ...issue.path],
      })),
    ]);
    if (issues.length > 0) throw new InvalidJobFieldError({ field: ['jobs'], issues });

    const stored = new Map<number, Job>();
    if (fresh.length > 0) {
      const { jobs: created } = await this.d.repository.createMany({
        jobs: fresh.map(({ job, position, fingerprint }) =>
          this.newJob({
            job,
            now,
            createdAt: new Date(now.getTime() + position).toISOString(),
            fingerprint,
          }),
        ),
      });
      created.forEach((job, index) => {
        const item = fresh[index];
        if (item !== undefined) stored.set(item.position, job);
      });
      for (const job of created) this.d.logger.log({ jobId: job.id }, 'Job submitted');
      await this.enqueueFirstAttempts(created);
    }
    return {
      jobs: items.flatMap(({ job, position }) => {
        const answer =
          stored.get(position) ??
          (job.idempotencyKey === undefined ? undefined : replays.get(job.idempotencyKey));
        return answer === undefined ? [] : [answer];
      }),
      created: stored.size > 0,
    };
  }

  /**
   * The job a keyed submission replays, or `undefined` when the key is free. Throws
   * `IdempotencyKeyConflictError` when the key belongs to a job submitted with another request.
   */
  private async findReplay({ keyed }: FindReplayRequest): Promise<Job | undefined> {
    return (await this.findReplays({ keyed: [keyed] })).get(keyed.key);
  }

  /** The existing job of each key that has one, by key. Throws like `findReplay`. */
  private async findReplays({ keyed }: FindReplaysRequest): Promise<Map<string, Job>> {
    const replays = new Map<string, Job>();
    if (keyed.length === 0) return replays;
    const { jobs } = await this.d.repository.findByIdempotencyKeys({
      keys: keyed.map(({ key }) => key),
    });
    const fingerprints = new Map(keyed.map(({ key, fingerprint }) => [key, fingerprint]));
    for (const stored of jobs) {
      const key = stored.job.idempotencyKey;
      if (key === null) continue;
      if (stored.requestFingerprint !== fingerprints.get(key)) {
        throw new IdempotencyKeyConflictError({
          idempotencyKey: key,
          existingJobId: stored.job.id,
        });
      }
      replays.set(key, stored.job);
    }
    return replays;
  }

  /**
   * After a start lost the conditional write: the job as the winner left it when that was the same
   * attempt starting (two starts of one entry), otherwise `undefined` and the loss stands.
   */
  private async findStartOf({ id, run, attempt }: FindStartRequest): Promise<Job | undefined> {
    const { job, run: storedRun }: StoredJob = await this.d.repository.get({ id });
    return job.status === 'processing' && storedRun === run && job.attempts === attempt
      ? job
      : undefined;
  }

  private conflict(current: Job): JobStatusConflictError {
    return new JobStatusConflictError({ id: current.id, status: current.status });
  }

  /** A report about an attempt other than the one the job's state calls for is refused. */
  private requireAttempt({ current, attempt, expected }: RequireAttemptRequest): void {
    if (attempt !== expected) throw this.conflict(current);
  }

  private requireStatus({ current, statuses }: RequireStatusRequest): void {
    if (!statuses.includes(current.status)) {
      throw this.conflict(current);
    }
  }

  private requireValidResult({ current, result }: RequireValidResultRequest): void {
    const parsed = JOB_RESULT_SCHEMAS[current.type].safeParse(result);
    if (!parsed.success) throw new InvalidJobResultError({ issues: parsed.error.issues });
  }

  /** The job keeps its status when this fails; the sweep in `crash-recovery` queues it later. */
  private async enqueue({ jobId, run, attempt, priority, runAt }: EnqueueRequest): Promise<void> {
    try {
      await this.d.queue.enqueue({ jobId, run, attempt, priority, runAt });
      this.d.logger.log({ jobId, attempt }, 'Attempt queued');
    } catch (err) {
      this.d.logger.warn(
        { err, jobId, run, attempt },
        'Job keeps its status: it could not be queued',
      );
    }
  }

  /** Like `enqueue`, for the first attempts of a bulk in one call. */
  private async enqueueFirstAttempts(jobs: readonly Job[]): Promise<void> {
    try {
      await this.d.queue.enqueueMany({
        entries: jobs.map((job) => ({
          jobId: job.id,
          run: 1,
          attempt: 1,
          priority: job.priority,
          runAt: job.scheduledAt,
        })),
      });
      for (const job of jobs) this.d.logger.log({ jobId: job.id, attempt: 1 }, 'Attempt queued');
    } catch (err) {
      // One line per job, so each job's log shows it.
      for (const job of jobs) {
        this.d.logger.warn(
          { err, jobId: job.id, attempt: 1 },
          'Job keeps its status: it could not be queued',
        );
      }
    }
  }

  private now(): string {
    return this.d.clock.now().now.toISOString();
  }
}
