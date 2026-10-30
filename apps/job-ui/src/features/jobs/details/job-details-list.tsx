import type { Job } from '@job-queue/contracts';

import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { useJobFields } from '../hooks/use-job-fields';

/** The job's fields as a key/value list (design "JobDetail"). */
export function JobDetailsList({ job }: { job: Job }) {
  const fields = useJobFields(job);
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
  ];
  return (
    <Card role="region" aria-label={en.job.details} className="gap-3 px-5 py-4 shadow-none">
      <h2 className="m-0 text-[15px] font-semibold">{en.job.details}</h2>
      <dl className="m-0 flex flex-col">
        {rows.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3 border-t border-[#F3F3F1] py-2">
            <dt className="text-[13px] text-muted-foreground">{key}</dt>
            <dd className="m-0 text-right font-mono text-xs break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
