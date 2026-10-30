import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_ROWS = 5;
/** Padding of every list cell; the first and last cells line up with the card's edges. */
export const LIST_CELL = 'px-2 py-3 first:pl-5 last:pr-5';

/**
 * The table of a list page (design "Main"): its header row, then `rows`, or skeleton rows labelled
 * `loadingLabel` while `rows` is undefined; scrolls horizontally on narrow screens.
 */
export function ListTable({
  columns,
  rows,
  loadingLabel,
  minWidth,
  lastColumnRight = false,
}: {
  columns: readonly string[];
  rows: ReactNode | undefined;
  loadingLabel: string;
  /** Tailwind min-width class, e.g. `min-w-[1040px]`. */
  minWidth: string;
  lastColumnRight?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${minWidth} border-collapse text-left`}>
        <thead className="h-10 bg-surface-muted text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className={`${LIST_CELL} font-medium ${lastColumnRight ? 'last:text-right' : ''}`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        {rows === undefined ? (
          <tbody aria-label={loadingLabel} aria-busy="true">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i} className="border-t border-border-soft">
                {columns.map((column) => (
                  <td key={column} className={LIST_CELL}>
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : (
          <tbody>{rows}</tbody>
        )}
      </table>
    </div>
  );
}
