import type { Closable } from '@job-queue/kernel';

/**
 * The cancellations job-service announces. Every worker hears every one and acts only on the jobs
 * it runs. Delivery is not guaranteed: a missed one only means the job runs to its end, and
 * job-service refuses its report.
 */
export interface JobCancellations extends Closable {
  /** Starts listening; `onCancel` gets the id of each cancelled job. */
  listen(req: ListenJobCancellationsRequest): Promise<ListenJobCancellationsResponse>;
}

export interface ListenJobCancellationsRequest {
  onCancel: (jobId: string) => void;
}

export type ListenJobCancellationsResponse = Record<string, never>;

export const JOB_CANCELLATIONS = Symbol('JobCancellations');
