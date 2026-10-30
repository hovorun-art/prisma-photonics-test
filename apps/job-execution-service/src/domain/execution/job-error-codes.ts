/**
 * Codes job-execution-service puts into a job's stored error (`JobError.code`) when a job cannot
 * run. They describe the job's failure, not an API error, so they are not in `ERROR_CODES`.
 */
export const JOB_ERROR_CODES = {
  /** The job does not match the shared job contract. */
  invalidPayload: 'INVALID_PAYLOAD',
  /** This worker has no handler for the job's type. */
  unsupportedJobType: 'UNSUPPORTED_JOB_TYPE',
  /** The handler failed with an error that has no code of its own. */
  handlerError: 'HANDLER_ERROR',
} as const;
