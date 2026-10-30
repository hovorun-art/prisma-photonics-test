import type { ValidationFailedDetails } from '@job-queue/contracts';

export interface SplitBulkIssuesRequest {
  /** The `details` of a bulk submit's `VALIDATION_FAILED` answer. */
  readonly details: Readonly<Record<string, unknown>>;
  /** How many jobs the bulk had. */
  readonly jobCount: number;
}
export interface SplitBulkIssuesResponse {
  /** Per job, in order: its issues with paths relative to the job (`payload.to`). */
  readonly jobs: readonly ValidationFailedDetails[];
  /** Messages of the issues that belong to no job (e.g. on the list of jobs itself). */
  readonly unmatched: readonly string[];
}

/** Sorts the issues of a bulk submit's `VALIDATION_FAILED` answer by job (`jobs.<n>.<path>`). */
export interface BulkIssues {
  split(req: SplitBulkIssuesRequest): SplitBulkIssuesResponse;
}
