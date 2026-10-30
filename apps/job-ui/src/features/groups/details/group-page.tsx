import { useParams } from 'react-router';

import { en } from '@/locales';

import { ApiError } from '../../jobs/api/api-error';
import { Breadcrumb } from '../../jobs/details/breadcrumb';
import { DetailsSkeleton } from '../../jobs/details/details-skeleton';
import { NotFoundCard } from '../../jobs/details/not-found-card';
import { LiveIndicator } from '../../jobs/list/live-indicator';
import { StatusBadge } from '../../jobs/list/status-badge';
import { useGroup } from '../hooks/use-group';
import { useGroupJobs } from '../hooks/use-group-jobs';
import { GroupDetailsList } from './group-details-list';
import { GroupProgressCard } from './group-progress-card';

/**
 * One group (design "BatchJob", adapted to a group): its status, progress with one cell per job,
 * and details, refreshed by polling. Read only: no action changes the group.
 */
export function GroupPage() {
  const { id = '' } = useParams();
  const query = useGroup(id);
  const jobs = useGroupJobs(id, { enabled: query.isValidId });
  const notFound =
    !query.isValidId ||
    (query.error instanceof ApiError && query.error.code === 'JOB_GROUP_NOT_FOUND');
  if (notFound) {
    return (
      <NotFoundCard
        title={en.group.notFoundTitle}
        hint={en.group.notFoundHint}
        to="/groups"
        linkLabel={en.group.backToGroups}
      />
    );
  }

  const group = query.data;
  return (
    <>
      <Breadcrumb label={en.group.breadcrumb} parent={en.group.groups} to="/groups" id={id} />
      {group ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="m-0 font-mono text-[22px] font-medium tracking-tight">{group.id}</h1>
              <StatusBadge status={group.status} className="h-[26px] px-2.5 text-[13px]" />
            </div>
            <LiveIndicator connectionLost={query.isError || jobs.isError} />
          </div>
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
              <GroupProgressCard group={group} jobs={jobs.data} jobsFailed={jobs.isError} />
            </div>
            <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
              <GroupDetailsList group={group} />
            </aside>
          </div>
        </>
      ) : (
        <DetailsSkeleton label={en.group.loading} />
      )}
    </>
  );
}
