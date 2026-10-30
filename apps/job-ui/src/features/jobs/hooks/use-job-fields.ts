import type { Job } from '@job-queue/contracts';

import { en } from '@/locales';

import { useJobPresenter } from './use-job-presenter';

/** The job's fields as the job page shows them; "—" for a time the job has not reached. */
export interface JobFieldTexts {
  readonly type: string;
  readonly priority: string;
  readonly attempts: string;
  readonly created: string;
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
    started: dateTime(job.startedAt),
    finished: dateTime(job.completedAt),
    totalTime: presenter.totalTime({ job }).text ?? en.job.notYet,
  };
}
