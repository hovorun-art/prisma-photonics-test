import { JobStatus, JobType, type QueueStats } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';

import type {
  CountByStatusAndTypeJobCountsResponse,
  JobCounts,
} from '../../domain/jobs/job-counts.js';
import type {
  GetJobStatisticsRequest,
  GetJobStatisticsResponse,
  JobStatistics,
} from '../../domain/jobs/job-statistics.js';

const MS_PER_MINUTE = 60_000;

export interface JobStatisticsImplDeps {
  counts: JobCounts;
  clock: Clock;
}

export interface JobStatisticsImplParams {
  /** Length of the window in which completed and failed jobs are counted. */
  recentWindowMinutes: number;
  /** Length of the window over which the throughput of completed jobs is measured. */
  throughputWindowMinutes: number;
}

/**
 * Measures both windows back from the clock's now and turns the counts into statistics. The counts
 * per status and per type are folded from the status and type pairs: each facet keeps only the
 * pairs that match the other facet's filter, so a filter never narrows its own counts.
 */
export class JobStatisticsImpl implements JobStatistics {
  constructor(
    private readonly d: JobStatisticsImplDeps,
    private readonly p: JobStatisticsImplParams,
  ) {}

  async get(req: GetJobStatisticsRequest): Promise<GetJobStatisticsResponse> {
    const now = this.d.clock.now().now.getTime();
    const [counts, pairs] = await Promise.all([
      this.d.counts.count({
        recentSince: this.minutesBefore({ nowMs: now, minutes: this.p.recentWindowMinutes }),
        throughputSince: this.minutesBefore({
          nowMs: now,
          minutes: this.p.throughputWindowMinutes,
        }),
      }),
      this.d.counts.countByStatusAndType({ groupId: req.groupId }),
    ]);
    return {
      stats: {
        pending: counts.pending,
        processing: counts.processing,
        scheduled: counts.scheduled,
        recent: {
          windowMinutes: this.p.recentWindowMinutes,
          completed: counts.recentCompleted,
          failed: counts.recentFailed,
        },
        throughput: {
          windowMinutes: this.p.throughputWindowMinutes,
          perMinute: counts.throughputCompleted / this.p.throughputWindowMinutes,
        },
        counts: this.facets({ cells: pairs.cells, filters: req }),
      },
    };
  }

  private facets(req: {
    cells: CountByStatusAndTypeJobCountsResponse['cells'];
    filters: GetJobStatisticsRequest;
  }): QueueStats['counts'] {
    const status = Object.fromEntries(JobStatus.options.map((s) => [s, 0])) as Record<
      JobStatus,
      number
    >;
    const type = Object.fromEntries(JobType.options.map((t) => [t, 0])) as Record<JobType, number>;
    for (const cell of req.cells) {
      if (req.filters.type === undefined || cell.type === req.filters.type) {
        status[cell.status] += cell.count;
      }
      if (req.filters.status === undefined || cell.status === req.filters.status) {
        type[cell.type] += cell.count;
      }
    }
    return { status, type };
  }

  private minutesBefore(req: { nowMs: number; minutes: number }): string {
    return new Date(req.nowMs - req.minutes * MS_PER_MINUTE).toISOString();
  }
}
