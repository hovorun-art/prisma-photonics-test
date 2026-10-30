import { JobStatus, JobType, type QueueStats } from '@job-queue/contracts';
import { Search } from 'lucide-react';

import { IntlWholeNumberFormat } from '@/lib/whole-number-format';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';
import type { JobListFilters } from '../api/jobs-api';
import { IntlStatsFormat } from '../model/intl-stats-format';

const FORMAT = new IntlStatsFormat(
  { wholeNumbers: new IntlWholeNumberFormat() },
  { perMinuteUnit: en.list.stats.perMinute },
);

/** One filter button: its label, its value (`undefined` for All) and how many jobs it would list. */
interface FilterOption<T> {
  readonly label: string;
  readonly value: T | undefined;
  readonly count: number | undefined;
}

/**
 * Status and type filters and search (design "Main"). Each filter has one value at a time, All
 * first; each button shows how many jobs choosing it would list, faceted by the other filter, as
 * job-service reports them. Without `counts` (loading, failed, or counts for other filters) the
 * buttons show only their labels. Search stays disabled until its API exists.
 */
export function JobsToolbar({
  filters,
  counts,
  onChange,
}: {
  filters: JobListFilters;
  counts: QueueStats['counts'] | undefined;
  onChange: (filters: JobListFilters) => void;
}) {
  // All counts what its facet's buttons count together: every job under the other filter.
  const allStatuses = counts && Object.values(counts.status).reduce((a, b) => a + b, 0);
  const allTypes = counts && Object.values(counts.type).reduce((a, b) => a + b, 0);
  const statusOptions: FilterOption<JobStatus>[] = [
    { label: en.list.allStatuses, value: undefined, count: allStatuses },
    ...JobStatus.options.map((status) => ({
      label: en.statuses[status].charAt(0).toUpperCase() + en.statuses[status].slice(1),
      value: status,
      count: counts?.status[status],
    })),
  ];
  const typeOptions: FilterOption<JobType>[] = [
    { label: en.list.allTypes, value: undefined, count: allTypes },
    ...JobType.options.map((type) => ({
      label: en.list.typeFilters[type],
      value: type,
      count: counts?.type[type],
    })),
  ];

  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
      <div role="group" aria-label={en.list.filterByStatus} className="flex flex-wrap gap-1.5">
        {statusOptions.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={option.value === filters.status}
            onClick={() => {
              onChange({ ...filters, status: option.value });
            }}
            className="h-9 cursor-pointer rounded-md border border-border bg-card px-3 text-[13px] font-medium text-subtle-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground [&[aria-pressed=true]_[data-count]]:text-primary-foreground/70"
          >
            {option.label}
            <FilterCount count={option.count} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label={en.list.filterByType}
          className="flex flex-wrap gap-1 rounded-[9px] bg-secondary p-[3px]"
        >
          {typeOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={option.value === filters.type}
              onClick={() => {
                onChange({ ...filters, type: option.value });
              }}
              className="h-[30px] cursor-pointer rounded-[6px] px-3 text-[13px] font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs"
            >
              {option.label}
              <FilterCount count={option.count} />
            </button>
          ))}
        </div>
        <ComingSoon className="ml-auto">
          <label className="flex h-9 min-w-60 items-center gap-2 rounded-md border border-border px-3 text-muted-foreground">
            <Search className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{en.list.searchLabel}</span>
            <input
              type="search"
              placeholder={en.list.searchPlaceholder}
              className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none"
            />
          </label>
        </ComingSoon>
      </div>
    </div>
  );
}

/** The muted count after a filter label, or nothing while there is no count. */
function FilterCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <>
      {' '}
      <span data-count className="ml-0.5 text-muted-foreground tabular-nums">
        {FORMAT.count({ value: count }).text}
      </span>
    </>
  );
}
