import type { Job } from '@job-queue/contracts';

import { en } from '@/locales';

import { useJobPresenter } from './use-job-presenter';

/** The job's fields as the job page shows them; "—" for a time the job has not reached. */
export interface JobFieldTexts {
  readonly type: string;
  readonly priority: string;
  readonly attempts: string;
  readonly created: string;
  /** The time the job was submitted to run at; `null` when it has none. */
  readonly scheduledFor: string | null;
  readonly started: string;
  readonly finished: string;
  readonly totalTime: string;
}

/** The texts of a job's fields, shared by the job page's Details list and the report's Job card. */
export function useJobFields(job: Job): JobFieldTexts {
  const presenter = useJobPresenter();
  const dateTime = (at: string | null) => (at ? presenter.dateTime({ at }).text : en.job.notYet);
  return {
    type: en.jobTypes[job.type],
    priority: String(job.priority),
    attempts: `${job.attempts} / ${job.maxAttempts}`,
    created: dateTime(job.createdAt),
    scheduledFor: job.scheduledAt ? presenter.dateTime({ at: job.scheduledAt }).text : null,
    started: dateTime(job.startedAt),
    finished: dateTime(job.completedAt),
    totalTime: presenter.totalTime({ job }).text ?? en.job.notYet,
  };
}
