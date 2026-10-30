import type { Job, JobError, UpdateJobRequest } from '@job-queue/contracts';
import { DomainError, JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import pRetry from 'p-retry';

import { JOB_ERROR_CODES } from '../../domain/execution/job-error-codes.js';
import type {
  AbortJobExecutionResponse,
  ExecuteJobExecutionRequest,
  ExecuteJobExecutionResponse,
  JobExecution,
} from '../../domain/execution/job-execution.js';
import { InvalidJobError } from '../../domain/jobs/errors/invalid-job.error.js';
import { JobServiceUnavailableError } from '../../domain/jobs/errors/job-service-unavailable.error.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';
import type { JobHandlers } from '../../domain/notifications/job-handler.js';

export interface JobExecutionImplDeps {
  jobs: JobRepository;
  handlers: JobHandlers;
  logger: Pick<LoggerService, 'log' | 'warn' | 'error'>;
}

export interface JobExecutionImplParams {
  /** How often a call to job-service that could not reach it is tried again. */
  reportRetries: number;
  /** The wait before the first retry; it doubles (randomized) up to the maximum. */
  reportRetryDelayMs: number;
  reportRetryMaxDelayMs: number;
}

/** The fields of every log line about one entry (the instance id is on every line already). */
interface EntryFields {
  jobId: string;
  attempt: number;
}

interface ReadRequest {
  fields: EntryFields;
}

/**
 * What reading the job led to: the runnable job, a job that cannot run (it still has to be started
 * before job-service accepts its failure), or the entry's final outcome.
 */
type ReadResponse = { job: Job } | { invalid: JobError } | ExecuteJobExecutionResponse;

interface ReportRequest {
  fields: EntryFields;
  update: UpdateJobRequest;
}

/** `delivered`, refused by job-service (`refused`), or given up after the last try (`abandoned`). */
type ReportResponse = 'delivered' | 'refused' | 'abandoned';

interface FailRequest {
  fields: EntryFields;
  error: JobError;
}

interface WithRetryRequest<T> {
  fields: EntryFields;
  call: () => Promise<T>;
}

/**
 * One queued attempt, start to finish. The worker never decides a job's state: it reads the job,
 * asks job-service to start it, runs the handler of its type and reports the outcome; job-service
 * decides retries. Only "job-service unavailable" is retried here; a conflict or a missing job means
 * another party owns the job now, so the entry is dropped quietly.
 */
export class JobExecutionImpl implements JobExecution {
  /** Aborted once, when the worker gives up on its running jobs. */
  private readonly running = new AbortController();

  constructor(
    private readonly d: JobExecutionImplDeps,
    private readonly p: JobExecutionImplParams,
  ) {}

  async execute(req: ExecuteJobExecutionRequest): Promise<ExecuteJobExecutionResponse> {
    const fields: EntryFields = { jobId: req.jobId, attempt: req.attempt };
    try {
      const read = await this.read({ fields });
      if ('outcome' in read) return read;

      const started = await this.report({ fields, update: { status: 'processing' } });
      if (started === 'refused') {
        this.d.logger.log(fields, 'Skipped: job-service did not let this worker start the job');
        return { outcome: 'skipped' };
      }
      if (started === 'abandoned') return { outcome: 'abandoned' };
      this.d.logger.log(fields, 'Job started');

      if ('invalid' in read) return await this.fail({ fields, error: read.invalid });
      const { job } = read;
      const handler = this.d.handlers[job.type];
      if (handler === undefined) {
        return await this.fail({
          fields,
          error: {
            code: JOB_ERROR_CODES.unsupportedJobType,
            message: `No handler for job type ${job.type}`,
          },
        });
      }

      let result: unknown;
      try {
        ({ result } = await handler.run({ job, signal: this.running.signal }));
      } catch (error) {
        if (this.running.signal.aborted) return this.abandon({ fields });
        return await this.fail({ fields, error: this.toJobError(error) });
      }
      if (this.running.signal.aborted) return this.abandon({ fields });

      const completed = await this.report({ fields, update: { status: 'completed', result } });
      if (completed !== 'delivered') return { outcome: 'abandoned' };
      this.d.logger.log(fields, 'Job completed');
      return { outcome: 'completed' };
    } catch (err) {
      // Nothing above should throw; this keeps a bug from failing the queue entry.
      this.d.logger.error({ ...fields, err }, 'Job execution failed unexpectedly');
      return { outcome: 'abandoned' };
    }
  }

  abort(): AbortJobExecutionResponse {
    this.running.abort(new Error('Running jobs were abandoned at shutdown'));
    return {};
  }

  /** The worker gave up on this job: nothing more is reported, it stays `processing`. */
  private abandon({ fields }: ReadRequest): ExecuteJobExecutionResponse {
    this.d.logger.warn(fields, 'Abandoned at shutdown: the job stays processing');
    return { outcome: 'abandoned' };
  }

  private async read({ fields }: ReadRequest): Promise<ReadResponse> {
    try {
      const { job } = await this.withRetry({
        fields,
        call: () => this.d.jobs.get({ id: fields.jobId, signal: this.running.signal }),
      });
      if (job.status !== 'pending') {
        this.d.logger.log({ ...fields, status: job.status }, 'Skipped: job is no longer pending');
        return { outcome: 'skipped' };
      }
      return { job };
    } catch (error) {
      if (this.running.signal.aborted) return this.abandon({ fields });
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

  private async fail({ fields, error }: FailRequest): Promise<ExecuteJobExecutionResponse> {
    this.d.logger.warn({ ...fields, code: error.code }, 'Job failed');
    const reported = await this.report({ fields, update: { status: 'failed', error } });
    return { outcome: reported === 'delivered' ? 'failed' : 'abandoned' };
  }

  /** Sends one state report; job-service refusing it is an answer, not an error. */
  private async report({ fields, update }: ReportRequest): Promise<ReportResponse> {
    try {
      await this.withRetry({
        fields,
        call: () => this.d.jobs.update({ id: fields.jobId, update, signal: this.running.signal }),
      });
      return 'delivered';
    } catch (error) {
      if (this.running.signal.aborted) {
        this.abandon({ fields });
        return 'abandoned';
      }
      if (error instanceof JobStatusConflictError || error instanceof JobNotFoundError) {
        return 'refused';
      }
      this.d.logger.error(
        { ...fields, status: update.status, err: error },
        'Gave up reporting to job-service; the job keeps its last accepted state',
      );
      return 'abandoned';
    }
  }

  /**
   * Calls job-service, trying again while it is unavailable: each wait doubles from the configured
   * delay up to the maximum, randomized so workers do not retry together; `abort()` ends a wait.
   */
  private withRetry<T>({ fields, call }: WithRetryRequest<T>): Promise<T> {
    return pRetry(call, {
      retries: this.p.reportRetries,
      minTimeout: this.p.reportRetryDelayMs,
      maxTimeout: this.p.reportRetryMaxDelayMs,
      factor: 2,
      randomize: true,
      signal: this.running.signal,
      shouldRetry: ({ error, attemptNumber }) => {
        if (!(error instanceof JobServiceUnavailableError)) return false;
        this.d.logger.warn(
          { ...fields, retry: attemptNumber },
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
