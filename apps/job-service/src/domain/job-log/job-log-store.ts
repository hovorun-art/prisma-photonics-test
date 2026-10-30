import type { JobLogLevel, JobLogStreamMessage } from '@job-queue/contracts';
import type { Closable } from '@job-queue/kernel';

/**
 * Where job log entries are kept: append-only, read per job in log order, removed after the
 * configured retention. Both methods throw `LogStoreUnavailableError` when the store cannot be
 * reached.
 */
export interface JobLogStore extends Closable {
  /**
   * Stores a batch in one write. Storing the same entries again (a batch read again after a writer
   * crash) leaves each entry once.
   */
  insert(req: InsertJobLogStoreRequest): Promise<InsertJobLogStoreResponse>;
  /** One job's entries after `after`, in log order, at most `limit`, only of `levels` when given. */
  query(req: QueryJobLogStoreRequest): Promise<QueryJobLogStoreResponse>;
}

/** An entry with its log position: the stream id `<ms>-<seq>` it was appended under. */
export interface PositionedJobLogEntry {
  position: string;
  entry: JobLogStreamMessage;
}

export interface InsertJobLogStoreRequest {
  entries: PositionedJobLogEntry[];
}

export type InsertJobLogStoreResponse = Record<string, never>;

export interface QueryJobLogStoreRequest {
  jobId: string;
  /** Only entries after this log position; from the start when omitted. */
  after?: string | undefined;
  levels?: JobLogLevel[] | undefined;
  limit: number;
}

export interface QueryJobLogStoreResponse {
  entries: PositionedJobLogEntry[];
}

export const JOB_LOG_STORE = Symbol('JobLogStore');
