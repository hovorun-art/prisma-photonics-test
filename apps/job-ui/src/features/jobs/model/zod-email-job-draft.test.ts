import { EMAIL_LIMITS, JOB_LIMITS } from '@job-queue/contracts';
import { describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { EMPTY_EMAIL_FORM, type EmailFormValues } from './email-form-values';
import { ZodEmailJobDraft } from './zod-email-job-draft';

const draft = new ZodEmailJobDraft();
const VALID: EmailFormValues = {
  ...EMPTY_EMAIL_FORM,
  payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
};

describe('ZodEmailJobDraft', () => {
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
});
