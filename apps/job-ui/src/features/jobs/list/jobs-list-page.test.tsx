import type { Job, QueryJobsResponse } from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { jobFixtures, webhookJobFixtures } from '../testing/job-fixtures';
import { CurrentPath, TEST_API_BASE, TestProviders } from '../testing/test-providers';
import { JobsListPage } from './jobs-list-page';

const JOBS_URL = `${TEST_API_BASE}/v1/jobs`;
/** Waits for a poll; generous, since the whole repo's tests share the machine. */
const POLL_WAIT = { timeout: 5000 };
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

function jobNumber(n: number): Job {
  const id = `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
  return jobFixtures.build({
    id,
    payload: { to: `user${n}@acme.test`, subject: `S${n}`, body: '' },
  });
}

/** Answers the jobs query with one page per call, in order; the last page repeats. */
function answerPages(...pages: (QueryJobsResponse | 'network-error')[]) {
  let call = 0;
  server.use(
    http.get(JOBS_URL, () => {
      const page = pages[Math.min(call++, pages.length - 1)]!;
      return page === 'network-error' ? HttpResponse.error() : HttpResponse.json(page);
    }),
  );
}

function renderList(pollIntervalMs?: number) {
  return render(
    <TestProviders path="/jobs" config={pollIntervalMs ? { pollIntervalMs } : {}}>
      <Routes>
        <Route path="/jobs" element={<JobsListPage />} />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </TestProviders>,
  );
}

describe('JobsListPage', () => {
  it('Jobs in the table: one row per job with its fields, in the order of the API', async () => {
    const first = jobFixtures.build({
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      status: 'completed',
      attempts: 1,
      priority: 8,
      result: { messageId: 'msg_42' },
    });
    const second = jobFixtures.build({ id: 'bbbbbbbb-2222-4222-8222-222222222222' });
    answerPages({ items: [first, second], total: 2 });

    renderList();

    await screen.findByRole('link', { name: 'aaaaaaaa' });
    const rows = screen.getAllByRole('row');
    const [, firstRow, secondRow] = rows;
    expect(within(firstRow!).getByRole('link', { name: 'aaaaaaaa' })).toBeVisible();
    expect(firstRow).toHaveTextContent('email');
    expect(firstRow).toHaveTextContent(en.statuses.completed);
    expect(firstRow).toHaveTextContent('8');
    expect(firstRow).toHaveTextContent('1/3');
    expect(firstRow).toHaveTextContent('msg_42');
    expect(firstRow).toHaveTextContent('21:02:09');
    expect(within(secondRow!).getByRole('link', { name: 'bbbbbbbb' })).toBeVisible();
    expect(secondRow).toHaveTextContent('to ops@acme.test · “Weekly digest”');
  });

  it('Open a job from the list: clicking the short id opens the job page', async () => {
    const user = userEvent.setup();
    const job = jobFixtures.build();
    answerPages({ items: [job], total: 1 });
    renderList();

    await user.click(await screen.findByRole('link', { name: job.id.slice(0, 8) }));

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent(
      `/jobs/${job.id}`,
    );
  });

  it('Loading: skeleton rows are shown while the first page loads', () => {
    server.use(http.get(JOBS_URL, () => new Promise<never>(() => undefined)));

    renderList();

    expect(screen.getByLabelText(en.list.loading)).toHaveAttribute('aria-busy', 'true');
  });

  it('No jobs: shows "No jobs yet" and a New job button to the submit page', async () => {
    const user = userEvent.setup();
    answerPages({ items: [], total: 0 });
    renderList();

    expect(await screen.findByText(en.list.emptyTitle)).toBeVisible();
    await user.click(screen.getByRole('link', { name: en.frame.newJob }));

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent('/jobs/new');
  });

  it('First page: shows its range and the total, Previous disabled and Next enabled', async () => {
    const page = Array.from({ length: 20 }, (_, i) => jobNumber(i + 1));
    answerPages({ items: page, total: 25 });

    renderList();

    expect(await screen.findByText(en.list.showing(1, 20, 25))).toBeVisible();
    expect(screen.getByRole('button', { name: en.list.previous })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.list.next })).toBeEnabled();
  });

  it('Next page: shows the next jobs and enables Previous', async () => {
    const user = userEvent.setup();
    const offsets: (string | null)[] = [];
    server.use(
      http.get(JOBS_URL, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        offsets.push(offset);
        const items =
          offset === '20'
            ? Array.from({ length: 5 }, (_, i) => jobNumber(i + 21))
            : Array.from({ length: 20 }, (_, i) => jobNumber(i + 1));
        return HttpResponse.json({ items, total: 25 });
      }),
    );
    renderList();
    await screen.findByText(en.list.showing(1, 20, 25));

    await user.click(screen.getByRole('button', { name: en.list.next }));

    expect(await screen.findByText(en.list.showing(21, 25, 25))).toBeVisible();
    expect(screen.getByRole('link', { name: jobNumber(21).id.slice(0, 8) })).toBeVisible();
    expect(screen.getByRole('button', { name: en.list.previous })).toBeEnabled();
    expect(offsets).toContain('20');
  });

  it('Previous from a shorter last page returns to the page before it', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(JOBS_URL, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        const items =
          offset === '20'
            ? Array.from({ length: 5 }, (_, i) => jobNumber(i + 21))
            : Array.from({ length: 20 }, (_, i) => jobNumber(i + 1));
        return HttpResponse.json({ items, total: 25 });
      }),
    );
    renderList();
    await screen.findByText(en.list.showing(1, 20, 25));
    await user.click(screen.getByRole('button', { name: en.list.next }));
    await screen.findByText(en.list.showing(21, 25, 25));

    await user.click(screen.getByRole('button', { name: en.list.previous }));

    expect(await screen.findByText(en.list.showing(1, 20, 25))).toBeVisible();
    expect(screen.getByRole('button', { name: en.list.previous })).toBeDisabled();
  });

  it('Last page: Next is disabled on the page that holds the oldest job', async () => {
    answerPages({ items: [jobNumber(1), jobNumber(2)], total: 2 });

    renderList();

    expect(await screen.findByText(en.list.showing(1, 2, 2))).toBeVisible();
    expect(screen.getByRole('button', { name: en.list.next })).toBeDisabled();
  });

  it('Status change appears in the list: the next poll shows the new status', async () => {
    const pending = jobFixtures.build({ status: 'pending' });
    const processing = jobFixtures.build({ status: 'processing' });
    answerPages({ items: [pending], total: 1 });
    renderList(20);
    expect(await screen.findByText(en.statuses.pending)).toBeVisible();

    // The next answer is served only now, so the first state cannot be skipped by a fast poll.
    answerPages({ items: [processing], total: 1 });

    expect(await screen.findByText(en.statuses.processing, {}, POLL_WAIT)).toBeVisible();
  });

  it('API unreachable while polling: the jobs stay and "Connection lost, retrying" shows', async () => {
    const job = jobFixtures.build();
    answerPages({ items: [job], total: 1 });
    renderList(20);
    await screen.findByRole('link', { name: job.id.slice(0, 8) });

    answerPages('network-error');

    expect(await screen.findByText(en.list.connectionLost, {}, POLL_WAIT)).toBeVisible();
    expect(screen.getByRole('link', { name: job.id.slice(0, 8) })).toBeVisible();
  });

  it('API back again: the "Connection lost" note goes away after a successful poll', async () => {
    const job = jobFixtures.build();
    answerPages({ items: [job], total: 1 });
    renderList(20);
    await screen.findByRole('link', { name: job.id.slice(0, 8) });
    answerPages('network-error');
    await screen.findByText(en.list.connectionLost, {}, POLL_WAIT);

    answerPages({ items: [job], total: 1 });

    await expect.poll(() => screen.queryByText(en.list.connectionLost), POLL_WAIT).toBeNull();
  });

  it('Statistics without data: every queue statistics card shows "—"', async () => {
    answerPages({ items: [], total: 0 });

    renderList();

    const stats = await screen.findByRole('region', { name: en.list.statsLabel });
    expect(within(stats).getAllByText(en.list.noValue)).toHaveLength(6);
  });

  it('Disabled filter: status and type filters and the search are disabled', async () => {
    answerPages({ items: [], total: 0 });

    renderList();

    const statusFilters = await screen.findByRole('group', { name: en.list.filterByStatus });
    for (const button of within(statusFilters).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    const typeFilters = screen.getByRole('group', { name: en.list.filterByType });
    for (const button of within(typeFilters).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole('searchbox', { name: en.list.searchLabel })).toBeDisabled();
  });

  it('Cancel and Retry are shown disabled where the design shows them', async () => {
    answerPages({
      items: [
        jobFixtures.build({ id: 'aaaaaaaa-1111-4111-8111-111111111111', status: 'pending' }),
        jobFixtures.build({
          id: 'bbbbbbbb-2222-4222-8222-222222222222',
          status: 'failed',
          error: { code: 'X', message: 'boom' },
        }),
        jobFixtures.build({
          id: 'cccccccc-3333-4333-8333-333333333333',
          status: 'completed',
          result: { messageId: 'm' },
        }),
      ],
      total: 3,
    });

    renderList();

    await screen.findByRole('link', { name: 'aaaaaaaa' });
    const [, pendingRow, failedRow, completedRow] = screen.getAllByRole('row');
    expect(within(pendingRow!).getByRole('button', { name: en.list.cancel })).toBeDisabled();
    expect(within(failedRow!).getByRole('button', { name: en.list.retry })).toBeDisabled();
    expect(within(completedRow!).getByLabelText(en.list.noActions)).toBeVisible();
  });

  it.each(['scheduled', 'pending', 'processing'] as const)(
    'Waiting or running webhook job: a %s job\'s Details read "<METHOD> <url>"',
    async (status) => {
      const job = webhookJobFixtures.build({ status });
      answerPages({ items: [job], total: 1 });

      renderList();

      await screen.findByRole('link', { name: job.id.slice(0, 8) });
      const [, row] = screen.getAllByRole('row');
      expect(row).toHaveTextContent('webhook');
      expect(row).toHaveTextContent('POST https://hooks.example.com/orders');
    },
  );

  it('Completed webhook job: Details read "HTTP <status code>"', async () => {
    const job = webhookJobFixtures.build({
      status: 'completed',
      attempts: 1,
      result: { statusCode: 200, responseBody: { received: true } },
    });
    answerPages({ items: [job], total: 1 });

    renderList();

    await screen.findByRole('link', { name: job.id.slice(0, 8) });
    const [, row] = screen.getAllByRole('row');
    expect(row).toHaveTextContent('HTTP 200');
  });

  it('Failed webhook job: Details show the error message', async () => {
    const job = webhookJobFixtures.build({
      status: 'failed',
      attempts: 3,
      error: {
        code: 'WEBHOOK_HTTP_ERROR',
        message: 'Webhook POST https://hooks.example.com/orders answered 503',
        details: { statusCode: 503 },
      },
    });
    answerPages({ items: [job], total: 1 });

    renderList();

    await screen.findByRole('link', { name: job.id.slice(0, 8) });
    const [, row] = screen.getAllByRole('row');
    expect(row).toHaveTextContent('Webhook POST https://hooks.example.com/orders answered 503');
  });
});
