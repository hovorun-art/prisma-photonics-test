import { randomUUID } from 'node:crypto';

import type { EmailJob, QueueStats, WebhookJob } from '@job-queue/contracts';

export type BuildJobFixturesRequest = Partial<EmailJob>;
export type BuildJobFixturesResponse = EmailJob;
export type BuildWebhookJobFixturesRequest = Partial<WebhookJob>;
export type BuildWebhookJobFixturesResponse = WebhookJob;
export type BuildQueueStatsFixturesRequest = Partial<QueueStats>;
export type BuildQueueStatsFixturesResponse = QueueStats;

/** Builds valid jobs for tests; each test overrides only the fields its scenario is about. */
export interface JobFixtures {
  build(req?: BuildJobFixturesRequest): BuildJobFixturesResponse;
}

/** Builds valid webhook jobs for tests, like `JobFixtures` for email. */
export interface WebhookJobFixtures {
  build(req?: BuildWebhookJobFixturesRequest): BuildWebhookJobFixturesResponse;
}

/** Builds valid queue statistics for tests, with a different value in every field. */
export interface QueueStatsFixtures {
  build(req?: BuildQueueStatsFixturesRequest): BuildQueueStatsFixturesResponse;
}

/** The fields every pending job has, whatever its type, as job-service returns them. */
const PENDING_JOB = {
  status: 'pending',
  priority: 5,
  attempts: 0,
  maxAttempts: 3,
  result: null,
  error: null,
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

/** Test-only: statistics as job-service returns them, every value distinct so the cards can be told apart. */
export class DistinctQueueStatsFixtures implements QueueStatsFixtures {
  build(req: BuildQueueStatsFixturesRequest = {}): BuildQueueStatsFixturesResponse {
    return {
      pending: 12,
      processing: 3,
      scheduled: 7,
      recent: { windowMinutes: 1440, completed: 1234, failed: 5 },
      throughput: { windowMinutes: 5, perMinute: 2.4 },
      ...req,
    };
  }
}

export const queueStatsFixtures: QueueStatsFixtures = new DistinctQueueStatsFixtures();
