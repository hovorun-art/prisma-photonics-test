import type { Clock } from '@job-queue/kernel';

import type { JobCounts } from '../../domain/jobs/job-counts.js';
import type { GetJobStatisticsResponse, JobStatistics } from '../../domain/jobs/job-statistics.js';

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

/** Measures both windows back from the clock's now and turns the counts into statistics. */
export class JobStatisticsImpl implements JobStatistics {
  constructor(
    private readonly d: JobStatisticsImplDeps,
    private readonly p: JobStatisticsImplParams,
  ) {}

  async get(): Promise<GetJobStatisticsResponse> {
    const now = this.d.clock.now().now.getTime();
    const counts = await this.d.counts.count({
      recentSince: this.minutesBefore({ nowMs: now, minutes: this.p.recentWindowMinutes }),
      throughputSince: this.minutesBefore({ nowMs: now, minutes: this.p.throughputWindowMinutes }),
    });
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
      },
    };
  }

  private minutesBefore(req: { nowMs: number; minutes: number }): string {
    return new Date(req.nowMs - req.minutes * MS_PER_MINUTE).toISOString();
  }
}
