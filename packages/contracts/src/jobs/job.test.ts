import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CreateJobRequest,
  EMAIL_LIMITS,
  EmailJobResult,
  JOB_LIMITS,
  JobIdParams,
  QueryJobsRequest,
  UpdateJobRequest,
} from './job.js';

const validEmailJob = {
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
  priority: 7,
  maxAttempts: 4,
};

describe('CreateJobRequest', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    CreateJobRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

  it('Valid email job is accepted', () => {
    expect(CreateJobRequest.parse(validEmailJob)).toEqual(validEmailJob);
  });

  it('Defaults are applied', () => {
    const { priority: _priority, maxAttempts: _maxAttempts, ...withoutOptions } = validEmailJob;

    const parsed = CreateJobRequest.parse(withoutOptions);

    expect(parsed.priority).toBe(JOB_LIMITS.priority.default);
    expect(parsed.maxAttempts).toBe(JOB_LIMITS.maxAttempts.default);
  });

  it('Unknown job type', () => {
    expect(issuePaths({ ...validEmailJob, type: 'fax' })).toContainEqual(['type']);
  });

  it('Invalid email address', () => {
    expect(
      issuePaths({ ...validEmailJob, payload: { ...validEmailJob.payload, to: 'not-an-email' } }),
    ).toContainEqual(['payload', 'to']);
  });

  it('Empty subject', () => {
    expect(
      issuePaths({ ...validEmailJob, payload: { ...validEmailJob.payload, subject: '' } }),
    ).toContainEqual(['payload', 'subject']);
  });

  it('Email field too long', () => {
    const subject = 'a'.repeat(EMAIL_LIMITS.subjectMaxLength + 1);
    const body = 'a'.repeat(EMAIL_LIMITS.bodyMaxLength + 1);

    expect(
      issuePaths({ ...validEmailJob, payload: { ...validEmailJob.payload, subject, body } }),
    ).toEqual(
      expect.arrayContaining([
        ['payload', 'subject'],
        ['payload', 'body'],
      ]),
    );
  });

  it('Priority out of range', () => {
    for (const priority of [JOB_LIMITS.priority.min - 1, JOB_LIMITS.priority.max + 1, 2.5]) {
      expect(issuePaths({ ...validEmailJob, priority })).toContainEqual(['priority']);
    }
  });

  it('Max attempts out of range', () => {
    for (const maxAttempts of [
      JOB_LIMITS.maxAttempts.min - 1,
      JOB_LIMITS.maxAttempts.max + 1,
      1.5,
    ]) {
      expect(issuePaths({ ...validEmailJob, maxAttempts })).toContainEqual(['maxAttempts']);
    }
  });
});

describe('QueryJobsRequest', () => {
  it('coerces query-string numbers and defaults the offset to zero', () => {
    expect(QueryJobsRequest.parse({ limit: '2' })).toEqual({ limit: 2, offset: 0 });
  });

  it('leaves the limit to the configured default when it is omitted', () => {
    expect(QueryJobsRequest.parse({}).limit).toBeUndefined();
  });

  it('Negative offset', () => {
    const result = QueryJobsRequest.safeParse({ offset: '-1' });

    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['offset']);
  });

  it('rejects a limit that is not a positive integer', () => {
    for (const limit of ['0', '-3', '1.5', 'many']) {
      const result = QueryJobsRequest.safeParse({ limit });

      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['limit']);
    }
  });
});

describe('JobIdParams', () => {
  it('accepts a UUID', () => {
    const id = randomUUID();

    expect(JobIdParams.parse({ id })).toEqual({ id });
  });

  it('Malformed id', () => {
    const result = JobIdParams.safeParse({ id: 'abc' });

    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['id']);
  });
});

describe('UpdateJobRequest', () => {
  it('accepts a start, a completion with a result and a failure with an error', () => {
    expect(UpdateJobRequest.parse({ status: 'processing' })).toEqual({ status: 'processing' });
    expect(UpdateJobRequest.parse({ status: 'completed', result: { messageId: 'm-1' } })).toEqual({
      status: 'completed',
      result: { messageId: 'm-1' },
    });
    expect(
      UpdateJobRequest.parse({
        status: 'failed',
        error: { code: 'SEND_FAILED', message: 'Mailbox unavailable' },
      }),
    ).toEqual({ status: 'failed', error: { code: 'SEND_FAILED', message: 'Mailbox unavailable' } });
  });

  it('Unknown target status', () => {
    for (const status of ['pending', 'cancelled', 'done']) {
      expect(UpdateJobRequest.safeParse({ status }).success).toBe(false);
    }
  });

  it('rejects a failure without an error', () => {
    expect(UpdateJobRequest.safeParse({ status: 'failed' }).success).toBe(false);
  });
});

describe('EmailJobResult', () => {
  it('accepts a message id', () => {
    expect(EmailJobResult.parse({ messageId: 'm-1' })).toEqual({ messageId: 'm-1' });
  });

  it('Result does not match the job type', () => {
    expect(EmailJobResult.safeParse({ id: 'm-1' }).success).toBe(false);
  });
});
