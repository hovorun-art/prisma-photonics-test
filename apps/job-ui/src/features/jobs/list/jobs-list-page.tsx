import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { useJobsPage } from '../hooks/use-jobs-page';
import { JobsPager } from './jobs-pager';
import { JobsTable } from './jobs-table';
import { JobsToolbar } from './jobs-toolbar';
import { LiveIndicator } from './live-indicator';
import { QueueStats } from './queue-stats';

/** The jobs list (design "Main"): newest first, a page at a time, refreshed by polling. */
export function JobsListPage() {
  // Offsets of the pages visited before this one, so Previous returns to exactly that page even
  // from a last page shorter than the others.
  const [previousOffsets, setPreviousOffsets] = useState<number[]>([]);
  const [offset, setOffset] = useState(0);
  const query = useJobsPage(offset);
  const page = query.data;

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
        <JobsToolbar />
        {page?.total === 0 ? <EmptyJobs /> : <JobsTable jobs={page?.items} />}
        {page && page.total > 0 && (
          <JobsPager
            offset={offset}
            shown={page.items.length}
            total={page.total}
            onPrevious={() => {
              setOffset(previousOffsets.at(-1) ?? 0);
              setPreviousOffsets(previousOffsets.slice(0, -1));
            }}
            onNext={() => {
              setPreviousOffsets([...previousOffsets, offset]);
              setOffset(offset + page.items.length);
            }}
          />
        )}
      </Card>
    </>
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
