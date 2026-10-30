import type { JobLogLevel, QueryJobLogResponse } from '@job-queue/contracts';

/** Reads a job's log for the public API. */
export interface JobLogService {
  /**
   * One page of the job's log, oldest first. Throws `JobNotFoundError` for an unknown or deleted
   * job and `LogStoreUnavailableError` when the store cannot be reached.
   */
  query(req: QueryJobLogServiceRequest): Promise<QueryJobLogServiceResponse>;
}

export interface QueryJobLogServiceRequest {
  jobId: string;
  /** The decoded `after` cursor: a log position. */
  after?: string | undefined;
  levels?: JobLogLevel[] | undefined;
  /** The configured default when omitted. */
  limit?: number | undefined;
}

export type QueryJobLogServiceResponse = QueryJobLogResponse;

export const JOB_LOG_SERVICE = Symbol('JobLogService');
