import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import type { Clock } from '../domain/clock.js';
import { DaysAheadScheduleLimit } from './days-ahead-schedule-limit.js';

const clock = mockDeep<Clock>();
const limit = new DaysAheadScheduleLimit({ clock }, { maxAheadDays: 30 });
const NOW = new Date('2026-10-30T12:00:00.000Z');
const LATEST = new Date('2026-11-29T12:00:00.000Z');

describe('DaysAheadScheduleLimit', () => {
  // New York leaves summer time on 1 Nov, between NOW and LATEST: a day of local calendar would be
  // 25 h there, but the rule counts fixed 24 h days, so job-service and job-ui agree in any zone.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = zone;
  });
  beforeEach(() => {
    mockReset(clock);
  });

  it('exactly the maximum ahead is allowed, and the answer names now and the latest instant', () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(limit.check({ scheduledAt: LATEST })).toEqual({
      now: NOW,
      latest: LATEST,
      tooFar: false,
    });
  });

  it('one millisecond past the maximum is too far', () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(limit.check({ scheduledAt: new Date(LATEST.getTime() + 1) }).tooFar).toBe(true);
  });

  it('a time before now is not too far: how far back is not this rule', () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(limit.check({ scheduledAt: new Date('2026-10-01T00:00:00.000Z') }).tooFar).toBe(false);
  });

  it('the number of days comes from the params', () => {
    const oneDay = new DaysAheadScheduleLimit({ clock }, { maxAheadDays: 1 });
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(oneDay.check({ scheduledAt: new Date('2026-10-31T12:00:00.001Z') })).toEqual({
      now: NOW,
      latest: new Date('2026-10-31T12:00:00.000Z'),
      tooFar: true,
    });
  });
});
