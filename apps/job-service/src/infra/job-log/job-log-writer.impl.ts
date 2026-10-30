import { JobLogStreamMessage } from '@job-queue/contracts';
import type { Clock, Sleeper } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';

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
  sleeper: Sleeper;
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

interface WaitRequest {
  ms: number;
}

interface RetryDelayRequest {
  failures: number;
}

/**
 * The single loop that moves job log entries from the stream into the store (design §4): it
 * reads, stores, and only then confirms; a store that fails is retried with a growing wait before
 * anything new is read, so entries wait in the stream while the store is down. The store's schema
 * is applied in the loop too, so a store that is down at startup delays the log, not the service.
 */
export class JobLogWriterImpl implements JobLogWriter {
  private readonly stopping = new AbortController();
  private loop: Promise<void> | undefined;
  private prepared = false;
  private roundFailures = 0;

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
        await this.round();
        this.roundFailures = 0;
      } catch (error) {
        if (this.isStopping()) return;
        this.d.logger.warn(`Job log writer round failed: ${this.describe(error)}`);
        const ms = this.retryDelay({ failures: this.roundFailures });
        this.roundFailures += 1;
        if (!(await this.wait({ ms }))) return;
      }
    }
  }

  private async round(): Promise<void> {
    if (!this.prepared) {
      await this.d.schema.apply();
      await this.d.stream.prepare();
      this.prepared = true;
    }
    if (!(await this.d.stream.lease()).held) {
      await this.wait({ ms: this.p.flushIntervalMs });
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
    if (records.length === 0 || records.length >= this.p.batchSize) return records;
    const startedAt = this.d.clock.now().now.getTime();
    while (records.length < this.p.batchSize) {
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
   */
  private async store(entries: PositionedJobLogEntry[]): Promise<boolean> {
    for (let failures = 0; ; failures += 1) {
      try {
        await this.d.store.insert({ entries });
        return true;
      } catch (error) {
        this.d.logger.warn(`Job log batch not stored, will retry: ${this.describe(error)}`);
        if (!(await this.wait({ ms: this.retryDelay({ failures }) }))) return false;
        if (!(await this.d.stream.lease()).held) return false;
      }
    }
  }

  /** Sleeps; false when the writer was stopped meanwhile. */
  private async wait(req: WaitRequest): Promise<boolean> {
    try {
      await this.d.sleeper.sleep({ ms: req.ms, signal: this.stopping.signal });
      return true;
    } catch (error) {
      if (this.isStopping()) return false;
      throw error;
    }
  }

  private isStopping(): boolean {
    return this.stopping.signal.aborted;
  }

  private retryDelay(req: RetryDelayRequest): number {
    return Math.min(this.p.retryDelayMs * 2 ** req.failures, this.p.retryMaxDelayMs);
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
