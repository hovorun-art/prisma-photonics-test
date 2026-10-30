import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';

const STATS = [
  { label: en.list.stats.pending, color: '#8A4B00' },
  { label: en.list.stats.processing, color: '#1F3FC4' },
  { label: en.list.stats.scheduled, color: '#5B3FB8' },
  { label: en.list.stats.completed, color: '#13703A' },
  { label: en.list.stats.failed, color: '#B42121' },
  { label: en.list.stats.throughput, color: '#5C5C63' },
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
              <span className="size-2 rounded-[2px]" style={{ background: stat.color }} />
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
