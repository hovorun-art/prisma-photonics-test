import { JOB_LIMITS } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import { en } from '@/locales';

import { LocalRunSchedule } from './local-run-schedule';

const clock = mockDeep<Clock>();
const schedule = new LocalRunSchedule({ clock });
const NOW = new Date('2026-10-30T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const { maxAheadDays } = JOB_LIMITS.scheduledAt;

describe('LocalRunSchedule', () => {
  beforeEach(() => {
    mockReset(clock);
  });
  afterEach(() => {
    process.env.TZ = 'UTC';
  });

  it('Immediately at first: "now" needs no time and sends none', () => {
    expect(schedule.check({ run: 'now', scheduledAt: '' }).problem).toBeNull();
    expect(schedule.toRequest({ run: 'now', scheduledAt: '' }).scheduledAt).toBeUndefined();
  });

  it('Back to immediately: a time entered before choosing "now" is not sent', () => {
    expect(schedule.check({ run: 'now', scheduledAt: '2020-01-01T00:00' }).problem).toBeNull();
    expect(
      schedule.toRequest({ run: 'now', scheduledAt: '2026-10-30T14:00' }).scheduledAt,
    ).toBeUndefined();
  });

  it('No time entered: an empty time is required, with "Choose a date and time"', () => {
    const values = { run: 'later', scheduledAt: '' } as const;

    expect(schedule.check(values).problem).toBe('required');
    expect(schedule.message(values).message).toBe(en.submit.errors.scheduleRequired);
  });

  it('text that is not a time counts as missing and is not sent', () => {
    const values = { run: 'later', scheduledAt: 'not a time' } as const;

    expect(schedule.check(values).problem).toBe('required');
    expect(schedule.toRequest(values).scheduledAt).toBeUndefined();
  });

  it('a time in the date-time format that is no real date counts as missing and is not sent', () => {
    for (const scheduledAt of ['2026-13-01T00:00', '2026-10-30T25:00']) {
      const values = { run: 'later', scheduledAt } as const;

      expect(schedule.check(values).problem).toBe('required');
      expect(schedule.toRequest(values).scheduledAt).toBeUndefined();
    }
  });

  it('a time with an offset or a bare date is not a local date-time and is not sent', () => {
    for (const scheduledAt of ['2026-10-30T14:00Z', '2026-10-30T14:00+02:00', '2026-10-30']) {
      const values = { run: 'later', scheduledAt } as const;

      expect(schedule.check(values).problem).toBe('required');
      expect(schedule.toRequest(values).scheduledAt).toBeUndefined();
    }
  });

  it('a time with seconds is accepted and sent with its seconds', () => {
    clock.now.mockReturnValueOnce({ now: NOW });
    const values = { run: 'later', scheduledAt: '2026-10-30T14:30:15' } as const;

    expect(schedule.check(values).problem).toBeNull();
    expect(schedule.toRequest(values).scheduledAt).toBe('2026-10-30T14:30:15.000Z');
  });

  it('Time in the past: a time before now is rejected with "Choose a time in the future"', () => {
    clock.now.mockReturnValueOnce({ now: NOW });
    clock.now.mockReturnValueOnce({ now: NOW });
    const values = { run: 'later', scheduledAt: '2026-10-30T11:59' } as const;

    expect(schedule.check(values).problem).toBe('past');
    expect(schedule.message(values).message).toBe(en.submit.errors.schedulePast);
  });

  it('a time equal to now is rejected as past', () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(schedule.check({ run: 'later', scheduledAt: '2026-10-30T12:00' }).problem).toBe('past');
  });

  it('a time one minute after now is accepted', () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(schedule.check({ run: 'later', scheduledAt: '2026-10-30T12:01' }).problem).toBeNull();
  });

  // The next two build local text from UTC instants: equal under the tests' TZ=UTC (test-setup).
  it('Time too far ahead: past the maximum is rejected with a message naming the days', () => {
    clock.now.mockReturnValueOnce({ now: NOW });
    clock.now.mockReturnValueOnce({ now: NOW });
    const tooFar = new Date(NOW.getTime() + maxAheadDays * MS_PER_DAY + 60_000);
    const values = { run: 'later', scheduledAt: tooFar.toISOString().slice(0, 16) } as const;

    expect(schedule.check(values).problem).toBe('tooFar');
    expect(schedule.message(values).message).toBe(en.submit.errors.scheduleTooFar(maxAheadDays));
  });

  it('exactly the maximum ahead is accepted, as by the API', () => {
    clock.now.mockReturnValueOnce({ now: NOW });
    const latest = new Date(NOW.getTime() + maxAheadDays * MS_PER_DAY);

    expect(
      schedule.check({ run: 'later', scheduledAt: latest.toISOString().slice(0, 16) }).problem,
    ).toBeNull();
  });

  it('Submit a scheduled job: the local time is sent as the same instant in UTC', () => {
    process.env.TZ = 'Europe/Kyiv';

    // 30 Oct 2026 in Kyiv is UTC+2 (winter time).
    expect(schedule.toRequest({ run: 'later', scheduledAt: '2026-10-30T14:30' }).scheduledAt).toBe(
      '2026-10-30T12:30:00.000Z',
    );
  });

  it('the past check compares the local time, not its text read as UTC', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 20:30 in Tokyo is 11:30 UTC, before NOW; read as UTC it would look 8 hours ahead.
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(schedule.check({ run: 'later', scheduledAt: '2026-10-30T20:30' }).problem).toBe('past');
  });

  it("Choose a specific time: the hint's time zone is the browser's", () => {
    process.env.TZ = 'America/New_York';

    expect(schedule.timeZone().timeZone).toBe('America/New_York');
  });
});
