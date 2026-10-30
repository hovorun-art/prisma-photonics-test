import { FilterX, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { useJobFilters } from '../hooks/use-job-filters';
import { useJobsPage } from '../hooks/use-jobs-page';
import { useQueueStats } from '../hooks/use-queue-stats';
import { JobsPager } from './jobs-pager';
import { JobsTable } from './jobs-table';
import { JobsToolbar } from './jobs-toolbar';
import { LiveIndicator } from './live-indicator';
import { QueueStats } from './queue-stats';

/** Where the list is: its offset and the offsets of the pages before it, for one set of filters. */
interface Paging {
  readonly filtersKey: string;
  readonly offset: number;
  /** Offsets of the pages visited before this one, so Previous returns to exactly that page even
   * from a last page shorter than the others. */
  readonly previousOffsets: readonly number[];
}

/**
 * The jobs list (design "Main"): newest first, a page at a time, refreshed by polling, narrowed by
 * the status and type filters of the page URL. Paging belongs to one set of filters, so any filter
 * change (a click, Back or a link) starts again at the first page.
 */
export function JobsListPage() {
  const { filters, setFilters } = useJobFilters();
  const filtersKey = `${filters.status ?? ''}|${filters.type ?? ''}`;
  const [paging, setPaging] = useState<Paging>({ filtersKey, offset: 0, previousOffsets: [] });
  // A filter change drops the stored paging (not only hides it), so returning to earlier filters
  // starts at their first page too. Set during render, React's pattern for state that follows input.
  const current: Paging =
    paging.filtersKey === filtersKey ? paging : { filtersKey, offset: 0, previousOffsets: [] };
  if (current !== paging) setPaging(current);
  const query = useJobsPage({ offset: current.offset, filters });
  const page = query.data;
  const stats = useQueueStats();
  const filtered = filters.status !== undefined || filters.type !== undefined;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{en.list.title}</h1>
          <p className="m-0 text-muted-foreground">{en.list.subtitle}</p>
        </div>
        <LiveIndicator connectionLost={query.isError} />
      </div>
      <QueueStats />
      <Card aria-label={en.list.tableLabel} className="gap-0 rounded-xl py-0 shadow-none">
        <JobsToolbar
          filters={filters}
          counts={stats.isPlaceholderData ? undefined : stats.data?.counts}
          onChange={setFilters}
        />
        {page?.total === 0 ? (
          filtered ? (
            <NoMatchingJobs
              onClear={() => {
                setFilters({});
              }}
            />
          ) : (
            <EmptyJobs />
          )
        ) : (
          <JobsTable jobs={page?.items} />
        )}
        {page && page.total > 0 && (
          <JobsPager
            offset={current.offset}
            shown={page.items.length}
            total={page.total}
            onPrevious={() => {
              setPaging({
                filtersKey,
                offset: current.previousOffsets.at(-1) ?? 0,
                previousOffsets: current.previousOffsets.slice(0, -1),
              });
            }}
            onNext={() => {
              setPaging({
                filtersKey,
                offset: current.offset + page.items.length,
                previousOffsets: [...current.previousOffsets, current.offset],
              });
            }}
          />
        )}
      </Card>
    </>
  );
}

/** No job matches the chosen filters; Clear filters sets both back to All. */
function NoMatchingJobs({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      <div className="font-medium">{en.list.noMatchTitle}</div>
      <Button variant="outline" onClick={onClear}>
        <FilterX aria-hidden="true" />
        {en.list.clearFilters}
      </Button>
    </div>
  );
}

function EmptyJobs() {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      <div className="font-medium">{en.list.emptyTitle}</div>
      <div className="text-[13px] text-muted-foreground">{en.list.emptyHint}</div>
      <Button asChild className="no-underline">
        <Link to="/jobs/new">
          <Plus aria-hidden="true" />
          {en.frame.newJob}
        </Link>
      </Button>
    </div>
  );
}
