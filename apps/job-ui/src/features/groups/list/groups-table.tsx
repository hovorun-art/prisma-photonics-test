import type { JobGroup } from '@job-queue/contracts';
import { Link } from 'react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { en } from '@/locales';

import { useJobPresenter } from '../../jobs/hooks/use-job-presenter';
import { StatusBadge } from '../../jobs/list/status-badge';
import { GroupProgressImpl } from '../model/group-progress.impl';

const COLUMNS = [
  en.groups.columns.id,
  en.groups.columns.status,
  en.groups.columns.progress,
  en.groups.columns.created,
  en.groups.columns.finished,
];
const SKELETON_ROWS = 5;
const CELL = 'px-2 py-3 first:pl-5 last:pr-5';
const progress = new GroupProgressImpl();

/** The groups table, styled like the jobs table (design "Main"); scrolls on narrow screens. */
export function GroupsTable({ groups }: { groups: readonly JobGroup[] | undefined }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead className="h-10 bg-surface-muted text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className={`${CELL} font-medium`}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        {groups ? (
          <tbody>
            {groups.map((group) => (
              <GroupRow key={group.id} group={group} />
            ))}
          </tbody>
        ) : (
          <tbody aria-label={en.groups.loading} aria-busy="true">
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

function GroupRow({ group }: { group: JobGroup }) {
  const presenter = useJobPresenter();
  const { percent } = progress.summary({ group });
  const { completed, failed, total } = group;
  return (
    <tr className="h-14 border-t border-border-soft align-middle">
      <td className={CELL}>
        <Link
          to={`/groups/${group.id}`}
          className="font-mono text-[13px] font-medium text-foreground underline decoration-input underline-offset-[3px]"
        >
          {presenter.shortId({ id: group.id }).text}
        </Link>
      </td>
      <td className={CELL}>
        <StatusBadge status={group.status} />
      </td>
      <td className={CELL}>
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={en.groups.progressLabel(completed, failed, total)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-24 overflow-hidden rounded-full bg-status-processing-bg"
          >
            <div
              className="h-full rounded-full bg-status-processing"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="font-mono text-[13px] text-subtle-foreground">
            {en.groups.progressText(completed, failed, total)}
          </span>
        </div>
      </td>
      <td className={`${CELL} font-mono text-xs text-muted-foreground`}>
        {presenter.listTime({ at: group.createdAt }).text}
      </td>
      <td className={`${CELL} font-mono text-xs text-muted-foreground`}>
        {group.finishedAt ? presenter.listTime({ at: group.finishedAt }).text : en.group.notYet}
      </td>
    </tr>
  );
}
