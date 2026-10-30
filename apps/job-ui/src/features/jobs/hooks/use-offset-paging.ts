import { useState } from 'react';

/** Where a list is: its offset and the offsets of the pages before it, for one reset key. */
interface Paging {
  readonly key: string;
  readonly offset: number;
  /** Offsets of the pages visited before this one, so Previous returns to exactly that page even
   * from a last page shorter than the others. */
  readonly previousOffsets: readonly number[];
}

/**
 * Previous/Next paging by offset, shared by the list pages. A new `resetKey` (e.g. other filters)
 * drops the stored paging, so the list starts again at its first page, also when it returns to an
 * earlier key. Set during render, React's pattern for state that follows input.
 */
export function useOffsetPaging(resetKey = '') {
  const [paging, setPaging] = useState<Paging>({ key: resetKey, offset: 0, previousOffsets: [] });
  const current: Paging =
    paging.key === resetKey ? paging : { key: resetKey, offset: 0, previousOffsets: [] };
  if (current !== paging) setPaging(current);
  return {
    offset: current.offset,
    previous: () => {
      setPaging({
        key: resetKey,
        offset: current.previousOffsets.at(-1) ?? 0,
        previousOffsets: current.previousOffsets.slice(0, -1),
      });
    },
    /** To the page after the current one, which showed `shown` rows. */
    next: (shown: number) => {
      setPaging({
        key: resetKey,
        offset: current.offset + shown,
        previousOffsets: [...current.previousOffsets, current.offset],
      });
    },
  };
}
