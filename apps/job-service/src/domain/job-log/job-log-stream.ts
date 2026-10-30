import type { Closable } from '@job-queue/kernel';

/**
 * job-service's side of the job log stream: the services append entries to it, job-service reads
 * them in batches through one consumer group and confirms each batch once it is stored. Entries
 * read but not confirmed are read again (`read` with `pending`).
 */
export interface JobLogStream extends Closable {
  /**
   * Creates the consumer group (and the stream) when missing. A new group starts at the beginning
   * of the stream, so entries appended before it existed are read too.
   */
  prepare(): Promise<PrepareJobLogStreamResponse>;
  /**
   * Takes or renews the writer lease; only one holder at a time, and a lease that is not renewed
   * passes on after the configured time.
   */
  lease(): Promise<LeaseJobLogStreamResponse>;
  /**
   * `pending`: this consumer's entries read before but not confirmed, without waiting. Otherwise new
   * entries, waiting up to `blockMs` when there are none. Rejects with
   * `JobLogStreamGroupMissingError` when the consumer group does not exist (call `prepare` again).
   */
  read(req: ReadJobLogStreamRequest): Promise<ReadJobLogStreamResponse>;
  ack(req: AckJobLogStreamRequest): Promise<AckJobLogStreamResponse>;
}

export type PrepareJobLogStreamResponse = Record<string, never>;

export interface LeaseJobLogStreamResponse {
  held: boolean;
}

export interface ReadJobLogStreamRequest {
  pending: boolean;
  count: number;
  blockMs: number;
}

/** One stream message as read: its position (stream id) and its unvalidated JSON body. */
export interface JobLogStreamRecord {
  position: string;
  body: string;
}

export interface ReadJobLogStreamResponse {
  records: JobLogStreamRecord[];
}

export interface AckJobLogStreamRequest {
  positions: string[];
}

export type AckJobLogStreamResponse = Record<string, never>;

export const JOB_LOG_STREAM = Symbol('JobLogStream');
