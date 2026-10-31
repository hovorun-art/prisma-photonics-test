import { createHash, randomUUID } from 'node:crypto';

import type { CreateJobRequest } from '@job-queue/contracts';
import { describe, expect, it } from 'vitest';

import { Sha256JobRequestFingerprint } from './sha256-job-request-fingerprint.js';

const email: CreateJobRequest = {
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
  priority: 5,
  maxAttempts: 3,
};

describe('Sha256JobRequestFingerprint', () => {
  const fingerprints = new Sha256JobRequestFingerprint();
  const of = (job: CreateJobRequest): string => fingerprints.of({ job }).fingerprint;

  it('is the SHA-256 (hex) of the canonical request, pinned for one sample', () => {
    const canonical =
      '{"groupId":null,"maxAttempts":3,"payload":{"body":"Hi","subject":"Hello","to":"ada@example.com"},' +
      '"priority":5,"scheduledAt":null,"type":"email"}';

    expect(of(email)).toBe(createHash('sha256').update(canonical).digest('hex'));
    expect(of(email)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('payload keys in another order give the same fingerprint', () => {
    const reordered: CreateJobRequest = {
      ...email,
      payload: { body: 'Hi', to: 'ada@example.com', subject: 'Hello' },
    };

    expect(of(reordered)).toBe(of(email));
  });

  it('an absent group and schedule give the same fingerprint as an undefined one', () => {
    const spelledOut = { ...email, groupId: undefined, scheduledAt: undefined };

    expect(of(spelledOut)).toBe(of(email));
  });

  it('Replay of a scheduled job in another time zone notation: the same instant is equal', () => {
    const utc: CreateJobRequest = { ...email, scheduledAt: '2026-11-01T10:00:00.000Z' };
    const offset: CreateJobRequest = { ...email, scheduledAt: '2026-11-01T12:00:00+02:00' };

    expect(of(offset)).toBe(of(utc));
  });

  it('the idempotency key itself does not change it', () => {
    expect(of({ ...email, idempotencyKey: 'key-1' })).toBe(of({ ...email, idempotencyKey: 'k-2' }));
    expect(of({ ...email, idempotencyKey: 'key-1' })).toBe(of(email));
  });

  it.each([
    ['payload', { ...email, payload: { ...email.payload, subject: 'Other' } }],
    ['priority', { ...email, priority: 6 }],
    ['max attempts', { ...email, maxAttempts: 4 }],
    ['group', { ...email, groupId: randomUUID() }],
    ['scheduled time', { ...email, scheduledAt: '2026-11-01T10:00:00.000Z' }],
    [
      'type',
      {
        type: 'webhook',
        payload: { method: 'GET', url: 'http://example.com/a' },
        priority: 5,
        maxAttempts: 3,
      },
    ],
  ] satisfies [string, CreateJobRequest][])('another %s changes it', (_what, other) => {
    expect(of(other)).not.toBe(of(email));
  });
});
