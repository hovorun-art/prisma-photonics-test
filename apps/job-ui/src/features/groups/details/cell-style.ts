import type { CellKind } from '../model/group-progress';

/** The design's three cell colours (design "BatchJob"): completed blue, failed red, remaining grey. */
export const CELL_COLOUR: Readonly<Record<CellKind, string>> = {
  completed: 'bg-status-processing',
  failed: 'bg-status-failed',
  remaining: 'bg-border',
};
