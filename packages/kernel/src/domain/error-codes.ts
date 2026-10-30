/**
 * The closed list of error codes the system may produce. A `DomainError` only accepts a code from
 * this list, and `@job-queue/contracts` builds its `ErrorCode` schema from it, so clients and
 * servers share one set. Add a code here when a new expected failure is introduced.
 */
export const ERROR_CODES = [
  /** An `/internal` route was called without the configured service token. */
  'INTERNAL_UNAUTHORIZED',
  /** The request addressed a route job-service does not have. */
  'ROUTE_NOT_FOUND',
  /** The request input failed validation; `details.issues` lists each problem with its field path. */
  'VALIDATION_FAILED',
  /** The request body is larger than the configured limit; `details.limitBytes` holds the limit. */
  'PAYLOAD_TOO_LARGE',
  /** The request body uses a content encoding or charset job-service cannot read. */
  'UNSUPPORTED_MEDIA_TYPE',
  /** No job has the requested id. */
  'JOB_NOT_FOUND',
  /** The operation is not allowed in the job's current status; `details.status` holds that status. */
  'JOB_STATUS_CONFLICT',
  /** The job queue could not be reached in time; callers that can carry on log it instead. */
  'QUEUE_UNAVAILABLE',
  /** job-execution-service could not reach job-service (network error, timeout or 5xx). */
  'JOB_SERVICE_UNAVAILABLE',
  /** An unexpected failure; details are logged, not returned. */
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
