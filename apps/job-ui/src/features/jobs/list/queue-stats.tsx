import type { QueueStats as QueueStatsBody } from '@job-queue/contracts';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/class-names';
import { IntlWholeNumberFormat } from '@/lib/whole-number-format';
import { en } from '@/locales';

import { useQueueStats } from '../hooks/use-queue-stats';
import { IntlStatsFormat } from '../model/intl-stats-format';
import { STATUS_DOT } from '../model/status-style';

const FORMAT = new IntlStatsFormat(
  { wholeNumbers: new IntlWholeNumberFormat() },
  { perMinuteUnit: en.list.stats.perMinute },
);

/** The cards of design "Main", in order, each with the text of its value. */
const STATS = [
  {
    label: en.list.stats.pending,
    dot: STATUS_DOT.pending,
    value: (stats: QueueStatsBody) => FORMAT.count({ value: stats.pending }).text,
  },
  {
    label: en.list.stats.processing,
    dot: STATUS_DOT.processing,
    value: (stats: QueueStatsBody) => FORMAT.count({ value: stats.processing }).text,
  },
  {
    label: en.list.stats.scheduled,
    dot: STATUS_DOT.scheduled,
    value: (stats: QueueStatsBody) => FORMAT.count({ value: stats.scheduled }).text,
  },
  {
    label: en.list.stats.completed,
    dot: STATUS_DOT.completed,
    value: (stats: QueueStatsBody) => FORMAT.count({ value: stats.recent.completed }).text,
  },
  {
    label: en.list.stats.failed,
    dot: STATUS_DOT.failed,
    value: (stats: QueueStatsBody) => FORMAT.count({ value: stats.recent.failed }).text,
  },
  {
    label: en.list.stats.throughput,
    dot: 'bg-muted-foreground',
    value: (stats: QueueStatsBody) => FORMAT.throughput({ value: stats.throughput.perMinute }).text,
  },
] as const;

/**
 * Queue statistics cards (design "Main"), polled from job-service. Skeletons until the first answer;
 * after a failed poll the last values stay, and without any answer yet each card shows "—".
 */
export function QueueStats() {
  const { data, isPending } = useQueueStats();
  return (
    <section
      aria-label={en.list.statsLabel}
      aria-busy={isPending}
      className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3"
    >
      {STATS.map((stat) => (
        <div
          key={stat.label}
          role="group"
          aria-label={stat.label}
          className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span data-stat-dot className={cn('size-2 rounded-[2px]', stat.dot)} />
            {stat.label}
          </div>
          {isPending ? (
            <Skeleton className="h-[39px] w-16" />
          ) : (
            <div data-stat-value className="font-mono text-[26px] font-medium tracking-tight">
              {data === undefined ? en.list.noValue : stat.value(data)}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
