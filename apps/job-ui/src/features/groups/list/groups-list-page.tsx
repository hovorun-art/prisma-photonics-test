import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { JobsPager } from '../../jobs/list/jobs-pager';
import { LiveIndicator } from '../../jobs/list/live-indicator';
import { useGroupsPage } from '../hooks/use-groups-page';
import { GroupsTable } from './groups-table';

/** Where the list is: its offset and the offsets of the pages before it. */
interface Paging {
  readonly offset: number;
  /** Offsets of the pages visited before this one, so Previous returns to exactly that page even
   * from a last page shorter than the others. */
  readonly previousOffsets: readonly number[];
}

/** The groups list, like the jobs list (design "Main"): newest first, a page at a time, polled. */
export function GroupsListPage() {
  const [paging, setPaging] = useState<Paging>({ offset: 0, previousOffsets: [] });
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
        {page?.total === 0 ? <EmptyGroups /> : <GroupsTable groups={page?.items} />}
        {page && page.total > 0 && (
          <JobsPager
            offset={paging.offset}
            shown={page.items.length}
            total={page.total}
            onPrevious={() => {
              setPaging({
                offset: paging.previousOffsets.at(-1) ?? 0,
                previousOffsets: paging.previousOffsets.slice(0, -1),
              });
            }}
            onNext={() => {
              setPaging({
                offset: paging.offset + page.items.length,
                previousOffsets: [...paging.previousOffsets, paging.offset],
              });
            }}
          />
        )}
      </Card>
    </>
  );
}

function EmptyGroups() {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      <div className="font-medium">{en.groups.emptyTitle}</div>
      <div className="text-[13px] text-muted-foreground">{en.groups.emptyHint}</div>
    </div>
  );
}
