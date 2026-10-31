import type { CellKind } from '../model/group-progress';

/** The cell colours, the same as the job statuses': completed green, failed red, remaining grey. */
export const CELL_COLOUR: Readonly<Record<CellKind, string>> = {
  completed: 'bg-status-completed',
  failed: 'bg-status-failed',
  remaining: 'bg-border',
};
