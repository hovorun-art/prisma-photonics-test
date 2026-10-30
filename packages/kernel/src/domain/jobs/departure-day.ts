/** A calendar date, `YYYY-MM-DD`. */
export type CalendarDate = string;

export interface TodayDepartureDayResponse {
  /** Today's date in UTC. */
  today: CalendarDate;
}

export interface CheckDepartureDayRequest {
  departureDate: CalendarDate;
}
export interface CheckDepartureDayResponse {
  today: CalendarDate;
  /** Whether the departure day is over, in UTC: true for any day before today. */
  over: boolean;
}

/**
 * The rule for a flight transit's departure date: it may be submitted while that day (in UTC) is
 * not over yet. Shared by job-service, which enforces it, and job-ui, which checks it before sending.
 */
export interface DepartureDay {
  today(): TodayDepartureDayResponse;
  check(req: CheckDepartureDayRequest): CheckDepartureDayResponse;
}
