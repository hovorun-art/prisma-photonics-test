import type { JobGroup } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';

import type { GroupChildJobs } from '../../domain/groups/group-child-jobs.js';
import type { JobGroupRepository } from '../../domain/groups/job-group-repository.js';
import type {
  CheckRunningJobGroupTrackerResponse,
  JobGroupTracker,
} from '../../domain/groups/job-group-tracker.js';

export interface JobGroupTrackerImplDeps {
  repository: JobGroupRepository;
  childJobs: GroupChildJobs;
  clock: Clock;
  logger: Pick<LoggerService, 'error'>;
}

export interface JobGroupTrackerImplParams {
  /** Running groups read from the store at a time. */
  batchSize: number;
}

/**
 * Brings running groups up to date from job-service's child counts. Per group: `total` is the
 * highest count seen, children missing from it count as failed, and the group finishes once
 * `completed + failed` reaches a non-zero `total`. One group's failure is logged and does not
 * hold back the others.
 */
export class JobGroupTrackerImpl implements JobGroupTracker {
  constructor(
    private readonly d: JobGroupTrackerImplDeps,
    private readonly p: JobGroupTrackerImplParams,
  ) {}

  async checkRunning(): Promise<CheckRunningJobGroupTrackerResponse> {
    let checked = 0;
    let failedChecks = 0;
    let afterId: string | undefined;
    for (;;) {
      const { groups } = await this.d.repository.listRunning({
        limit: this.p.batchSize,
        ...(afterId === undefined ? {} : { afterId }),
      });
      for (const group of groups) {
        const outcome = await this.checkGroup({ group });
        if (outcome === 'recorded') checked += 1;
        else if (outcome === 'failed') failedChecks += 1;
      }
      const last = groups.at(-1);
      if (groups.length < this.p.batchSize || last === undefined) break;
      afterId = last.id;
    }
    return { checked, failedChecks };
  }

  /**
   * `skipped` when the store no longer runs the group (finished or deleted meanwhile); a failure is
   * logged and gives `failed`.
   */
  private async checkGroup(req: { group: JobGroup }): Promise<'recorded' | 'skipped' | 'failed'> {
    const { group } = req;
    try {
      const reported = await this.d.childJobs.count({ groupId: group.id });
      const total = Math.max(group.total, reported.total);
      const completed = reported.completed;
      const failed = reported.failed + (total - reported.total);
      const finished = total > 0 && completed + failed === total;
      const now = this.d.clock.now().now.toISOString();
      const { recorded } = await this.d.repository.recordCheck({
        id: group.id,
        status: finished ? (completed === total ? 'completed' : 'failed') : 'running',
        total,
        completed,
        failed,
        checkedAt: now,
        finishedAt: finished ? now : null,
      });
      return recorded ? 'recorded' : 'skipped';
    } catch (err) {
      this.d.logger.error({ err, groupId: group.id }, 'Job group check failed');
      return 'failed';
    }
  }
}
