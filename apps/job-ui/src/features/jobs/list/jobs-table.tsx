import type { Job } from '@job-queue/contracts';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';
import { useJobPresenter } from '../hooks/use-job-presenter';
import { StatusBadge } from './status-badge';

const COLUMNS = [
  en.list.columns.id,
  en.list.columns.type,
  en.list.columns.status,
  en.list.columns.priority,
  en.list.columns.attempts,
  en.list.columns.details,
  en.list.columns.created,
  en.list.columns.actions,
];
const SKELETON_ROWS = 5;
const CELL = 'px-2 py-3 first:pl-5 last:pr-5';

/** The jobs table (design "Main"); scrolls horizontally on narrow screens. */
export function JobsTable({ jobs }: { jobs: readonly Job[] | undefined }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] border-collapse text-left">
        <thead className="h-10 bg-surface-muted text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className={`${CELL} font-medium last:text-right`}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        {jobs ? (
          <tbody>
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </tbody>
        ) : (
          <tbody aria-label={en.list.loading} aria-busy="true">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i} className="border-t border-border-soft">
                {COLUMNS.map((column) => (
                  <td key={column} className={CELL}>
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const presenter = useJobPresenter();
  return (
    <tr className="h-14 border-t border-border-soft align-middle">
      <td className={CELL}>
        <Link
          to={`/jobs/${job.id}`}
          className="font-mono text-[13px] font-medium text-foreground underline decoration-input underline-offset-[3px]"
        >
          {presenter.shortId({ id: job.id }).text}
        </Link>
      </td>
      <td className={`${CELL} font-mono text-xs text-subtle-foreground`}>{job.type}</td>
      <td className={CELL}>
        <StatusBadge status={job.status} />
      </td>
      <td className={`${CELL} font-mono text-[13px]`}>{job.priority}</td>
      <td className={`${CELL} font-mono text-[13px] text-subtle-foreground`}>
        {job.attempts}/{job.maxAttempts}
      </td>
      <td className={`${CELL} max-w-[360px] truncate text-[13px] text-subtle-foreground`}>
        {presenter.details({ job }).text}
      </td>
      <td className={`${CELL} font-mono text-xs text-muted-foreground`}>
        {presenter.listTime({ at: job.createdAt }).text}
      </td>
      <td className={`${CELL} text-right`}>
        <RowActions job={job} />
      </td>
    </tr>
  );
}

/** Cancel and Retry as the design places them; disabled until their API exists. */
function RowActions({ job }: { job: Job }) {
  if (job.status === 'pending' || job.status === 'scheduled') {
    return (
      <ComingSoon>
        <Button variant="outline" size="sm">
          {en.list.cancel}
        </Button>
      </ComingSoon>
    );
  }
  if (job.status === 'failed') {
    return (
      <ComingSoon>
        <Button size="sm">{en.list.retry}</Button>
      </ComingSoon>
    );
  }
  return (
    <span className="text-muted-foreground" aria-label={en.list.noActions}>
      —
    </span>
  );
}
