import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CreateJobRequest,
  EMAIL_LIMITS,
  EmailJobResult,
  Job,
  JOB_LIMITS,
  JobIdParams,
  QueryJobsRequest,
  UpdateJobRequest,
  WEBHOOK_LIMITS,
  WEBHOOK_METHODS,
  WebhookJobResult,
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
    const { type: _type, ...withoutType } = validEmailJob;
    const { payload: _payload, ...withoutPayload } = validEmailJob;

    expect(issuePaths({ ...validEmailJob, type: 'fax' })).toContainEqual(['type']);
    expect(issuePaths(withoutType)).toContainEqual(['type']);
    expect(issuePaths(withoutPayload)).toContainEqual(['payload']);
    expect(
      issuePaths({ ...validEmailJob, payload: { method: 'POST', url: 'https://example.com/' } }),
    ).toContainEqual(['payload', 'to']);
  });

  it('Invalid email address', () => {
    for (const to of ['not-an-email', '', undefined]) {
      expect(
        issuePaths({ ...validEmailJob, payload: { ...validEmailJob.payload, to } }),
      ).toContainEqual(['payload', 'to']);
    }
  });

  it('accepts an empty email body', () => {
    const job = { ...validEmailJob, payload: { ...validEmailJob.payload, body: '' } };

    expect(CreateJobRequest.parse(job)).toEqual(job);
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

  it('accepts email fields at their maximum length', () => {
    const subject = 'a'.repeat(EMAIL_LIMITS.subjectMaxLength);
    const body = 'a'.repeat(EMAIL_LIMITS.bodyMaxLength);
    const job = { ...validEmailJob, payload: { ...validEmailJob.payload, subject, body } };

    expect(CreateJobRequest.parse(job)).toEqual(job);
  });

  it('Priority out of range', () => {
    for (const priority of [
      JOB_LIMITS.priority.min - 1,
      JOB_LIMITS.priority.max + 1,
      2.5,
      'high',
      null,
    ]) {
      expect(issuePaths({ ...validEmailJob, priority })).toContainEqual(['priority']);
    }
  });

  it('Max attempts out of range', () => {
    for (const maxAttempts of [
      JOB_LIMITS.maxAttempts.min - 1,
      JOB_LIMITS.maxAttempts.max + 1,
      1.5,
      'three',
      null,
    ]) {
      expect(issuePaths({ ...validEmailJob, maxAttempts })).toContainEqual(['maxAttempts']);
    }
  });

  it('accepts priority and max attempts at their limits', () => {
    for (const limit of ['min', 'max'] as const) {
      const job = {
        ...validEmailJob,
        priority: JOB_LIMITS.priority[limit],
        maxAttempts: JOB_LIMITS.maxAttempts[limit],
      };

      expect(CreateJobRequest.parse(job)).toEqual(job);
    }
  });
});

const validWebhookJob = {
  type: 'webhook',
  payload: {
    method: 'POST',
    url: 'https://hooks.example.com/orders',
    body: { orderId: 'ord_4821', event: 'order.paid' },
  },
  priority: 5,
  maxAttempts: 3,
};

