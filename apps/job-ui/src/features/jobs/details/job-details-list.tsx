import type { Job } from '@job-queue/contracts';

import { en } from '@/locales';

import { useJobFields } from '../hooks/use-job-fields';
import { useJobPresenter } from '../hooks/use-job-presenter';
import { DetailsCard } from './details-card';

/** The job's fields as a key/value list (design "JobDetail"). */
export function JobDetailsList({ job }: { job: Job }) {
  const fields = useJobFields(job);
  const idempotencyKey = useJobPresenter().idempotencyKey({ job }).text;
  const rows: [string, string][] = [
    [en.job.fields.type, fields.type],
    [en.job.fields.priority, fields.priority],
    [en.job.fields.attempts, fields.attempts],
    [en.job.fields.created, fields.created],
    // Only a job submitted with a time to run has one to show.
    ...(fields.scheduledFor === null
      ? []
      : [[en.job.fields.scheduledFor, fields.scheduledFor] as [string, string]]),
    [en.job.fields.started, fields.started],
    [en.job.fields.finished, fields.finished],
    [en.job.fields.totalTime, fields.totalTime],
    // Only a job submitted with a key has one to show.
    ...(idempotencyKey === null
      ? []
      : [[en.job.fields.idempotencyKey, idempotencyKey] as [string, string]]),
  ];
  return <DetailsCard label={en.job.details} rows={rows} />;
}
