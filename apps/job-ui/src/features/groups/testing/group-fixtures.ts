import { randomUUID } from 'node:crypto';

import type { JobGroup } from '@job-queue/contracts';

export type BuildGroupFixturesRequest = Partial<JobGroup>;
export type BuildGroupFixturesResponse = JobGroup;

/** Builds valid job groups for tests; each test overrides only the fields its scenario is about. */
export interface GroupFixtures {
  build(req?: BuildGroupFixturesRequest): BuildGroupFixturesResponse;
}

/** A running group of 3 jobs, 1 completed and 1 failed, checked once and not finished. */
export class RunningGroupFixtures implements GroupFixtures {
  build(req: BuildGroupFixturesRequest = {}): BuildGroupFixturesResponse {
    return {
      id: randomUUID(),
      status: 'running',
      total: 3,
      completed: 1,
      failed: 1,
      createdAt: '2026-10-29T21:10:31.000Z',
      updatedAt: '2026-10-29T21:10:40.000Z',
      checkedAt: '2026-10-29T21:10:40.000Z',
      finishedAt: null,
      ...req,
    };
  }
}

export const groupFixtures: GroupFixtures = new RunningGroupFixtures();
