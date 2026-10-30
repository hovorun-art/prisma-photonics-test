/**
 * Codes job-execution-service puts into a job's stored error (`JobError.code`) when a job cannot
 * run or runs too long. Shared with job-service (which stores `WORKER_LOST` and `JOB_TIMEOUT`
 * itself when it recovers a job), so they live in the contracts.
 */
export { JOB_ERROR_CODES } from '@job-queue/contracts';
