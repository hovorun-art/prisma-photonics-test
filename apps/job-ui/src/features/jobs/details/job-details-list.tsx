import type { Job } from '@job-queue/contracts';

import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { useJobPresenter } from '../hooks/use-job-presenter';

/** The job's fields as a key/value list (design "JobDetail"). */
export function JobDetailsList({ job }: { job: Job }) {
  const presenter = useJobPresenter();
  const dateTime = (at: string | null) => (at ? presenter.dateTime({ at }).text : en.job.notYet);
  const rows: [string, string][] = [
    [en.job.fields.type, en.jobTypes[job.type]],
    [en.job.fields.priority, String(job.priority)],
    [en.job.fields.attempts, `${job.attempts} / ${job.maxAttempts}`],
    [en.job.fields.created, dateTime(job.createdAt)],
    [en.job.fields.started, dateTime(job.startedAt)],
    [en.job.fields.finished, dateTime(job.completedAt)],
    [en.job.fields.totalTime, presenter.totalTime({ job }).text ?? en.job.notYet],
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
