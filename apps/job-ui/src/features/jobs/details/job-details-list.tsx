import type { Job } from '@job-queue/contracts';

import { en } from '@/locales';

import { useJobFields } from '../hooks/use-job-fields';
import { DetailsCard } from './details-card';

/** The job's fields as a key/value list (design "JobDetail"). */
export function JobDetailsList({ job }: { job: Job }) {
  const fields = useJobFields(job);
  const rows: [string, string][] = [
    [en.job.fields.type, fields.type],
    [en.job.fields.priority, fields.priority],
    [en.job.fields.attempts, fields.attempts],
    [en.job.fields.created, fields.created],
    [en.job.fields.started, fields.started],
    [en.job.fields.finished, fields.finished],
    [en.job.fields.totalTime, fields.totalTime],
  ];
  return <DetailsCard label={en.job.details} rows={rows} />;
}
