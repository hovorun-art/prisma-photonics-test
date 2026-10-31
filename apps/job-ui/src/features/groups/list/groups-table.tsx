import type { JobGroup } from '@job-queue/contracts';
import { Link } from 'react-router';

import { en } from '@/locales';

import { useJobPresenter } from '../../jobs/hooks/use-job-presenter';
import { LIST_CELL as CELL, ListTable } from '../../jobs/list/list-table';
import { StatusBadge } from '../../jobs/list/status-badge';
import { GroupProgressBar } from '../details/group-progress-bar';

const COLUMNS = [
  en.groups.columns.id,
  en.groups.columns.status,
  en.groups.columns.progress,
  en.groups.columns.created,
  en.groups.columns.finished,
];

/** The groups table, styled like the jobs table (design "Main"); scrolls on narrow screens. */
export function GroupsTable({ groups }: { groups: readonly JobGroup[] | undefined }) {
  return (
    <ListTable
      columns={COLUMNS}
      rows={groups?.map((group) => (
        <GroupRow key={group.id} group={group} />
      ))}
      loadingLabel={en.groups.loading}
      minWidth="min-w-[720px]"
    />
  );
}

function GroupRow({ group }: { group: JobGroup }) {
  const presenter = useJobPresenter();
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
          <GroupProgressBar
            completed={completed}
            failed={failed}
            total={total}
            label={en.groups.progressLabel(completed, failed, total)}
            className="h-1.5 w-24 rounded-full"
          />
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
