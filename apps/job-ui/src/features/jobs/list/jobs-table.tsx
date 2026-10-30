import type { Job } from '@job-queue/contracts';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';
import { useJobPresenter } from '../hooks/use-job-presenter';
import { LIST_CELL as CELL, ListTable } from './list-table';
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
/** The jobs table (design "Main"); scrolls horizontally on narrow screens. */
export function JobsTable({ jobs }: { jobs: readonly Job[] | undefined }) {
  return (
    <ListTable
      columns={COLUMNS}
      rows={jobs?.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
      loadingLabel={en.list.loading}
      minWidth="min-w-[1040px]"
      lastColumnRight
    />
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
        {job.status === 'scheduled' && job.scheduledAt && (
          <div className="mt-1 font-mono text-xs whitespace-nowrap text-muted-foreground">
            {presenter.dateTime({ at: job.scheduledAt }).text}
          </div>
        )}
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
  const actions = useJobPresenter().actions({ job });
  if (actions.cancel) {
    return (
      <ComingSoon>
        <Button variant="outline" size="sm">
          {en.list.cancel}
        </Button>
      </ComingSoon>
    );
  }
  if (actions.retry) {
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
