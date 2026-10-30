import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  JobGroup,
  JobGroupIdParams,
  QueryJobGroupsRequest,
  QueryJobGroupsResponse,
} from './job-group.js';

const runningGroup = {
  id: randomUUID(),
  status: 'running',
  total: 0,
  completed: 0,
  failed: 0,
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
  checkedAt: null,
  finishedAt: null,
};

describe('JobGroup', () => {
  it('accepts a new running group with no checks and no finish time', () => {
    expect(JobGroup.parse(runningGroup)).toEqual(runningGroup);
  });

  it('accepts a finished group with its counts and times', () => {
    const finished = {
      ...runningGroup,
      status: 'failed',
      total: 3,
      completed: 2,
      failed: 1,
      checkedAt: '2026-10-30T10:01:00.000Z',
      finishedAt: '2026-10-30T10:01:00.000Z',
    };

    expect(JobGroup.parse(finished)).toEqual(finished);
  });

  it('accepts a completed group', () => {
    const completed = {
      ...runningGroup,
      status: 'completed',
      total: 2,
      completed: 2,
      checkedAt: '2026-10-30T10:01:00.000Z',
      finishedAt: '2026-10-30T10:01:00.000Z',
    };

    expect(JobGroup.parse(completed)).toEqual(completed);
  });

  it.each([
    ['an unknown status', { status: 'cancelled' }, ['status']],
    ['a negative count', { failed: -1 }, ['failed']],
    ['a fractional count', { total: 1.5 }, ['total']],
    ['a count given as a string', { total: '3' }, ['total']],
    ['a malformed id', { id: 'group-1' }, ['id']],
    ['a timestamp that is not ISO', { createdAt: 'yesterday' }, ['createdAt']],
    ['a timestamp with an offset', { checkedAt: '2026-10-30T10:00:00+02:00' }, ['checkedAt']],
    ['a null creation time', { createdAt: null }, ['createdAt']],
    ['a null update time', { updatedAt: null }, ['updatedAt']],
  ])('rejects %s at its field', (_name, change, path) => {
    const result = JobGroup.safeParse({ ...runningGroup, ...change });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([path]);
  });

  it('rejects a group with a missing count', () => {
    const { completed: _completed, ...withoutCompleted } = runningGroup;

    expect(JobGroup.safeParse(withoutCompleted).error?.issues[0]?.path).toEqual(['completed']);
  });
});

describe('JobGroupIdParams', () => {
  it('accepts a UUID and rejects anything else', () => {
    const id = randomUUID();

    expect(JobGroupIdParams.parse({ id })).toEqual({ id });
    expect(JobGroupIdParams.safeParse({ id: 'not-a-uuid' }).error?.issues[0]?.path).toEqual(['id']);
  });
});

describe('QueryJobGroupsRequest', () => {
  it('coerces limit and offset from query strings', () => {
    expect(QueryJobGroupsRequest.parse({ limit: '5', offset: '10' })).toEqual({
      limit: 5,
      offset: 10,
    });
  });

  it('accepts the smallest limit and offset', () => {
    expect(QueryJobGroupsRequest.parse({ limit: '1', offset: '0' })).toEqual({
      limit: 1,
      offset: 0,
    });
  });

  it('leaves limit unset and defaults offset to 0', () => {
    expect(QueryJobGroupsRequest.parse({})).toEqual({ offset: 0 });
  });

  it('rejects limit 0, a negative offset and non-numbers, naming the field', () => {
    const paths = (input: unknown): PropertyKey[][] =>
      QueryJobGroupsRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

    expect(paths({ limit: '0' })).toEqual([['limit']]);
    expect(paths({ offset: '-1' })).toEqual([['offset']]);
    expect(paths({ limit: 'many' })).toEqual([['limit']]);
    expect(paths({ offset: 'x' })).toEqual([['offset']]);
  });

  it('rejects fractional values, naming the field', () => {
    const paths = (input: unknown): PropertyKey[][] =>
      QueryJobGroupsRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

    expect(paths({ limit: '1.5' })).toEqual([['limit']]);
    expect(paths({ offset: '0.5' })).toEqual([['offset']]);
  });
});

describe('QueryJobGroupsResponse', () => {
  it('accepts a page of groups with the number of all groups', () => {
    const page = { items: [runningGroup], total: 1 };

    expect(QueryJobGroupsResponse.parse(page)).toEqual(page);
  });

  it('rejects a negative total and an invalid item, naming the field', () => {
    const paths = (input: unknown): PropertyKey[][] =>
      QueryJobGroupsResponse.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

    expect(paths({ items: [], total: -1 })).toEqual([['total']]);
    expect(paths({ items: [{ ...runningGroup, status: 'done' }], total: 1 })).toEqual([
      ['items', 0, 'status'],
    ]);
  });
});
