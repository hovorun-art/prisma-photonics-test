import {
  type Job,
  type JobError,
  type JobStatus,
  STARTABLE_JOB_STATUSES,
  type UpdateJobRequest,
} from '@job-queue/contracts';
import {
  type Clock,
  DomainError,
  JobNotFoundError,
  JobServiceUnavailableError,
  JobStatusConflictError,
} from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import pRetry from 'p-retry';

import { JOB_ERROR_CODES } from '../../domain/execution/job-error-codes.js';
import type {
  AbortJobExecutionResponse,
  CancelJobExecutionRequest,
  CancelJobExecutionResponse,
  ExecuteJobExecutionRequest,
  ExecuteJobExecutionResponse,
  JobExecution,
} from '../../domain/execution/job-execution.js';
import { InvalidJobError } from '../../domain/jobs/errors/invalid-job.error.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';
import type {
  JobHandler,
  JobHandlers,
  RunJobHandlerResponse,
} from '../../domain/execution/job-handler.js';

export interface JobExecutionImplDeps {
  jobs: JobRepository;
  handlers: JobHandlers;
  clock: Clock;
  logger: Pick<LoggerService, 'log' | 'warn' | 'error'>;
}

export interface JobExecutionImplParams {
  /** How often a call to job-service that could not reach it is tried again. */
  reportRetries: number;
  /** The wait before the first retry; it doubles (randomized) up to the maximum. */
  reportRetryDelayMs: number;
  reportRetryMaxDelayMs: number;
}

/** `Omit` applied to every member of a union, so the report variants stay apart. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The fields of every log line about one entry (the instance id is on every line already). */
interface EntryFields {
  jobId: string;
  attempt: number;
}

/** One entry being run: its log fields and its own abort, by a cancel or by the shutdown. */
interface RunningEntry {
  fields: EntryFields;
  /** The job's run the entry belongs to; every report names it with the attempt. */
  run: number;
  /** Aborted when job-service cancels this job. */
  cancel: AbortController;
  /** Aborted by a cancel of this job or when the worker gives up on all running jobs. */
  signal: AbortSignal;
}

interface EntryRequest {
  entry: RunningEntry;
}

/**
 * What reading the job led to: the runnable job, a job that cannot run (it still has to be started
 * before job-service accepts its failure), or the entry's final outcome.
 */
type ReadResponse =
  { job: Job; maxProcessingMs: number } | { invalid: JobError } | ExecuteJobExecutionResponse;

interface ReportRequest {
  entry: RunningEntry;
  /** The report without the entry's run and attempt, which `report` adds. */
  update: DistributiveOmit<UpdateJobRequest, 'run' | 'attempt'>;
}

/**
 * `delivered`, refused by job-service (`refused`), given up after the last try (`abandoned`), or
 * stopped because the job was cancelled (`cancelled`).
 */
interface ReportResponse {
  result: 'delivered' | 'refused' | 'abandoned' | 'cancelled';
  /** The job's current status, when job-service refused the report with a status conflict. */
  conflictStatus?: string | undefined;
}

interface RunHandlerRequest {
  fields: EntryFields;
  handler: JobHandler;
  job: Job;
  /** Aborted when the job is cancelled or the worker gives up at shutdown. */
  signal: AbortSignal;
  /** The handler is aborted when it has run this long. */
  maxProcessingMs: number;
}

/** How the handler ended: with its outcome, by throwing, or by running into the time limit. */
type RunHandlerResult =
  | { ended: 'returned'; ran: RunJobHandlerResponse }
  | { ended: 'threw'; error: unknown }
  | { ended: 'timed out' };

interface FailRequest {
  entry: RunningEntry;
  error: JobError;
}

interface OutcomeRequest {
  entry: RunningEntry;
  /** The report's status, logged when job-service refuses it. */
  status: UpdateJobRequest['status'];
  reported: ReportResponse;
  /** The outcome when the report was delivered. */
  delivered: ExecuteJobExecutionResponse['outcome'];
}

