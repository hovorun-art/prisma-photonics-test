import { randomUUID } from 'node:crypto';

import type { Job } from '@job-queue/contracts';

/** Builds the jobs the e2e tests' mocked job-service returns. */
export interface E2eJobs {
  /** A pending email job with a new id; the fields given replace its own. */
  build(req: Partial<Job>): Job;
}

/** `E2eJobs` over one pending email job, shared by the e2e spec files. */
export class PendingEmailE2eJobs implements E2eJobs {
  build(req: Partial<Job>): Job {
    // A partial of any job type over an email job: the caller keeps type and payload in step.
    return {
      id: randomUUID(),
      type: 'email',
      status: 'pending',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
      result: null,
      error: null,
      groupId: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-10-29T21:02:09.000Z',
      updatedAt: '2026-10-29T21:02:09.000Z',
      ...req,
    } as Job;
  }
}
