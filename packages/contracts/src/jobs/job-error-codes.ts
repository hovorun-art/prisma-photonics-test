/**
 * Codes put into a job's stored error (`JobError.code`) by the system itself, not by a handler.
 * They describe why an attempt failed, not an API error, so they are not in `ERROR_CODES`; handler
 * codes (a webhook's HTTP error, a transit's missing data) stay in their worker modules.
 */
export const JOB_ERROR_CODES = {
  /** The job does not match the shared job contract. */
  invalidPayload: 'INVALID_PAYLOAD',
  /** The worker has no handler for the job's type. */
  unsupportedJobType: 'UNSUPPORTED_JOB_TYPE',
  /** The handler failed with an error that has no code of its own. */
  handlerError: 'HANDLER_ERROR',
  /** The worker running the attempt stopped holding it (crash, kill, lost report). */
  workerLost: 'WORKER_LOST',
  /** The attempt ran longer than its type's maximum processing time. */
  jobTimeout: 'JOB_TIMEOUT',
} as const;
