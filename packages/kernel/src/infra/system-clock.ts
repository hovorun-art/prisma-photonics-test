import type { Clock, NowClockResponse } from '../domain/clock.js';

export class SystemClock implements Clock {
  now(): NowClockResponse {
    return { now: new Date() };
  }
}
