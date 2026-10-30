import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';
import { STATUS_DOT } from '../model/status-style';

const STATS = [
  { label: en.list.stats.pending, dot: STATUS_DOT.pending },
  { label: en.list.stats.processing, dot: STATUS_DOT.processing },
  { label: en.list.stats.scheduled, dot: STATUS_DOT.scheduled },
  { label: en.list.stats.completed, dot: STATUS_DOT.completed },
  { label: en.list.stats.failed, dot: STATUS_DOT.failed },
  { label: en.list.stats.throughput, dot: 'bg-muted-foreground' },
] as const;

/** Queue statistics cards (design "Main"); no statistics API yet, so each shows "—". */
export function QueueStats() {
  return (
    <section
      aria-label={en.list.statsLabel}
      className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3"
    >
      {STATS.map((stat) => (
        <ComingSoon key={stat.label} className="rounded-xl">
          <div className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className={cn('size-2 rounded-[2px]', stat.dot)} />
              {stat.label}
            </div>
            <div className="font-mono text-[26px] font-medium tracking-tight">
              {en.list.noValue}
            </div>
          </div>
        </ComingSoon>
      ))}
    </section>
  );
}
