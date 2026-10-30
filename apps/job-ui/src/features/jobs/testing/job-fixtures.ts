import { randomUUID } from 'node:crypto';

import type { EmailJob, WebhookJob } from '@job-queue/contracts';

export type BuildJobFixturesRequest = Partial<EmailJob>;
export type BuildJobFixturesResponse = EmailJob;
export type BuildWebhookJobFixturesRequest = Partial<WebhookJob>;
export type BuildWebhookJobFixturesResponse = WebhookJob;

/** Builds valid jobs for tests; each test overrides only the fields its scenario is about. */
export interface JobFixtures {
  build(req?: BuildJobFixturesRequest): BuildJobFixturesResponse;
}

/** Builds valid webhook jobs for tests, like `JobFixtures` for email. */
export interface WebhookJobFixtures {
  build(req?: BuildWebhookJobFixturesRequest): BuildWebhookJobFixturesResponse;
}

/** The fields every pending job has, whatever its type, as job-service returns them. */
const PENDING_JOB = {
  status: 'pending',
  priority: 5,
  attempts: 0,
  maxAttempts: 3,
  result: null,
  error: null,
  groupId: null,
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-29T21:02:09.000Z',
  updatedAt: '2026-10-29T21:02:09.000Z',
} as const;

/** Test-only: a pending email job with fixed ids and times, as job-service returns it. */
export class EmailJobFixtures implements JobFixtures {
  build(req: BuildJobFixturesRequest = {}): BuildJobFixturesResponse {
    return {
      id: '7f3a9c21-4b5d-4e6f-8a7b-9c0d1e2f3a4b',
      ...PENDING_JOB,
      type: 'email',
      payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
      ...req,
    };
  }
}

export const jobFixtures: JobFixtures = new EmailJobFixtures();

/** Test-only: a pending webhook job with a fresh id, as job-service returns it. */
export class PendingWebhookJobFixtures implements WebhookJobFixtures {
  build(req: BuildWebhookJobFixturesRequest = {}): BuildWebhookJobFixturesResponse {
    return {
      id: randomUUID(),
      ...PENDING_JOB,
      type: 'webhook',
      payload: {
        method: 'POST',
        url: 'https://hooks.example.com/orders',
        body: { orderId: 'ord_4821', event: 'order.paid' },
      },
      ...req,
    };
  }
}

export const webhookJobFixtures: WebhookJobFixtures = new PendingWebhookJobFixtures();
