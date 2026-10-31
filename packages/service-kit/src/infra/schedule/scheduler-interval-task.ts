import type { LoggerService } from '@nestjs/common';
import type { SchedulerRegistry } from '@nestjs/schedule';

import type {
  IntervalTask,
  StartIntervalTaskResponse,
  StopIntervalTaskResponse,
} from '../../domain/schedule/interval-task.js';

export interface SchedulerIntervalTaskDeps {
  scheduler: SchedulerRegistry;
  logger: Pick<LoggerService, 'error'>;
  /** One run; a rejection is logged with `failureMessage`, never thrown. */
  work: () => Promise<unknown>;
}

export interface SchedulerIntervalTaskParams {
  /** The interval's name in the scheduler registry. */
  name: string;
  intervalMs: number;
  /** The log message of a failed run. */
  failureMessage: string;
}

/**
 * An interval kept in Nest's scheduler registry. The scheduler does not wait for a run, so a tick
 * is skipped while the previous run still goes on; `stop` removes the interval and waits for the
 * run in flight.
 */
export class SchedulerIntervalTask implements IntervalTask {
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly d: SchedulerIntervalTaskDeps,
    private readonly p: SchedulerIntervalTaskParams,
  ) {}

  start(): StartIntervalTaskResponse {
    const interval = setInterval(() => {
      this.tick();
    }, this.p.intervalMs);
    this.d.scheduler.addInterval(this.p.name, interval);
    return {};
  }

  async stop(): Promise<StopIntervalTaskResponse> {
    if (this.d.scheduler.doesExist('interval', this.p.name)) {
      this.d.scheduler.deleteInterval(this.p.name);
    }
    await this.inFlight;
    return {};
  }

  private tick(): void {
    if (this.inFlight !== undefined) return;
    this.inFlight = this.d
      .work()
      .then(
        () => undefined,
        (err: unknown) => {
          this.d.logger.error({ err }, this.p.failureMessage);
        },
      )
      .finally(() => {
        this.inFlight = undefined;
      });
  }
}
