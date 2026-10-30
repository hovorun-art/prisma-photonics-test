import type {
  CellGroupProgressRequest,
  CellGroupProgressResponse,
  GroupProgress,
  SummaryGroupProgressRequest,
  SummaryGroupProgressResponse,
} from './group-progress';

/** `GroupProgress` from the group's stored counts. */
export class GroupProgressImpl implements GroupProgress {
  summary(req: SummaryGroupProgressRequest): SummaryGroupProgressResponse {
    const { total, completed, failed } = req.group;
    const finished = completed + failed;
    return {
      finished,
      percent: total === 0 ? 0 : Math.floor((finished * 100) / total),
      remaining: total - finished,
    };
  }

  cell(req: CellGroupProgressRequest): CellGroupProgressResponse {
    if (req.status === 'completed') return { kind: 'completed' };
    if (req.status === 'failed' || req.status === 'cancelled') return { kind: 'failed' };
    return { kind: 'remaining' };
  }
}
