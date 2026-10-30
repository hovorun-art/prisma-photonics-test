import { describe, expect, it } from 'vitest';

import { groupFixtures } from '../testing/group-fixtures';
import { GroupProgressImpl } from './group-progress.impl';

const progress = new GroupProgressImpl();

describe('GroupProgressImpl', () => {
  it('Progress of a running group: 3 jobs, 1 completed and 1 failed', () => {
    const group = groupFixtures.build({ total: 3, completed: 1, failed: 1 });

    expect(progress.summary({ group })).toEqual({ finished: 2, percent: 66, remaining: 1 });
  });

  it('Group without jobs: 0%', () => {
    const group = groupFixtures.build({ total: 0, completed: 0, failed: 0 });

    expect(progress.summary({ group })).toEqual({ finished: 0, percent: 0, remaining: 0 });
  });

  it('a group whose jobs all finished is at 100%', () => {
    const group = groupFixtures.build({ status: 'failed', total: 7, completed: 5, failed: 2 });

    expect(progress.summary({ group })).toEqual({ finished: 7, percent: 100, remaining: 0 });
  });

  it.each([
    { status: 'completed', kind: 'completed' },
    { status: 'failed', kind: 'failed' },
    { status: 'cancelled', kind: 'failed' },
    { status: 'scheduled', kind: 'remaining' },
    { status: 'pending', kind: 'remaining' },
    { status: 'processing', kind: 'remaining' },
  ] as const)('Cell colours: a $status job is $kind', ({ status, kind }) => {
    expect(progress.cell({ status })).toEqual({ kind });
  });
});
