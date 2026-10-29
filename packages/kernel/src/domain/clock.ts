/** Port for the current time. Inject it instead of calling `new Date()` or `Date.now()`. */
export interface Clock {
  now(): NowClockResponse;
}

export interface NowClockResponse {
  now: Date;
}

export const CLOCK = Symbol('Clock');
