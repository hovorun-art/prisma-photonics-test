import { randomUUID } from 'node:crypto';

import type { JobLogEntry, JobLogLevel } from '@job-queue/contracts';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { jobLogEntryFixtures } from '../testing/job-fixtures';
import { TEST_API_BASE, TestProviders } from '../testing/test-providers';
import { useJobLog } from './use-job-log';

const server = setupServer();
const jobId = randomUUID();
const LOGS_URL = `${TEST_API_BASE}/v1/jobs/${jobId}/logs`;
/** Waits for a poll; generous, since the whole repo's tests share the machine. */
const POLL_WAIT = { timeout: 5000 };

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function entry(message: string, level: JobLogLevel = 'info'): JobLogEntry {
  return jobLogEntryFixtures.build({ jobId, message, level });
}

function wrapperWith(pollIntervalMs: number) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TestProviders config={{ pollIntervalMs }}>{children}</TestProviders>;
  };
}

function messages(items: readonly JobLogEntry[]) {
  return items.map((item) => item.message);
}

const unavailable = () =>
  HttpResponse.json(
    { code: 'LOG_STORE_UNAVAILABLE', message: 'down', details: {} },
    { status: 503 },
  );

describe('useJobLog', () => {
  it('loads the first page without a cursor and then polls with the last cursor and appends', async () => {
    const afters: (string | null)[] = [];
    const pages = [
      { items: [entry('one')], nextCursor: 'c1' },
      { items: [entry('two')], nextCursor: 'c2' },
    ];
    let call = 0;
    server.use(
      http.get(LOGS_URL, ({ request }) => {
        afters.push(new URL(request.url).searchParams.get('after'));
        const page = pages[call++] ?? { items: [], nextCursor: 'c2' };
        return HttpResponse.json(page);
      }),
    );

    const { result } = renderHook(() => useJobLog({ id: jobId }), { wrapper: wrapperWith(30) });

    await waitFor(() => {
      expect(messages(result.current.entries)).toEqual(['one', 'two']);
    }, POLL_WAIT);
    expect(afters.slice(0, 2)).toEqual([null, 'c1']);
  });

  it('follows a non-empty page until an empty one without waiting for the next poll', async () => {
    const afters: (string | null)[] = [];
    server.use(
      http.get(LOGS_URL, ({ request }) => {
        const after = new URL(request.url).searchParams.get('after');
        afters.push(after);
        if (after === null) return HttpResponse.json({ items: [entry('a')], nextCursor: 'c1' });
        if (after === 'c1') return HttpResponse.json({ items: [entry('b')], nextCursor: 'c2' });
        return HttpResponse.json({ items: [], nextCursor: after });
      }),
    );

    const { result } = renderHook(() => useJobLog({ id: jobId }), {
      wrapper: wrapperWith(60_000),
    });

    await waitFor(() => {
      expect(messages(result.current.entries)).toEqual(['a', 'b']);
    }, POLL_WAIT);
    expect(afters).toEqual([null, 'c1', 'c2']);
  });

  it('never sends a limit', async () => {
    let search = '?unset';
    server.use(
      http.get(LOGS_URL, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );

    renderHook(() => useJobLog({ id: jobId }), { wrapper: wrapperWith(60_000) });

    await waitFor(() => {
      expect(search).toBe('');
    }, POLL_WAIT);
  });

  it('recovers when a later poll succeeds after the first load failed', async () => {
    let call = 0;
    server.use(
      http.get(LOGS_URL, () => {
        call += 1;
        if (call === 1) return unavailable();
        return HttpResponse.json(
          call === 2
            ? { items: [entry('back')], nextCursor: 'c1' }
            : { items: [], nextCursor: 'c1' },
        );
      }),
    );

    const { result } = renderHook(() => useJobLog({ id: jobId }), { wrapper: wrapperWith(30) });

    await waitFor(() => {
      expect(messages(result.current.entries)).toEqual(['back']);
    }, POLL_WAIT);
    expect(result.current.unavailable).toBe(false);
  });

  it('sends the chosen level and resets entries and cursor when it changes', async () => {
    const seen: { levels: string[]; after: string | null }[] = [];
    server.use(
      http.get(LOGS_URL, ({ request }) => {
        const params = new URL(request.url).searchParams;
        const levels = params.getAll('level');
        seen.push({ levels, after: params.get('after') });
        if (params.get('after') !== null) return HttpResponse.json({ items: [], nextCursor: 'x' });
        return HttpResponse.json(
          levels.includes('error')
            ? { items: [entry('bad', 'error')], nextCursor: 'e1' }
            : { items: [entry('fine')], nextCursor: 'c1' },
        );
      }),
    );

    const { result, rerender } = renderHook(
      ({ level }: { level?: JobLogLevel }) => useJobLog({ id: jobId, level }),
      { wrapper: wrapperWith(60_000), initialProps: {} },
    );
    await waitFor(() => {
      expect(messages(result.current.entries)).toEqual(['fine']);
    }, POLL_WAIT);

    rerender({ level: 'error' });

    await waitFor(() => {
      expect(messages(result.current.entries)).toEqual(['bad']);
    }, POLL_WAIT);
    expect(seen.find((request) => request.levels.includes('error'))).toEqual({
      levels: ['error'],
      after: null,
    });
  });

  it('keeps the entries when a later poll fails', async () => {
    let call = 0;
    server.use(
      http.get(LOGS_URL, () => {
        call += 1;
        if (call === 1) return HttpResponse.json({ items: [entry('one')], nextCursor: 'c1' });
        return call === 2 ? HttpResponse.json({ items: [], nextCursor: 'c1' }) : unavailable();
      }),
    );

    const { result } = renderHook(() => useJobLog({ id: jobId }), { wrapper: wrapperWith(30) });

    await waitFor(() => {
      expect(call).toBeGreaterThan(2);
    }, POLL_WAIT);
    expect(result.current.unavailable).toBe(false);
    expect(messages(result.current.entries)).toEqual(['one']);
  });
});
