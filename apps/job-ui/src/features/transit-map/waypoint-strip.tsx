import { cn } from '@/lib/class-names';
import { en } from '@/locales';

/** The waypoints as a row of buttons under the map; hovering, focusing or clicking selects one. */
export function WaypointStrip({
  waypoints,
  selected,
  onSelect,
}: {
  waypoints: readonly { readonly name: string; readonly time: string }[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="overflow-x-auto border-t border-border px-4 py-3">
      <div
        role="group"
        aria-label={en.report.waypointsLabel}
        className="flex min-w-[760px] gap-1.5"
      >
        {waypoints.map((waypoint, index) => {
          const pressed = index === selected;
          const select = () => {
            onSelect(index);
          };
          return (
            <button
              key={`${waypoint.name}-${waypoint.time}`}
              type="button"
              aria-pressed={pressed}
              onClick={select}
              onFocus={select}
              onMouseEnter={select}
              className={cn(
                'flex flex-1 cursor-pointer flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left',
                pressed ? 'border-[#1F3FC4] bg-[#EBEFFD]' : 'border-border bg-card',
              )}
            >
              <span
                className={cn(
                  'font-mono text-xs',
                  pressed ? 'text-[#1F3FC4]' : 'text-muted-foreground',
                )}
              >
                {waypoint.time}
              </span>
              <span className="text-[13px] font-medium">{waypoint.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
