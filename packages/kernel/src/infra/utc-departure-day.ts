import type { Clock } from '../domain/clock.js';
import type {
  CheckDepartureDayRequest,
  CheckDepartureDayResponse,
  DepartureDay,
  TodayDepartureDayResponse,
} from '../domain/jobs/departure-day.js';

export interface UtcDepartureDayDeps {
  clock: Clock;
}

/** Length of the date part (`YYYY-MM-DD`) of an ISO timestamp. */
const ISO_DATE_LENGTH = 10;

/** `DepartureDay` on the clock's date in UTC; reads the clock once per call. */
export class UtcDepartureDay implements DepartureDay {
  constructor(private readonly d: UtcDepartureDayDeps) {}

  today(): TodayDepartureDayResponse {
    return { today: this.d.clock.now().now.toISOString().slice(0, ISO_DATE_LENGTH) };
  }

  check({ departureDate }: CheckDepartureDayRequest): CheckDepartureDayResponse {
    const { today } = this.today();
    // ISO dates (YYYY-MM-DD) order the same as strings.
    return { today, over: departureDate < today };
  }
}
