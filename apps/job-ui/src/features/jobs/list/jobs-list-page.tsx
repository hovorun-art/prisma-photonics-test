import { FilterX, Plus } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { useJobFilters } from '../hooks/use-job-filters';
import { useJobsPage } from '../hooks/use-jobs-page';
import { useOffsetPaging } from '../hooks/use-offset-paging';
import { useQueueStats } from '../hooks/use-queue-stats';
import { EmptyList } from './empty-list';
import { JobsPager } from './jobs-pager';
import { JobsTable } from './jobs-table';
import { JobsToolbar } from './jobs-toolbar';
import { LiveIndicator } from './live-indicator';
import { QueueStats } from './queue-stats';

/**
 * The jobs list (design "Main"): newest first, a page at a time, refreshed by polling, narrowed by
 * the status and type filters of the page URL. Paging belongs to one set of filters, so any filter
 * change (a click, Back or a link) starts again at the first page.
 */
export function JobsListPage() {
  const { filters, setFilters } = useJobFilters();
  const filtersKey = `${filters.status ?? ''}|${filters.type ?? ''}`;
  // A filter change drops the stored paging, so returning to earlier filters starts at their first
  // page too.
  const paging = useOffsetPaging(filtersKey);
  const query = useJobsPage({ offset: paging.offset, filters });
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
    <EmptyList title={en.list.emptyTitle} hint={en.list.emptyHint}>
      <Button asChild className="no-underline">
        <Link to="/jobs/new">
          <Plus aria-hidden="true" />
          {en.frame.newJob}
        </Link>
      </Button>
    </EmptyList>
  );
}
