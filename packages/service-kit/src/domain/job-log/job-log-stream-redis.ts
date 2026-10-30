import type { Closable } from '@job-queue/kernel';

/**
 * The producer's own Redis connection to the job log stream. It never queues commands while Redis
 * is down and never retries, so an outage rejects at once instead of filling memory.
 */
export interface JobLogStreamRedis extends Closable {
  /**
   * Resolves once the connection is ready, so entries written afterwards are not dropped; rejects
   * when it cannot connect within the configured wait.
   */
  open(): Promise<OpenJobLogStreamRedisResponse>;
  /** Appends one entry (`XADD <stream> MAXLEN ~ <maxLength> * data <data>`). */
  append(req: AppendJobLogStreamRedisRequest): Promise<AppendJobLogStreamRedisResponse>;
}

export interface AppendJobLogStreamRedisRequest {
  stream: string;
  /** Approximate length the stream is trimmed to. */
  maxLength: number;
  /** The entry as a JSON string. */
  data: string;
}

export type AppendJobLogStreamRedisResponse = Record<string, never>;
export type OpenJobLogStreamRedisResponse = Record<string, never>;
