/**
 * Codes the webhooks module puts into a job's stored error (`JobError.code`). Like
 * `JOB_ERROR_CODES` they describe a job's failure, not an API error, so they are not in `ERROR_CODES`.
 */
export const WEBHOOK_JOB_ERROR_CODES = {
  /** The (simulated) call was answered with an error status; the status is in `details.statusCode`. */
  httpError: 'WEBHOOK_HTTP_ERROR',
} as const;
