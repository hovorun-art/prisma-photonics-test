import { JobLogStreamMessage } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import pRetry, { type Options as PRetryOptions } from 'p-retry';

import { JobLogStreamGroupMissingError } from '../../domain/job-log/errors/job-log-stream-group-missing.error.js';
import type {
  JobLogWriter,
  StartJobLogWriterResponse,
  StopJobLogWriterResponse,
} from '../../domain/job-log/job-log-writer.js';
import type { JobLogSchema } from '../../domain/job-log/job-log-schema.js';
import type { PositionedJobLogEntry, JobLogStore } from '../../domain/job-log/job-log-store.js';
import type { JobLogStream, JobLogStreamRecord } from '../../domain/job-log/job-log-stream.js';

export interface JobLogWriterImplDeps {
  stream: JobLogStream;
  store: JobLogStore;
  /** Applied before the first round, and again on each round until it succeeds. */
  schema: JobLogSchema;
  clock: Clock;
  logger: Pick<LoggerService, 'warn'>;
}

export interface JobLogWriterImplParams {
  /** Most entries stored in one batch. */
  batchSize: number;
  /** Longest wait after the first entry of a batch before it is stored. */
  flushIntervalMs: number;
  /** First wait before a failed batch is tried again; doubled each time up to the maximum. */
  retryDelayMs: number;
  retryMaxDelayMs: number;
}

interface ParseRecordsRequest {
  records: JobLogStreamRecord[];
}

interface ParseRecordsResponse {
  entries: PositionedJobLogEntry[];
}

interface RetryOptionsRequest {
  signal: AbortSignal;
  /** Called with the error of each failed attempt, before the wait. */
  onFailed: (error: Error) => void;
  /** Whether the failed attempt is tried again at all. */
  retryAllowed: () => boolean;
}

interface RetryOptionsResponse {
  options: PRetryOptions;
}

/**
 * The single loop that moves job log entries from the stream into the store (design §4): it
 * reads, stores, and only then confirms; a store that fails is retried with a growing wait before
 * anything new is read, so entries wait in the stream while the store is down. The stream's group and the store's schema
 * are prepared in the loop too, so a store that is down at startup delays the log, not the service.
 * Both retries (a failed batch, a failed round) are `p-retry` without a limit: the wait doubles from
 * the configured delay up to the maximum, and stopping the writer ends a wait.
 */
export class JobLogWriterImpl implements JobLogWriter {
  private readonly stopping = new AbortController();
  private loop: Promise<void> | undefined;
  private streamPrepared = false;
  private schemaApplied = false;

  constructor(
    private readonly d: JobLogWriterImplDeps,
    private readonly p: JobLogWriterImplParams,
  ) {}

  start(): StartJobLogWriterResponse {
    this.loop ??= this.run();
    return {};
  }

  async stop(): Promise<StopJobLogWriterResponse> {
    this.stopping.abort();
    await this.loop;
    return {};
  }

  private async run(): Promise<void> {
    while (!this.isStopping()) {
      try {
        // One call per streak of failures: the next failure after a good round starts at the base wait.
        await pRetry(
          () => this.untyped(() => this.round()),
          this.retryOptions({
            signal: this.stopping.signal,
            retryAllowed: () => !this.isStopping(),
            onFailed: (error) => {
              if (this.isStopping()) return;
              // The group is gone (the stream was deleted): it is created again before the next read.
              if (error instanceof JobLogStreamGroupMissingError) this.streamPrepared = false;
              this.d.logger.warn(`Job log writer round failed: ${this.describe(error)}`);
            },
          }).options,
        );
      } catch (error) {
        if (!this.isStopping()) throw error;
      }
    }
  }

  private async round(): Promise<void> {
    // The stream first: entries appended while the store is down wait in the group.
    if (!this.streamPrepared) {
      await this.d.stream.prepare();
      this.streamPrepared = true;
    }
    if (!this.schemaApplied) {
      await this.d.schema.apply();
      this.schemaApplied = true;
    }
    if (!(await this.d.stream.lease()).held) {
      await this.idle();
      return;
    }
    const pending = await this.d.stream.read({
      pending: true,
      count: this.p.batchSize,
      blockMs: 0,
    });
    if (pending.records.length > 0) {
      await this.handle(pending.records);
      return;
    }
    const records = await this.collect();
    if (records.length > 0) await this.handle(records);
  }

