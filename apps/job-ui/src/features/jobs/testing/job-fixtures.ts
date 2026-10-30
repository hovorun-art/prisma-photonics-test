import type { EmailJob } from '@job-queue/contracts';

export type BuildJobFixturesRequest = Partial<EmailJob>;
export type BuildJobFixturesResponse = EmailJob;

/** Builds valid jobs for tests; each test overrides only the fields its scenario is about. */
export interface JobFixtures {
  build(req?: BuildJobFixturesRequest): BuildJobFixturesResponse;
}

/** Test-only: a pending email job with fixed ids and times, as job-service returns it. */
export class EmailJobFixtures implements JobFixtures {
  build(req: BuildJobFixturesRequest = {}): BuildJobFixturesResponse {
    return {
      id: '7f3a9c21-4b5d-4e6f-8a7b-9c0d1e2f3a4b',
      type: 'email',
      status: 'pending',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
      result: null,
      error: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-10-29T21:02:09.000Z',
      updatedAt: '2026-10-29T21:02:09.000Z',
      ...req,
    };
  }
}

export const jobFixtures: JobFixtures = new EmailJobFixtures();
