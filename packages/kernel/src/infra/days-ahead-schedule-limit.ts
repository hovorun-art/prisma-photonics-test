import type { Clock } from '../domain/clock.js';
import type {
  CheckScheduleLimitRequest,
  CheckScheduleLimitResponse,
  ScheduleLimit,
} from '../domain/jobs/schedule-limit.js';

export interface DaysAheadScheduleLimitDeps {
  clock: Clock;
}
export interface DaysAheadScheduleLimitParams {
  /** How many days after now a job may be scheduled for at most. */
  maxAheadDays: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `ScheduleLimit` of a number of days after the clock's now; reads the clock once per call. */
export class DaysAheadScheduleLimit implements ScheduleLimit {
  constructor(
    private readonly d: DaysAheadScheduleLimitDeps,
    private readonly p: DaysAheadScheduleLimitParams,
  ) {}

  check({ scheduledAt }: CheckScheduleLimitRequest): CheckScheduleLimitResponse {
    const { now } = this.d.clock.now();
    const latest = new Date(now.getTime() + this.p.maxAheadDays * MS_PER_DAY);
    return { now, latest, tooFar: scheduledAt.getTime() > latest.getTime() };
  }
}
