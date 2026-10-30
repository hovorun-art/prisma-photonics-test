import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { useOffsetPaging } from '../../jobs/hooks/use-offset-paging';
import { EmptyList } from '../../jobs/list/empty-list';
import { JobsPager } from '../../jobs/list/jobs-pager';
import { LiveIndicator } from '../../jobs/list/live-indicator';
import { useGroupsPage } from '../hooks/use-groups-page';
import { GroupsTable } from './groups-table';

/** The groups list, like the jobs list (design "Main"): newest first, a page at a time, polled. */
export function GroupsListPage() {
  const paging = useOffsetPaging();
  const query = useGroupsPage({ offset: paging.offset });
  const page = query.data;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{en.groups.title}</h1>
          <p className="m-0 text-muted-foreground">{en.groups.subtitle}</p>
        </div>
        <LiveIndicator connectionLost={query.isError} />
      </div>
      <Card aria-label={en.groups.tableLabel} className="gap-0 rounded-xl py-0 shadow-none">
        {page?.total === 0 ? (
          <EmptyList title={en.groups.emptyTitle} hint={en.groups.emptyHint} />
        ) : (
          <GroupsTable groups={page?.items} />
        )}
        {page && page.total > 0 && (
          <JobsPager
            offset={paging.offset}
            shown={page.items.length}
            total={page.total}
            onPrevious={paging.previous}
            onNext={() => {
              paging.next(page.items.length);
            }}
          />
        )}
      </Card>
    </>
  );
}
