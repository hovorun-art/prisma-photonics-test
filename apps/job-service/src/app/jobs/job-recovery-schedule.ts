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
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { JOB_RECOVERY, type JobRecovery } from '../../domain/jobs/job-recovery.js';

/** Name of the recovery pass's interval in the scheduler registry. */
export const JOB_RECOVERY_INTERVAL_NAME = 'job-recovery';

/**
 * Runs the recovery pass on the configured interval once the app is up, and stops in
 * `onModuleDestroy`, before the database module closes the pool on shutdown, waiting for the pass
 * in flight. Skipped and failed ticks are the shared `SchedulerIntervalTask`'s rules.
 */
@Injectable()
export class JobRecoverySchedule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly task: IntervalTask;

  constructor(
    @Inject(JOB_RECOVERY) recovery: JobRecovery,
    scheduler: SchedulerRegistry,
    @Inject(JOB_SERVICE_CONFIG) config: Pick<JobServiceConfig, 'recovery'>,
  ) {
    this.task = new SchedulerIntervalTask(
      { scheduler, logger: new Logger(JobRecoverySchedule.name), work: () => recovery.run() },
      {
        name: JOB_RECOVERY_INTERVAL_NAME,
        intervalMs: config.recovery.intervalMs,
        failureMessage: 'Recovery pass failed',
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
