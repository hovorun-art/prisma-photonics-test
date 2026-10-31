import { cn } from '@/lib/class-names';

import { CELL_COLOUR } from './cell-style';

/**
 * A group's progress as a bar: the completed share in the completed colour, then the failed share
 * in the failed colour, on a track of the remaining colour. Its value is the finished share.
 */
export function GroupProgressBar({
  completed,
  failed,
  total,
  label,
  className,
}: {
  completed: number;
  failed: number;
  total: number;
  label: string;
  /** Height, width and rounding of the bar. */
  className: string;
}) {
  const share = (count: number) => (total === 0 ? 0 : (count * 100) / total);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(share(completed + failed))}
      className={cn('flex overflow-hidden', CELL_COLOUR.remaining, className)}
    >
      <div
        className={cn('h-full', CELL_COLOUR.completed)}
        style={{ width: `${share(completed)}%` }}
      />
      <div className={cn('h-full', CELL_COLOUR.failed)} style={{ width: `${share(failed)}%` }} />
    </div>
  );
}