interface WithRetryRequest<T> {
  entry: RunningEntry;
  call: () => Promise<T>;
}

/**
 * One queued attempt, start to finish. The worker never decides a job's state: it reads the job,
 * asks job-service to start it, runs the handler of its type and reports the outcome; job-service
 * decides retries. Only "job-service unavailable" is retried here; a conflict or a missing job means
 * another party owns the job now, so the entry is dropped quietly. A job job-service cancels is
 * stopped where it is (`cancel`) and reported no further, since it is already final.
 */
export class JobExecutionImpl implements JobExecution {
  /** Aborted once, when the worker gives up on its running jobs. */
  private readonly running = new AbortController();
  /**
   * The entries this worker runs, by job id, so a cancel finds them. A job may have more than one
   * (a redelivered entry next to one still running), and a cancel stops them all.
   */
  private readonly entries = new Map<string, Set<RunningEntry>>();

  constructor(
    private readonly d: JobExecutionImplDeps,
    private readonly p: JobExecutionImplParams,
  ) {}

  async execute(req: ExecuteJobExecutionRequest): Promise<ExecuteJobExecutionResponse> {
    const fields: EntryFields = { jobId: req.jobId, attempt: req.attempt };
    // Registered before the start is reported, so a cancel right after job-service accepted the
    // start still finds the job.
    const cancel = new AbortController();
    const entry: RunningEntry = {
      fields,
      run: req.run,
      cancel,
      signal: AbortSignal.any([this.running.signal, cancel.signal]),
    };
    const ofJob = this.entries.get(req.jobId) ?? new Set<RunningEntry>();
    ofJob.add(entry);
    this.entries.set(req.jobId, ofJob);
    try {
      return await this.run({ entry });
    } catch (err) {
      // Nothing in `run` should throw; this keeps a bug from failing the queue entry.
      this.d.logger.error({ ...fields, err }, 'Job execution failed unexpectedly');
      return { outcome: 'abandoned' };
    } finally {
      ofJob.delete(entry);
      if (ofJob.size === 0 && this.entries.get(req.jobId) === ofJob) {
        this.entries.delete(req.jobId);
      }
    }
  }

  /**
   * Runs the handler and logs its start and end (with the time it took, also when it throws). The
   * handler is aborted when it has run for `maxProcessingMs`; that is told apart from a cancel and
   * the shutdown by the caller, which looks at the entry's own signal first.
   */
  private async runHandler({
    fields,
    handler,
    job,
    signal,
    maxProcessingMs,
  }: RunHandlerRequest): Promise<RunHandlerResult> {
    const startedAt = this.d.clock.now().now.getTime();
    this.d.logger.log(fields, 'Handler started');
    const timeLimit = new AbortController();
    const timer = setTimeout(() => {
      timeLimit.abort(new Error(`The job ran longer than ${maxProcessingMs} ms`));
    }, maxProcessingMs);
    try {
      const ran = await handler.run({
        job,
        attempt: fields.attempt,
        signal: AbortSignal.any([signal, timeLimit.signal]),
      });
      return timeLimit.signal.aborted ? { ended: 'timed out' } : { ended: 'returned', ran };
    } catch (error) {
      return timeLimit.signal.aborted ? { ended: 'timed out' } : { ended: 'threw', error };
    } finally {
      clearTimeout(timer);
      const durationMs = this.d.clock.now().now.getTime() - startedAt;
      this.d.logger.log({ ...fields, durationMs }, 'Handler finished');
    }
  }

  abort(): AbortJobExecutionResponse {
    this.running.abort(new Error('Running jobs were abandoned at shutdown'));
    return {};
  }

  cancel(req: CancelJobExecutionRequest): CancelJobExecutionResponse {
    for (const entry of this.entries.get(req.jobId) ?? []) {
      entry.cancel.abort(new Error('The job was cancelled'));
    }
    return {};
  }

