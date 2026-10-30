import type { JobGroup, JobStatus } from '@job-queue/contracts';

export interface SummaryGroupProgressRequest {
  readonly group: JobGroup;
}
/** A group's progress as the progress card shows it. */
export interface SummaryGroupProgressResponse {
  /** Completed plus failed jobs. */
  readonly finished: number;
  /** Finished out of total as a whole percentage, rounded down; 0 for a group without jobs. */
  readonly percent: number;
  /** Total minus completed minus failed. */
  readonly remaining: number;
}

export interface CellGroupProgressRequest {
  readonly status: JobStatus;
}
/** How a job's cell is coloured: by its outcome, or as remaining while it has none. */
export type CellKind = 'completed' | 'failed' | 'remaining';
export interface CellGroupProgressResponse {
  readonly kind: CellKind;
}

/** The numbers and cell colours of a group's progress, from its counts and its jobs' statuses. */
export interface GroupProgress {
  summary(req: SummaryGroupProgressRequest): SummaryGroupProgressResponse;
  cell(req: CellGroupProgressRequest): CellGroupProgressResponse;
}
