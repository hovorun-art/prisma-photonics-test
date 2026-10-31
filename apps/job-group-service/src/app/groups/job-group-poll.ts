import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import {
  JOB_GROUP_SERVICE_CONFIG,
  type JobGroupServiceConfig,
} from '../../domain/config/job-group-service-config.js';
import { JOB_GROUP_TRACKER, type JobGroupTracker } from '../../domain/groups/job-group-tracker.js';

/** Name of the poll's interval in the scheduler registry. */
export const JOB_GROUP_POLL_INTERVAL_NAME = 'job-group-poll';

/**
 * Runs the tracker on the configured interval once the app is up. A tick is skipped while the
 * previous check still runs (the scheduler does not wait for it), and a failed check is logged and
 * retried at the next tick. It stops in `onModuleDestroy`, before the database module closes the
 * pool on shutdown, and waits for the check in flight.
 */
@Injectable()
export class JobGroupPoll implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobGroupPoll.name);
  private inFlight: Promise<void> | undefined;

  constructor(
    @Inject(JOB_GROUP_TRACKER) private readonly tracker: JobGroupTracker,
    private readonly scheduler: SchedulerRegistry,
    @Inject(JOB_GROUP_SERVICE_CONFIG)
    private readonly config: Pick<JobGroupServiceConfig, 'pollIntervalMs'>,
  ) {}

  onApplicationBootstrap(): void {
    const interval = setInterval(() => {
      this.tick();
    }, this.config.pollIntervalMs);
    this.scheduler.addInterval(JOB_GROUP_POLL_INTERVAL_NAME, interval);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.scheduler.doesExist('interval', JOB_GROUP_POLL_INTERVAL_NAME)) {
      this.scheduler.deleteInterval(JOB_GROUP_POLL_INTERVAL_NAME);
    }
    await this.inFlight;
  }

  private tick(): void {
    if (this.inFlight !== undefined) return;
    this.inFlight = this.tracker
      .checkOpen()
      .then(
        () => undefined,
        (err: unknown) => {
          this.logger.error({ err }, 'Job group poll failed');
        },
      )
      .finally(() => {
        this.inFlight = undefined;
      });
  }
}