  private async run({ entry }: EntryRequest): Promise<ExecuteJobExecutionResponse> {
    const { fields } = entry;
    this.d.logger.log(fields, 'Attempt picked up');
    const read = await this.read({ entry });
    if ('outcome' in read) return read;

    const started = await this.report({ entry, update: { status: 'processing' } });
    if (started.result === 'refused') {
      this.d.logger.log(fields, 'Skipped: job-service did not let this worker start the job');
      return { outcome: 'skipped' };
    }
    if (started.result === 'cancelled') return this.stopped({ entry });
    if (started.result === 'abandoned') return { outcome: 'abandoned' };
    this.d.logger.log(fields, 'Job started');

    if ('invalid' in read) return await this.fail({ entry, error: read.invalid });
    const { job, maxProcessingMs } = read;
    const handler = this.d.handlers[job.type];
    if (handler === undefined) {
      return await this.fail({
        entry,
        error: {
          code: JOB_ERROR_CODES.unsupportedJobType,
          message: `No handler for job type ${job.type}`,
        },
      });
    }

    const ran = await this.runHandler({
      fields,
      handler,
      job,
      signal: entry.signal,
      maxProcessingMs,
    });
    if (entry.signal.aborted) return this.stopped({ entry });
    if (ran.ended === 'timed out') {
      return await this.fail({
        entry,
        error: {
          code: JOB_ERROR_CODES.jobTimeout,
          message: `The job ran longer than the maximum processing time of ${maxProcessingMs} ms`,
          details: { maxProcessingMs },
        },
      });
    }
    if (ran.ended === 'threw') {
      return await this.fail({ entry, error: this.toJobError(ran.error) });
    }
    if (ran.ran.outcome === 'failed') return await this.fail({ entry, error: ran.ran.error });

    const reported = await this.report({
      entry,
      update: { status: 'completed', result: ran.ran.result },
    });
    const outcome = this.outcome({ entry, status: 'completed', reported, delivered: 'completed' });
    if (outcome.outcome === 'completed') this.d.logger.log(fields, 'Job completed');
    return outcome;
  }

  /**
   * The job stopped where it was: cancelled by job-service, or given up at shutdown. Nothing more
   * is reported either way; a cancelled job is final, an abandoned one stays `processing`.
   */
  private stopped({ entry }: EntryRequest): ExecuteJobExecutionResponse {
    if (this.running.signal.aborted) {
      this.d.logger.warn(entry.fields, 'Abandoned at shutdown: the job stays processing');
      return { outcome: 'abandoned' };
    }
    this.d.logger.log(entry.fields, 'Stopped: the job was cancelled');
    return { outcome: 'cancelled' };
  }

  private async read({ entry }: EntryRequest): Promise<ReadResponse> {
    const { fields } = entry;
    try {
      const { job, maxProcessingMs } = await this.withRetry({
        entry,
        call: () => this.d.jobs.get({ id: fields.jobId, signal: entry.signal }),
      });
      if (!(STARTABLE_JOB_STATUSES as readonly JobStatus[]).includes(job.status)) {
        this.d.logger.log({ ...fields, status: job.status }, 'Skipped: job is no longer startable');
        return { outcome: 'skipped' };
      }
      return { job, maxProcessingMs };
    } catch (error) {
      if (entry.signal.aborted) return this.stopped({ entry });
      if (error instanceof JobNotFoundError) {
        this.d.logger.log(fields, 'Skipped: job no longer exists');
        return { outcome: 'skipped' };
      }
      if (error instanceof InvalidJobError) {
        return {
          invalid: {
            code: JOB_ERROR_CODES.invalidPayload,
            message: error.message,
            details: error.details,
          },
        };
      }
      this.d.logger.error({ ...fields, err: error }, 'Gave up: job-service could not be reached');
      return { outcome: 'abandoned' };
    }
  }