  /** New entries: up to a full batch, or what arrived within the flush interval of the first. */
  private async collect(): Promise<JobLogStreamRecord[]> {
    const { records } = await this.d.stream.read({
      pending: false,
      count: this.p.batchSize,
      blockMs: this.p.flushIntervalMs,
    });
    if (records.length === 0 || records.length >= this.p.batchSize || this.isStopping()) {
      return records;
    }
    const startedAt = this.d.clock.now().now.getTime();
    while (records.length < this.p.batchSize && !this.isStopping()) {
      const remaining = this.p.flushIntervalMs - (this.d.clock.now().now.getTime() - startedAt);
      if (remaining <= 0) break;
      const more = await this.d.stream.read({
        pending: false,
        count: this.p.batchSize - records.length,
        blockMs: Math.ceil(remaining),
      });
      records.push(...more.records);
    }
    return records;
  }

  private async handle(records: JobLogStreamRecord[]): Promise<void> {
    const { entries } = this.parse({ records });
    if (entries.length > 0 && !(await this.store(entries))) return;
    await this.d.stream.ack({ positions: records.map((record) => record.position) });
  }

  /** The valid entries of a batch; a malformed message is logged and left to be confirmed. */
  private parse(req: ParseRecordsRequest): ParseRecordsResponse {
    const entries: PositionedJobLogEntry[] = [];
    for (const record of req.records) {
      const entry = this.validate(record.body);
      if (entry === undefined) {
        this.d.logger.warn(`Malformed job log entry skipped (stream position ${record.position})`);
      } else {
        entries.push({ position: record.position, entry });
      }
    }
    return { entries };
  }

  private validate(body: string): JobLogStreamMessage | undefined {
    try {
      const parsed = JobLogStreamMessage.safeParse(JSON.parse(body));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Stores the batch, trying again after a growing wait until it works. False when it was given up
   * (the writer is stopping, or the lease passed on): the batch stays unconfirmed in the stream.
   * Stopping ends a wait, but a first attempt still runs and a stored batch is still confirmed.
   */
  private async store(entries: PositionedJobLogEntry[]): Promise<boolean> {
    const waiting = new AbortController();
    const endWait = (): void => {
      waiting.abort(this.stopping.signal.reason);
    };
    if (!this.isStopping()) this.stopping.signal.addEventListener('abort', endWait, { once: true });
    let stored = false;
    try {
      return await pRetry(
        (attempt) =>
          this.untyped(async () => {
            // Before each retry: the batch is only retried while this instance still holds the lease.
            if (attempt > 1 && !(await this.d.stream.lease()).held) return false;
            await this.d.store.insert({ entries });
            stored = true;
            return true;
          }),
        this.retryOptions({
          signal: waiting.signal,
          retryAllowed: () => !this.isStopping(),
          onFailed: (error) => {
            if (this.isStopping()) return;
            this.d.logger.warn(`Job log batch not stored, will retry: ${this.describe(error)}`);
          },
        }).options,
      );
    } catch (error) {
      if (this.isStopping()) return stored;
      throw error;
    } finally {
      this.stopping.signal.removeEventListener('abort', endWait);
    }
  }

  private retryOptions(req: RetryOptionsRequest): RetryOptionsResponse {
    return {
      options: {
        retries: Infinity,
        factor: 2,
        minTimeout: this.p.retryDelayMs,
        maxTimeout: this.p.retryMaxDelayMs,
        randomize: false,
        signal: req.signal,
        onFailedAttempt: ({ error }) => {
          req.onFailed(error);
        },
        shouldRetry: () => req.retryAllowed(),
      },
    };
  }

  /**
   * p-retry gives up on a TypeError that is not a network error and on a value that is not an
   * Error; here every failure is retried, so both are wrapped in a plain Error.
   */
  private async untyped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Error && !(error instanceof TypeError)) throw error;
      throw new Error(this.describe(error), { cause: error });
    }
  }

  /** Waits one flush interval before the next round, or until the writer is stopped. */
  private idle(): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.stopping.signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, this.p.flushIntervalMs);
      this.stopping.signal.addEventListener('abort', done, { once: true });
    });
  }

  private isStopping(): boolean {
    return this.stopping.signal.aborted;
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
