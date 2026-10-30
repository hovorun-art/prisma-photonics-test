import { randomUUID } from 'node:crypto';

import type { Job } from '@job-queue/contracts';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { jobFixtures } from '../../jobs/testing/job-fixtures';
import { TEST_API_BASE, TestProviders } from '../../jobs/testing/test-providers';
import { useGroupJobs } from './use-group-jobs';

const JOBS_URL = `${TEST_API_BASE}/v1/jobs`;
const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function wrapper({ children }: { children: ReactNode }) {
  return <TestProviders config={{ groupJobsPageSize: 2 }}>{children}</TestProviders>;
}

/** Jobs of one group, newest first as job-service returns them. */
function newestFirst(n: number, groupId: string): Job[] {
  return Array.from({ length: n }, () => jobFixtures.build({ id: randomUUID(), groupId }));
}

interface Call {
  readonly offset: string | null;
  readonly limit: string | null;
  readonly groupId: string | null;
}

/** Answers each call with the page the `pages` function gives for its offset; records the calls. */
function answer(pages: (offset: number) => Job[], total: number): Call[] {
  const calls: Call[] = [];
  server.use(
    http.get(JOBS_URL, ({ request }) => {
      const params = new URL(request.url).searchParams;
      calls.push({
        offset: params.get('offset'),
        limit: params.get('limit'),
        groupId: params.get('groupId'),
      });
      return HttpResponse.json({ items: pages(Number(params.get('offset'))), total });
    }),
  );
  return calls;
}

describe('useGroupJobs', () => {
  it('One cell per job: loads every page of the group, oldest job first', async () => {
    const groupId = randomUUID();
    const jobs = newestFirst(5, groupId);
    const calls = answer((offset) => jobs.slice(offset, offset + 2), jobs.length);

    const { result } = renderHook(() => useGroupJobs(groupId), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
    expect(result.current.data?.map((job) => job.id)).toEqual(jobs.map((job) => job.id).reverse());
    expect(calls).toEqual([
      { offset: '0', limit: '2', groupId },
      { offset: '2', limit: '2', groupId },
      { offset: '4', limit: '2', groupId },
    ]);
  });

  it('a total that fills whole pages stops after the last full page', async () => {
    const groupId = randomUUID();
    const jobs = newestFirst(4, groupId);
    const calls = answer((offset) => jobs.slice(offset, offset + 2), jobs.length);

    const { result } = renderHook(() => useGroupJobs(groupId), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(4);
    });
    expect(calls.map((call) => call.offset)).toEqual(['0', '2']);
  });

  it('a job that shows up on two pages is returned once', async () => {
    const groupId = randomUUID();
    const [j4, j3, j2, j1] = newestFirst(4, groupId);
    // A new job between the two reads shifts the second page: j3 comes again.
    const pages: Record<number, Job[]> = { 0: [j4!, j3!], 2: [j3!, j2!], 4: [j1!] };
    answer((offset) => pages[offset] ?? [], 5);

    const { result } = renderHook(() => useGroupJobs(groupId), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
    expect(result.current.data?.map((job) => job.id)).toEqual([j1!.id, j2!.id, j3!.id, j4!.id]);
  });

  it('a group without jobs loads one empty page', async () => {
    const groupId = randomUUID();
    const calls = answer(() => [], 0);

    const { result } = renderHook(() => useGroupJobs(groupId), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
    expect(calls).toHaveLength(1);
  });

  it('stops at an empty page even when the total promised more jobs', async () => {
    const groupId = randomUUID();
    const jobs = newestFirst(2, groupId);
    const calls = answer((offset) => (offset === 0 ? jobs : []), 9);

    const { result } = renderHook(() => useGroupJobs(groupId), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2);
    });
    expect(calls).toHaveLength(2);
  });
});
