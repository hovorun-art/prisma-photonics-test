import { JOB_LIMITS } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';

import { en } from '@/locales';

import type {
  CheckRunScheduleRequest,
  CheckRunScheduleResponse,
  MessageRunScheduleRequest,
  MessageRunScheduleResponse,
  RunSchedule,
  RunScheduleValues,
  TimeZoneRunScheduleResponse,
  ToRequestRunScheduleRequest,
  ToRequestRunScheduleResponse,
} from './run-schedule';

export interface LocalRunScheduleDeps {
  readonly clock: Clock;
}

/** What a `datetime-local` input holds: a date and a time without an offset, seconds optional. */
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `RunSchedule` for a time entered in the browser's time zone, checked against the injected clock
 * with the API's rules: later than now, and at most the contract's maximum ahead (exactly the
 * maximum is allowed).
 */
export class LocalRunSchedule implements RunSchedule {
  constructor(private readonly d: LocalRunScheduleDeps) {}

  check(req: CheckRunScheduleRequest): CheckRunScheduleResponse {
    if (req.run === 'now') return { problem: null };
    const at = this.instant(req);
    if (at === null) return { problem: 'required' };
    const now = this.d.clock.now().now.getTime();
    if (at.getTime() <= now) return { problem: 'past' };
    const latest = now + JOB_LIMITS.scheduledAt.maxAheadDays * MS_PER_DAY;
    return { problem: at.getTime() > latest ? 'tooFar' : null };
  }

  toRequest(req: ToRequestRunScheduleRequest): ToRequestRunScheduleResponse {
    if (req.run === 'now') return { scheduledAt: undefined };
    return { scheduledAt: this.instant(req)?.toISOString() };
  }

  message(req: MessageRunScheduleRequest): MessageRunScheduleResponse {
    switch (this.check(req).problem) {
      case 'past':
        return { message: en.submit.errors.schedulePast };
      case 'tooFar':
        return { message: en.submit.errors.scheduleTooFar(JOB_LIMITS.scheduledAt.maxAheadDays) };
      // The form asks for a message only for a rejected time; an accepted one has none of its own.
      case 'required':
      case null:
        return { message: en.submit.errors.scheduleRequired };
    }
  }

  timeZone(): TimeZoneRunScheduleResponse {
    return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  /** The entered time as an instant; ECMAScript reads a date-time without an offset as local. */
  private instant({ scheduledAt }: RunScheduleValues): Date | null {
    if (!LOCAL_DATE_TIME.test(scheduledAt)) return null;
    const at = new Date(scheduledAt);
    return Number.isNaN(at.getTime()) ? null : at;
  }
}
