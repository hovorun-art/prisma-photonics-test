import { Search } from 'lucide-react';

import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';

const STATUS_FILTERS = [
  en.list.allStatuses,
  ...Object.values(en.statuses).map((s) => s.charAt(0).toUpperCase() + s.slice(1)),
];
const TYPE_FILTERS = [en.list.allTypes, ...Object.values(en.list.typeFilters)];

/** Status and type filters and search (design "Main"), disabled until their API exists. */
export function JobsToolbar() {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
      <ComingSoon>
        <div role="group" aria-label={en.list.filterByStatus} className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={i === 0}
              className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-subtle-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      </ComingSoon>
      <div className="flex flex-wrap items-center gap-3">
        <ComingSoon>
          <div
            role="group"
            aria-label={en.list.filterByType}
            className="flex flex-wrap gap-1 rounded-[9px] bg-secondary p-[3px]"
          >
            {TYPE_FILTERS.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-pressed={i === 0}
                className="h-[30px] rounded-[6px] px-3 text-[13px] font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs"
              >
                {label}
              </button>
            ))}
          </div>
        </ComingSoon>
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
