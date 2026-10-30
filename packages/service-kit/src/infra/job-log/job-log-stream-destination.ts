import {
  JOB_LOG_STREAM_NAME,
  JobLogStreamMessage,
  type JobLogLevel,
  type JobLogSource,
} from '@job-queue/contracts';
import type { Clock, Closable, CloseClosableResponse, Random } from '@job-queue/kernel';

import type { LogDestination } from '../../domain/logging/log-destination.js';
import type {
  JobLogStreamRedis,
  OpenJobLogStreamRedisResponse,
} from '../../domain/job-log/job-log-stream-redis.js';

export interface JobLogStreamDestinationDeps {
  redis: JobLogStreamRedis;
  random: Random;
  clock: Clock;
  /** Where the warning about a dropped entry goes (the service's normal log output). */
  mainLog: LogDestination;
}

export interface JobLogStreamDestinationParams {
  source: JobLogSource;
  /** Approximate length the stream is trimmed to. */
  maxLength: number;
}

/** A pino line: the fields this destination reads, plus whatever else the line carries. */
interface PinoLine {
  level?: unknown;
  time?: unknown;
  msg?: unknown;
  jobId?: unknown;
  attempt?: unknown;
  instanceId?: unknown;
  droppedJobLogEntry?: unknown;
  [field: string]: unknown;
}

interface ReportDroppedRequest {
  message: JobLogStreamMessage;
  error: unknown;
}

const PINO_INFO = 30;
const PINO_WARN = 40;
const PINO_ERROR = 50;
/** Fields that are not metadata: pino's own, or kept as entry fields. */
const NON_METADATA_FIELDS = new Set([
  'level',
  'time',
  'pid',
  'hostname',
  'msg',
  'jobId',
  'attempt',
  'instanceId',
]);

/**
 * Turns the pino lines of a job into job log entries and appends them to the Redis Stream,
 * fire and forget: a send failure drops the entry and leaves one warning in the normal log.
 */
export class JobLogStreamDestination implements LogDestination, Closable {
  constructor(
    private readonly d: JobLogStreamDestinationDeps,
    private readonly p: JobLogStreamDestinationParams,
  ) {}

  write(line: string): void {
    const fields = this.parse(line);
    if (fields === undefined || fields.droppedJobLogEntry === true) return;
    const level = this.levelOf(fields.level);
    if (level === undefined || typeof fields.jobId !== 'string') return;
    const parsed = JobLogStreamMessage.safeParse({
      id: this.d.random.uuid().value,
      jobId: fields.jobId,
      attempt: fields.attempt,
      level,
      message: typeof fields.msg === 'string' ? fields.msg : '',
      metadata: this.metadataOf(fields),
      ts: fields.time,
      source: this.p.source,
      instanceId: fields.instanceId,
    });
    if (!parsed.success) return;
    this.append(parsed.data);
  }

  /** Resolves once the Redis connection is ready; call it at startup before job lines flow. */
  async open(): Promise<OpenJobLogStreamRedisResponse> {
    return this.d.redis.open();
  }

  async close(): Promise<CloseClosableResponse> {
    return this.d.redis.close();
  }

  private append(message: JobLogStreamMessage): void {
    this.d.redis
      .append({
        stream: JOB_LOG_STREAM_NAME,
        maxLength: this.p.maxLength,
        data: JSON.stringify(message),
      })
      .catch((error: unknown) => {
        this.reportDropped({ message, error });
      });
  }

  private reportDropped(req: ReportDroppedRequest): void {
    const { message, error } = req;
    this.d.mainLog.write(
      JSON.stringify({
        level: PINO_WARN,
        time: this.d.clock.now().now.getTime(),
        msg: 'Job log entry dropped',
        droppedJobLogEntry: true,
        jobId: message.jobId,
        reason: error instanceof Error ? error.message : String(error),
      }) + '\n',
    );
  }

  private parse(line: string): PinoLine | undefined {
    try {
      const value: unknown = JSON.parse(line);
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as PinoLine)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private levelOf(pinoLevel: unknown): JobLogLevel | undefined {
    if (typeof pinoLevel !== 'number' || pinoLevel < PINO_INFO) return undefined;
    if (pinoLevel < PINO_WARN) return 'info';
    return pinoLevel < PINO_ERROR ? 'warning' : 'error';
  }

  private metadataOf(fields: PinoLine): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (NON_METADATA_FIELDS.has(key)) continue;
      if (key !== 'err') {
        metadata[key] = value;
        continue;
      }
      const err = this.errorKind(value);
      if (err !== undefined) metadata[key] = err;
    }
    return metadata;
  }

  /**
   * An error keeps only its type and code: its message and stack can carry internal details (a
   * host, a path), and the full error stays in the service's own log. An error that is only a
   * message is left out.
   */
  private errorKind(err: unknown): Record<string, unknown> | undefined {
    if (typeof err !== 'object' || err === null || Array.isArray(err)) return undefined;
    const { type, code } = err as Record<string, unknown>;
    return {
      ...(type === undefined ? {} : { type }),
      ...(code === undefined ? {} : { code }),
    };
  }
}