  private async fail({ entry, error }: FailRequest): Promise<ExecuteJobExecutionResponse> {
    this.d.logger.warn({ ...entry.fields, code: error.code, details: error.details }, 'Job failed');
    const reported = await this.report({ entry, update: { status: 'failed', error } });
    return this.outcome({ entry, status: 'failed', reported, delivered: 'failed' });
  }

  /**
   * The entry's outcome after its last report. A refusal means the job changed meanwhile (most
   * often a cancel whose announcement this worker missed): a lost race, not an error.
   */
  private outcome({
    entry,
    status,
    reported,
    delivered,
  }: OutcomeRequest): ExecuteJobExecutionResponse {
    switch (reported.result) {
      case 'delivered':
        return { outcome: delivered };
      case 'refused':
        if (reported.conflictStatus !== undefined && reported.conflictStatus !== 'cancelled') {
          // The job moved on without this attempt: job-service recovered it (a lost worker, a
          // timeout) while this worker was only slow. The next attempt owns the job now.
          this.d.logger.warn(
            {
              ...entry.fields,
              run: entry.run,
              status,
              jobStatus: reported.conflictStatus,
            },
            'Report refused: the attempt was recovered',
          );
        } else {
          this.d.logger.log(
            { ...entry.fields, status },
            'Report refused: the job changed meanwhile (for example it was cancelled)',
          );
        }
        return { outcome: 'skipped' };
      case 'cancelled':
        return this.stopped({ entry });
      case 'abandoned':
        return { outcome: 'abandoned' };
    }
  }

  /**
   * Sends one state report for the entry's run and attempt; job-service refusing it is an answer,
   * not an error.
   */
  private async report({ entry, update }: ReportRequest): Promise<ReportResponse> {
    const { fields } = entry;
    const withEntry: UpdateJobRequest = { ...update, run: entry.run, attempt: fields.attempt };
    try {
      await this.withRetry({
        entry,
        call: () =>
          this.d.jobs.update({ id: fields.jobId, update: withEntry, signal: entry.signal }),
      });
      return { result: 'delivered' };
    } catch (error) {
      if (this.running.signal.aborted) {
        this.stopped({ entry });
        return { result: 'abandoned' };
      }
      if (entry.cancel.signal.aborted) return { result: 'cancelled' };
      if (error instanceof JobStatusConflictError) {
        const status = error.details.status;
        return {
          result: 'refused',
          conflictStatus: typeof status === 'string' ? status : undefined,
        };
      }
      if (error instanceof JobNotFoundError) return { result: 'refused' };
      this.d.logger.error(
        { ...fields, status: update.status, err: error },
        'Gave up reporting to job-service; the job keeps its last accepted state',
      );
      return { result: 'abandoned' };
    }
  }

  /**
   * Calls job-service, trying again while it is unavailable: each wait doubles from the configured
   * delay up to the maximum, randomized so workers do not retry together; a cancel of the job or
   * `abort()` ends a wait.
   */
  private withRetry<T>({ entry, call }: WithRetryRequest<T>): Promise<T> {
    return pRetry(call, {
      retries: this.p.reportRetries,
      minTimeout: this.p.reportRetryDelayMs,
      maxTimeout: this.p.reportRetryMaxDelayMs,
      factor: 2,
      randomize: true,
      signal: entry.signal,
      shouldRetry: ({ error, attemptNumber }) => {
        if (!(error instanceof JobServiceUnavailableError)) return false;
        this.d.logger.warn(
          { ...entry.fields, retry: attemptNumber },
          'job-service unavailable, retrying',
        );
        return true;
      },
    });
  }

  private toJobError(error: unknown): JobError {
    if (this.isDomainError(error)) return { code: error.code, message: error.message };
    return {
      code: JOB_ERROR_CODES.handlerError,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  /** `instanceof` alone narrows to `DomainError<any>`; this keeps the code in the closed set. */
  private isDomainError(value: unknown): value is DomainError {
    return value instanceof DomainError;
  }
}
