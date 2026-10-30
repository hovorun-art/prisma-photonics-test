import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import type { Clock } from '../domain/clock.js';
import { UtcDepartureDay } from './utc-departure-day.js';

const clock = mockDeep<Clock>();
const departureDay = new UtcDepartureDay({ clock });
/** Late evening in UTC: east of UTC it is already the next day, which must not count. */
const NOW = new Date('2026-10-30T23:30:00.000Z');

describe('UtcDepartureDay', () => {
  // UTC+14: at NOW the local date is already the next day, so a local-date "today" fails here.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Pacific/Kiritimati';
  });
  afterAll(() => {
    process.env.TZ = zone;
  });
  beforeEach(() => {
    mockReset(clock);
  });

  it("today: the clock's calendar date in UTC", () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(departureDay.today()).toEqual({ today: '2026-10-30' });
  });

  it.each([
    ['yesterday', '2026-10-29', true],
    ['today', '2026-10-30', false],
    ['tomorrow, though already today east of UTC', '2026-10-31', false],
    ['an earlier year', '2025-12-31', true],
    ['a later year with an earlier month', '2027-01-01', false],
  ])('check: a departure %s (%s) is over: %s', (_name, departureDate, over) => {
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(departureDay.check({ departureDate })).toEqual({ today: '2026-10-30', over });
  });

  it('check: just after midnight UTC the previous day is over', () => {
    clock.now.mockReturnValueOnce({ now: new Date('2026-10-31T00:00:00.000Z') });

    expect(departureDay.check({ departureDate: '2026-10-30' })).toEqual({
      today: '2026-10-31',
      over: true,
    });
  });

  it('today: west of UTC, early in the UTC day, it is still the UTC date, not the local day before', () => {
    process.env.TZ = 'Pacific/Pago_Pago';
    try {
      clock.now.mockReturnValueOnce({ now: new Date('2026-10-30T00:30:00.000Z') });

      expect(departureDay.today()).toEqual({ today: '2026-10-30' });
    } finally {
      process.env.TZ = 'Pacific/Kiritimati';
    }
  });
});
