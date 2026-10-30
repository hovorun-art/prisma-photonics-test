import { EMAIL_LIMITS, JOB_LIMITS } from '@job-queue/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import { en } from '@/locales';

import { EMPTY_EMAIL_FORM, type EmailFormValues } from './email-form-values';
import type { RunSchedule } from './run-schedule';
import { ZodEmailJobDraft } from './zod-email-job-draft';

const runSchedule = mockDeep<RunSchedule>();
const draft = new ZodEmailJobDraft({ runSchedule });
const schema = draft.schema().schema;
const LOCAL_TIME = '2026-10-31T09:00';
const SENT_TIME = '2026-10-31T09:00:00.000Z';
const VALID: EmailFormValues = {
  ...EMPTY_EMAIL_FORM,
  payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
};

describe('ZodEmailJobDraft', () => {
  /** Stubs the run schedule for one parse or preview of a form with "Immediately" chosen. */
  function runsNow() {
    runSchedule.check.mockReturnValueOnce({ problem: null });
    runSchedule.toRequest.mockReturnValueOnce({ scheduledAt: undefined });
  }

  beforeEach(() => {
    mockReset(runSchedule);
  });

  it('Submit a valid email job: "Immediately" sends the values without a time', () => {
    runsNow();

    const result = schema.safeParse(VALID);

    expect(result.success && result.data).toEqual({
      type: 'email',
      payload: VALID.payload,
      priority: VALID.priority,
      maxAttempts: VALID.maxAttempts,
    });
  });

  it.each([
    ['payload.to', en.submit.errors.to],
    ['payload.body', en.submit.errors.bodyTooLong(EMAIL_LIMITS.bodyMaxLength)],
    ['priority', en.submit.errors.priority(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max)],
    [
      'maxAttempts',
      en.submit.errors.maxAttempts(JOB_LIMITS.maxAttempts.min, JOB_LIMITS.maxAttempts.max),
    ],
  ] as const)("fieldMessage: job-ui's own message for %s", (field, message) => {
    expect(draft.fieldMessage({ field, values: VALID })).toEqual({ message });
  });

  it('fieldMessage: tells a missing subject from a too long one', () => {
    const missing = { ...VALID, payload: { ...VALID.payload, subject: '' } };
    const tooLong = {
      ...VALID,
      payload: { ...VALID.payload, subject: 'x'.repeat(EMAIL_LIMITS.subjectMaxLength + 1) },
    };

    expect(draft.fieldMessage({ field: 'payload.subject', values: missing }).message).toBe(
      en.submit.errors.subjectRequired,
    );
    expect(draft.fieldMessage({ field: 'payload.subject', values: tooLong }).message).toBe(
      en.submit.errors.subjectTooLong(EMAIL_LIMITS.subjectMaxLength),
    );
  });

  it("apiErrors: maps an API VALIDATION_FAILED onto the fields with the API's messages", () => {
    const result = draft.apiErrors({
      details: {
        issues: [
          { path: ['payload', 'to'], message: 'Invalid email address' },
          { path: ['priority'], message: 'Too big' },
        ],
      },
    });

    expect(result).toEqual({
      errors: { 'payload.to': 'Invalid email address', priority: 'Too big' },
      unmatched: [],
    });
  });

  it('apiErrors: returns issues that match no field as unmatched, so they are not lost', () => {
    const result = draft.apiErrors({
      details: { issues: [{ path: ['type'], message: 'Unknown job type' }] },
    });

    expect(result).toEqual({ errors: {}, unmatched: ['Unknown job type'] });
  });

  it('apiErrors: treats details that are not a list of issues as nothing to map', () => {
    expect(draft.apiErrors({ details: { issues: 'broken' } })).toEqual({
      errors: {},
      unmatched: [],
    });
  });

  it('Submit a scheduled job: the time the run schedule gives is sent as scheduledAt', () => {
    const values = { ...VALID, run: 'later' as const, scheduledAt: LOCAL_TIME };
    runSchedule.check.mockReturnValueOnce({ problem: null });
    runSchedule.toRequest.mockReturnValueOnce({ scheduledAt: SENT_TIME });

    const result = schema.safeParse(values);

    expect(result.success && result.data.scheduledAt).toBe(SENT_TIME);
    expect(runSchedule.check).toHaveBeenCalledExactlyOnceWith({
      run: 'later',
      scheduledAt: LOCAL_TIME,
    });
  });

  it("fieldMessage: the run schedule's message for the scheduled time", () => {
    const values = { ...VALID, run: 'later' as const, scheduledAt: '' };
    runSchedule.message.mockReturnValueOnce({ message: en.submit.errors.scheduleRequired });

    expect(draft.fieldMessage({ field: 'scheduledAt', values }).message).toBe(
      en.submit.errors.scheduleRequired,
    );
    expect(runSchedule.message).toHaveBeenCalledExactlyOnceWith({ run: 'later', scheduledAt: '' });
  });

  it('API validation error on the scheduled time: the issue maps onto the scheduledAt field', () => {
    const result = draft.apiErrors({
      details: { issues: [{ path: ['scheduledAt'], message: 'Too far ahead' }] },
    });

    expect(result).toEqual({ errors: { scheduledAt: 'Too far ahead' }, unmatched: [] });
  });

  it('Preview of a scheduled request: no run choice, the time as it will be sent', () => {
    runSchedule.toRequest.mockReturnValueOnce({ scheduledAt: SENT_TIME });

    const { request } = draft.previewRequest({
      values: { ...VALID, run: 'later', scheduledAt: LOCAL_TIME },
    });

    expect(request).toEqual({
      type: 'email',
      payload: VALID.payload,
      priority: VALID.priority,
      maxAttempts: VALID.maxAttempts,
      scheduledAt: SENT_TIME,
    });
  });
});
