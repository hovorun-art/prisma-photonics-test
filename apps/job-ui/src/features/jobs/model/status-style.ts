import type { JobStatus } from '@job-queue/contracts';

/** Badge colours of each status (text and dot / background); the values are tokens in `index.css`. */
export const STATUS_STYLE: Readonly<Record<JobStatus, string>> = {
  scheduled: 'text-status-scheduled bg-status-scheduled-bg',
  pending: 'text-status-pending bg-status-pending-bg',
  processing: 'text-status-processing bg-status-processing-bg',
  completed: 'text-status-completed bg-status-completed-bg',
  failed: 'text-status-failed bg-status-failed-bg',
  cancelled: 'text-status-cancelled bg-status-cancelled-bg',
};

/** A status as a plain dot colour, as in the statistics cards. */
export const STATUS_DOT: Readonly<Record<JobStatus, string>> = {
  scheduled: 'bg-status-scheduled',
  pending: 'bg-status-pending',
  processing: 'bg-status-processing',
  completed: 'bg-status-completed',
  failed: 'bg-status-failed',
  cancelled: 'bg-status-cancelled',
};
