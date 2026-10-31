import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { type IntervalTask, SchedulerIntervalTask } from '@job-queue/service-kit';

import {
  JOB_GROUP_SERVICE_CONFIG,
  type JobGroupServiceConfig,
} from '../../domain/config/job-group-service-config.js';
import { JOB_GROUP_TRACKER, type JobGroupTracker } from '../../domain/groups/job-group-tracker.js';

/** Name of the poll's interval in the scheduler registry. */
export const JOB_GROUP_POLL_INTERVAL_NAME = 'job-group-poll';

/**
 * Runs the tracker on the configured interval once the app is up, and stops in `onModuleDestroy`,
 * before the database module closes the pool on shutdown, waiting for the check in flight. Skipped
 * and failed ticks are the shared `SchedulerIntervalTask`'s rules.
 */
@Injectable()
export class JobGroupPoll implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly task: IntervalTask;

  constructor(
    @Inject(JOB_GROUP_TRACKER) tracker: JobGroupTracker,
    scheduler: SchedulerRegistry,
    @Inject(JOB_GROUP_SERVICE_CONFIG) config: Pick<JobGroupServiceConfig, 'pollIntervalMs'>,
  ) {
    this.task = new SchedulerIntervalTask(
      { scheduler, logger: new Logger(JobGroupPoll.name), work: () => tracker.checkOpen() },
      {
        name: JOB_GROUP_POLL_INTERVAL_NAME,
        intervalMs: config.pollIntervalMs,
        failureMessage: 'Job group poll failed',
      },
    );
  }

  onApplicationBootstrap(): void {
    this.task.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.task.stop();
  }
}
