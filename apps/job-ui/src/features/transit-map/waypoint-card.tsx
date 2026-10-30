import { Plane } from 'lucide-react';

import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import type { WaypointTransitReportPresentationResponse } from './model/transit-report-presentation';

/** The details of the selected waypoint, shown over the map (design "TransitReport"). */
export function WaypointCard({
  card,
  className,
}: {
  card: WaypointTransitReportPresentationResponse;
  className?: string;
}) {
  const rows: [string, string][] = [
    [en.report.waypoint.position, card.position],
    [en.report.waypoint.altitude, card.altitude],
    [en.report.waypoint.groundSpeed, card.groundSpeed],
    [en.report.waypoint.flownLeft, card.flownLeft],
  ];
  return (
    <div
      role="status"
      aria-label={en.report.selectedWaypoint}
      className={cn(
        'pointer-events-none flex w-[260px] flex-col gap-2 rounded-[10px] border border-border bg-card px-3.5 py-3 shadow-[0_8px_24px_rgba(23,23,26,0.12)]',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{card.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{card.time}</span>
      </div>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="m-0 text-right font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center gap-2 border-t border-border-soft pt-2 text-xs text-subtle-foreground">
        <Plane aria-hidden="true" className="size-3.5" />
        {card.aircraft}
      </div>
    </div>
  );
}
