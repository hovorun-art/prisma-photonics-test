import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { z } from 'zod';

import type { RunSchedule } from './run-schedule';
import { ZodRunScheduleForm } from './zod-run-schedule-form';

const runSchedule = mockDeep<RunSchedule>();
const form = new ZodRunScheduleForm({ runSchedule });
/** A job type's form schema as the drafts pass it: its own fields plus the optional time. */
const request = z.object({
  name: z.string().min(1),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
});
const schema = form.schema({ request }).schema;
const LATER = { run: 'later', scheduledAt: '2026-10-30T14:30' } as const;
const SENT = '2026-10-30T12:30:00.000Z';

describe('ZodRunScheduleForm', () => {
  beforeEach(() => {
    mockReset(runSchedule);
  });

  it('Immediately at first: "now" sends no scheduledAt', () => {
    runSchedule.check.mockReturnValueOnce({ problem: null });
    runSchedule.toRequest.mockReturnValueOnce({ scheduledAt: undefined });

    const result = schema.safeParse({ name: 'a', run: 'now', scheduledAt: '' });

    expect(result.success && result.data).toEqual({ name: 'a' });
    expect(runSchedule.check).toHaveBeenCalledExactlyOnceWith({ run: 'now', scheduledAt: '' });
  });

  it('Submit a scheduled job: an accepted time is sent as the UTC time the schedule gives', () => {
    runSchedule.check.mockReturnValueOnce({ problem: null });
    runSchedule.toRequest.mockReturnValueOnce({ scheduledAt: SENT });

    const result = schema.safeParse({ name: 'a', ...LATER });

    expect(result.success && result.data).toEqual({ name: 'a', scheduledAt: SENT });
    expect(runSchedule.check).toHaveBeenCalledExactlyOnceWith(LATER);
    expect(runSchedule.toRequest).toHaveBeenCalledExactlyOnceWith(LATER);
  });

  it('Time in the past: a rejected time is an issue on scheduledAt', () => {
    runSchedule.check.mockReturnValueOnce({ problem: 'past' });

    const result = schema.safeParse({ name: 'a', ...LATER });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['scheduledAt']]);
  });

  it('a rejected time and a rejected field of the type are reported together', () => {
    runSchedule.check.mockReturnValueOnce({ problem: 'required' });

    const result = schema.safeParse({ name: '', run: 'later', scheduledAt: '' });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([['scheduledAt'], ['name']]),
    );
    expect(result.error?.issues).toHaveLength(2);
  });

  it('a rejected field of the type fails the form even when the time is accepted', () => {
    runSchedule.check.mockReturnValueOnce({ problem: null });
    runSchedule.toRequest.mockReturnValueOnce({ scheduledAt: SENT });

    const result = schema.safeParse({ name: '', ...LATER });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['name']]);
  });

  it('Preview of a scheduled request: the values without run, with the time to send', () => {
    runSchedule.toRequest.mockReturnValueOnce({ scheduledAt: SENT });

    expect(form.preview({ values: { name: 'a', ...LATER } }).values).toEqual({
      name: 'a',
      scheduledAt: SENT,
    });
  });

  it('the preview leaves scheduledAt out when nothing will be sent', () => {
    runSchedule.toRequest.mockReturnValueOnce({ scheduledAt: undefined });

    expect(form.preview({ values: { name: 'a', run: 'now', scheduledAt: '' } }).values).toEqual({
      name: 'a',
    });
  });
});