describe('CreateJobRequest for a webhook job', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    CreateJobRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];
  const withPayload = (payload: Record<string, unknown>): unknown => ({
    ...validWebhookJob,
    payload: { ...validWebhookJob.payload, ...payload },
  });

  it('Valid webhook job is accepted', () => {
    expect(CreateJobRequest.parse(validWebhookJob)).toEqual(validWebhookJob);
  });

  it('accepts every allowed method', () => {
    for (const method of WEBHOOK_METHODS) {
      expect(CreateJobRequest.safeParse(withPayload({ method })).success).toBe(true);
    }
  });

  it('Webhook job without a body is accepted', () => {
    const job = { ...validWebhookJob, payload: { method: 'GET', url: 'http://example.com/ping' } };

    expect(CreateJobRequest.parse(job)).toEqual(job);
  });

  it('Method not allowed', () => {
    for (const method of ['DELETE', 'post', '']) {
      expect(issuePaths(withPayload({ method }))).toContainEqual(['payload', 'method']);
    }
  });

  it('URL with another scheme', () => {
    expect(issuePaths(withPayload({ url: 'ftp://example.com/hook' }))).toContainEqual([
      'payload',
      'url',
    ]);
  });

  it('URL missing or not a URL', () => {
    const { url: _url, ...withoutUrl } = validWebhookJob.payload;

    expect(issuePaths({ ...validWebhookJob, payload: withoutUrl })).toContainEqual([
      'payload',
      'url',
    ]);
    for (const url of ['not a url', '/orders']) {
      expect(issuePaths(withPayload({ url }))).toContainEqual(['payload', 'url']);
    }
  });

  it('URL too long', () => {
    const prefix = 'https://example.com/';
    const url = prefix + 'a'.repeat(WEBHOOK_LIMITS.urlMaxLength - prefix.length + 1);

    expect(issuePaths(withPayload({ url }))).toContainEqual(['payload', 'url']);
    expect(CreateJobRequest.safeParse(withPayload({ url: url.slice(0, -1) })).success).toBe(true);
  });

  it('Body is not a JSON object', () => {
    for (const body of [['a'], 'text', null]) {
      expect(issuePaths(withPayload({ body }))).toContainEqual(['payload', 'body']);
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
    for (const offset of ['-1', '1.5', 'abc']) {
      const result = QueryJobsRequest.safeParse({ offset });

      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['offset']);
    }
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

  it('rejects a report without a status', () => {
    expect(UpdateJobRequest.safeParse({}).success).toBe(false);
  });

  it('rejects a failure without an error, or with an error without a code', () => {
    expect(UpdateJobRequest.safeParse({ status: 'failed' }).success).toBe(false);
    expect(UpdateJobRequest.safeParse({ status: 'failed', error: { message: 'x' } }).success).toBe(
      false,
    );
  });

  it('rejects a completion without a result', () => {
    expect(UpdateJobRequest.safeParse({ status: 'completed' }).success).toBe(false);
  });
});

describe('EmailJobResult', () => {
  it('accepts a message id', () => {
    expect(EmailJobResult.parse({ messageId: 'm-1' })).toEqual({ messageId: 'm-1' });
  });

  it('Result does not match the job type', () => {
    expect(EmailJobResult.safeParse({ id: 'm-1' }).success).toBe(false);
    expect(EmailJobResult.safeParse({ messageId: '' }).success).toBe(false);
  });
});

describe('WebhookJobResult', () => {
  it('Webhook result is stored', () => {
    for (const statusCode of [200, 299]) {
      const result = { statusCode, responseBody: { received: true } };

      expect(WebhookJobResult.parse(result)).toEqual(result);
    }
  });

  it('Webhook result does not match', () => {
    for (const result of [
      { responseBody: {} },
      { statusCode: 404, responseBody: {} },
      { statusCode: 199, responseBody: {} },
      { statusCode: 300, responseBody: {} },
      { statusCode: 503, responseBody: {} },
      { statusCode: 200, responseBody: ['a'] },
      { statusCode: 200, responseBody: 'ok' },
    ]) {
      expect(WebhookJobResult.safeParse(result).success).toBe(false);
    }
  });
});

describe('Job', () => {
  it('Failed webhook error is returned with its status code', () => {
    const timestamp = new Date().toISOString();
    const job = {
      id: randomUUID(),
      type: 'webhook',
      status: 'failed',
      priority: 5,
      attempts: 3,
      maxAttempts: 3,
      payload: validWebhookJob.payload,
      result: null,
      error: {
        code: 'WEBHOOK_HTTP_ERROR',
        message: 'HTTP 503 Service Unavailable',
        details: { statusCode: 503 },
      },
      scheduledAt: null,
      startedAt: timestamp,
      completedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(Job.parse(job)).toEqual(job);
  });
});
