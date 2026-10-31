import { randomUUID } from 'node:crypto';

import {
  type Job,
  JobStatus,
  JobType,
  type QueryJobsResponse,
  type QueueStats,
} from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import {
  jobFixtures,
  queueStatsFixtures,
  transitJobFixtures,
  webhookJobFixtures,
} from '../testing/job-fixtures';
import { CurrentPath, TEST_API_BASE, TestProviders } from '../testing/test-providers';
import { JobsListPage } from './jobs-list-page';

const JOBS_URL = `${TEST_API_BASE}/v1/jobs`;
const STATS_URL = `${TEST_API_BASE}/v1/stats`;
/** Waits for a poll; generous, since the whole repo's tests share the machine. */
const POLL_WAIT = { timeout: 5000 };
/** The statistics cards poll too; unless a test says otherwise, job-service reports statistics. */
const server = setupServer(
  http.get(STATS_URL, () => HttpResponse.json(queueStatsFixtures.build())),
);

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

function renderList(pollIntervalMs?: number, path = '/jobs') {
  return render(
    <TestProviders path={path} config={pollIntervalMs ? { pollIntervalMs } : {}}>
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

  it('Scheduled job in the list: the Status cell shows the badge and the local run time under it', async () => {
    const job = jobFixtures.build({ status: 'scheduled', scheduledAt: '2026-10-30T08:00:00.000Z' });
    answerPages({ items: [job], total: 1 });

    renderList();

    await screen.findByRole('link', { name: job.id.slice(0, 8) });
    const [, row] = screen.getAllByRole('row');
    const status = within(row!).getAllByRole('cell')[2];
    expect(status).toHaveTextContent(en.statuses.scheduled);
    expect(status).toHaveTextContent('30 Oct, 08:00:00');
  });

  it('Started scheduled job in the list: the Status cell shows only the badge', async () => {
    const job = jobFixtures.build({
      status: 'processing',
      scheduledAt: '2026-10-30T08:00:00.000Z',
      startedAt: '2026-10-30T08:00:01.000Z',
    });
    answerPages({ items: [job], total: 1 });

    renderList();

    await screen.findByRole('link', { name: job.id.slice(0, 8) });
    const [, row] = screen.getAllByRole('row');
    expect(within(row!).getAllByRole('cell')[2]).toHaveTextContent(/^processing$/);
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

  it('Statistics shown: the list page shows the queue statistics cards', async () => {
    answerPages({ items: [], total: 0 });

    renderList();

    const stats = await screen.findByRole('region', { name: en.list.statsLabel });
    expect(await within(stats).findByText('1,234')).toBeVisible();
  });

  it('First statistics request fails: the cards show "—" and the jobs table still shows jobs', async () => {
    const job = jobFixtures.build();
    answerPages({ items: [job], total: 1 });
    server.use(http.get(STATS_URL, () => HttpResponse.error()));

    renderList();

    expect(await screen.findByRole('link', { name: job.id.slice(0, 8) })).toBeVisible();
    const stats = screen.getByRole('region', { name: en.list.statsLabel });
    await expect
      .poll(() => within(stats).queryAllByText(en.list.noValue).length, POLL_WAIT)
      .toBe(6);
    expect(screen.queryByText(en.pageError.title)).toBeNull();
  });

  it('Statistics poll fails after values were shown: the jobs table still shows jobs', async () => {
    const job = jobFixtures.build();
    answerPages({ items: [job], total: 1 });
    let statsCall = 0;
    server.use(
      http.get(STATS_URL, () =>
        statsCall++ === 0 ? HttpResponse.json(queueStatsFixtures.build()) : HttpResponse.error(),
      ),
    );
    renderList(20);
    const stats = await screen.findByRole('region', { name: en.list.statsLabel });
    await within(stats).findByText('1,234');

    await expect.poll(() => statsCall, POLL_WAIT).toBeGreaterThan(2);

    expect(within(stats).getByText('1,234')).toBeVisible();
    expect(screen.getByRole('link', { name: job.id.slice(0, 8) })).toBeVisible();
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

  it('Waiting or running transit job: a pending job\'s Details read "LHR → JFK · 28 Oct"', async () => {
    const job = transitJobFixtures.build();
    answerPages({ items: [job], total: 1 });

    renderList();

    await screen.findByRole('link', { name: job.id.slice(0, 8) });
    const [, row] = screen.getAllByRole('row');
    expect(row).toHaveTextContent('flight-transit');
    expect(row).toHaveTextContent('LHR → JFK · 28 Oct');
  });

  describe('filters', () => {
    const PAGE_SIZE = 20;
    const ERROR = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };

    /** A stored job in the given status and type, with the result or error that status needs. */
    function stored(
      status: 'pending' | 'completed' | 'failed',
      type: 'email' | 'webhook' = 'email',
    ): Job {
      if (type === 'webhook') {
        return webhookJobFixtures.build({
          id: randomUUID(),
          status,
          ...(status === 'failed' ? { attempts: 3, error: ERROR } : {}),
          ...(status === 'completed'
            ? { attempts: 1, result: { statusCode: 200, responseBody: { received: true } } }
            : {}),
        });
      }
      return jobFixtures.build({
        id: randomUUID(),
        status,
        ...(status === 'failed' ? { attempts: 3, error: ERROR } : {}),
        ...(status === 'completed' ? { attempts: 1, result: { messageId: 'msg_1' } } : {}),
      });
    }

    const many = (n: number, make: () => Job): Job[] => Array.from({ length: n }, make);

    /**
     * job-service over an in-memory list of jobs: the job query filters and pages it, and the
     * statistics count it faceted by the filters, as the API does. The cards keep the fixture's
     * values. Returns the query strings each route received and a way to change the jobs.
     */
    /** The `groupId` filter as job-service applies it: a group's id, or `null` for no group. */
    function inGroup(params: URLSearchParams, job: Job): boolean {
      const groupId = params.get('groupId');
      if (groupId === null) return true;
      return groupId === 'null' ? job.groupId === null : job.groupId === groupId;
    }

    function serveJobs(initial: Job[]) {
      let jobs = initial;
      const jobQueries: URLSearchParams[] = [];
      const statsQueries: URLSearchParams[] = [];
      server.use(
        http.get(JOBS_URL, ({ request }) => {
          const params = new URL(request.url).searchParams;
          jobQueries.push(params);
          const status = params.get('status');
          const type = params.get('type');
          const matching = jobs.filter(
            (job) =>
              inGroup(params, job) &&
              (status === null || job.status === status) &&
              (type === null || job.type === type),
          );
          const offset = Number(params.get('offset') ?? 0);
          return HttpResponse.json({
            items: matching.slice(offset, offset + PAGE_SIZE),
            total: matching.length,
          });
        }),
        http.get(STATS_URL, ({ request }) => {
          const params = new URL(request.url).searchParams;
          statsQueries.push(params);
          const status = params.get('status');
          const type = params.get('type');
          const count = (match: (job: Job) => boolean) =>
            jobs.filter((job) => inGroup(params, job) && match(job)).length;
          const counts = {
            status: Object.fromEntries(
              JobStatus.options.map((s) => [
                s,
                count((job) => job.status === s && (type === null || job.type === type)),
              ]),
            ),
            type: Object.fromEntries(
              JobType.options.map((t) => [
                t,
                count((job) => job.type === t && (status === null || job.status === status)),
              ]),
            ),
          } as QueueStats['counts'];
          return HttpResponse.json(queueStatsFixtures.build({ counts }));
        }),
      );
      return {
        jobQueries,
        statsQueries,
        replace: (next: Job[]) => {
          jobs = next;
        },
      };
    }

    const statusGroup = () => screen.getByRole('group', { name: en.list.filterByStatus });
    const typeGroup = () => screen.getByRole('group', { name: en.list.filterByType });
    /** A filter button by its label, whatever count follows it. */
    const filterButton = (group: HTMLElement, label: string) =>
      within(group).getByRole('button', { name: new RegExp(`^${label}( [\\d,]+)?$`) });
    const pressed = (group: HTMLElement) =>
      within(group).getByRole('button', { pressed: true }).firstChild?.textContent;
    /** The short ids of the rows on screen. */
    const shownIds = () =>
      screen
        .getAllByRole('link')
        .map((link) => link.textContent)
        .filter((text) => /^[0-9a-f]{8}$/.test(text));
    const shortIds = (jobs: Job[]) => jobs.map((job) => job.id.slice(0, 8));

    it('shows and counts only the jobs submitted without a group', async () => {
      const ungrouped = [stored('pending'), stored('failed')];
      const { jobQueries, statsQueries } = serveJobs([
        ...ungrouped,
        { ...stored('pending'), groupId: randomUUID() },
      ]);
      renderList();

      expect(await screen.findByText(en.list.showing(1, 2, 2))).toBeVisible();
      expect(shownIds()).toEqual(shortIds(ungrouped));
      expect(
        await within(statusGroup()).findByRole('button', { name: /^Pending 1$/ }),
      ).toBeVisible();
      expect(jobQueries.every((params) => params.get('groupId') === 'null')).toBe(true);
      expect(statsQueries.every((params) => params.get('groupId') === 'null')).toBe(true);
    });

    it('Filter by status: clicking Failed shows only the failed jobs and presses Failed', async () => {
      const user = userEvent.setup();
      const failed = [stored('failed'), stored('failed', 'webhook')];
      serveJobs([...failed, stored('completed'), stored('pending')]);
      renderList();
      await screen.findByText(en.list.showing(1, 4, 4));

      await user.click(filterButton(statusGroup(), 'Failed'));

      expect(await screen.findByText(en.list.showing(1, 2, 2))).toBeVisible();
      expect(shownIds()).toEqual(shortIds(failed));
      expect(pressed(statusGroup())).toBe('Failed');
      expect(filterButton(statusGroup(), 'All')).toHaveAttribute('aria-pressed', 'false');
    });

    it('Back to all statuses: clicking All after Failed shows jobs of every status', async () => {
      const user = userEvent.setup();
      serveJobs([stored('failed'), stored('completed'), stored('pending')]);
      renderList();
      await user.click(await screen.findByRole('button', { name: /^Failed/ }));
      await screen.findByText(en.list.showing(1, 1, 1));

      await user.click(filterButton(statusGroup(), 'All'));

      expect(await screen.findByText(en.list.showing(1, 3, 3))).toBeVisible();
      expect(pressed(statusGroup())).toBe('All');
    });

    it('Filter by type: clicking Webhook shows only the webhook jobs', async () => {
      const user = userEvent.setup();
      const webhooks = [stored('pending', 'webhook'), stored('failed', 'webhook')];
      serveJobs([stored('pending'), ...webhooks, stored('completed')]);
      renderList();
      await screen.findByText(en.list.showing(1, 4, 4));

      await user.click(filterButton(typeGroup(), 'Webhook'));

      expect(await screen.findByText(en.list.showing(1, 2, 2))).toBeVisible();
      expect(shownIds()).toEqual(shortIds(webhooks));
      expect(pressed(typeGroup())).toBe('Webhook');
    });

    it('Status and type together: only failed webhook jobs, and the total is their number', async () => {
      const user = userEvent.setup();
      const failedWebhooks = [stored('failed', 'webhook'), stored('failed', 'webhook')];
      serveJobs([...failedWebhooks, stored('failed'), stored('completed', 'webhook')]);
      renderList();
      await screen.findByText(en.list.showing(1, 4, 4));

      await user.click(filterButton(statusGroup(), 'Failed'));
      await screen.findByText(en.list.showing(1, 3, 3));
      await user.click(filterButton(typeGroup(), 'Webhook'));

      expect(await screen.findByText(en.list.showing(1, 2, 2))).toBeVisible();
      expect(shownIds()).toEqual(shortIds(failedWebhooks));
    });

    it('Paging through a filtered list: Next shows the next failed jobs, the total counts failed only', async () => {
      const user = userEvent.setup();
      const failed = many(25, () => stored('failed'));
      serveJobs([...failed, ...many(3, () => stored('completed'))]);
      renderList();
      await user.click(await screen.findByRole('button', { name: /^Failed/ }));
      await screen.findByText(en.list.showing(1, 20, 25));

      await user.click(screen.getByRole('button', { name: en.list.next }));

      expect(await screen.findByText(en.list.showing(21, 25, 25))).toBeVisible();
      expect(shownIds()).toEqual(shortIds(failed.slice(20)));
    });

    it('Filter change on a later page: the list returns to the first page of the filtered jobs', async () => {
      const user = userEvent.setup();
      const failed = many(3, () => stored('failed'));
      serveJobs([...many(22, () => stored('pending')), ...failed]);
      renderList();
      await screen.findByText(en.list.showing(1, 20, 25));
      await user.click(screen.getByRole('button', { name: en.list.next }));
      await screen.findByText(en.list.showing(21, 25, 25));

      await user.click(filterButton(statusGroup(), 'Failed'));

      expect(await screen.findByText(en.list.showing(1, 3, 3))).toBeVisible();
      expect(shownIds()).toEqual(shortIds(failed));
      expect(screen.getByRole('button', { name: en.list.previous })).toBeDisabled();
    });

    it('Filter change on a later page: going back to the earlier filters starts at their first page too', async () => {
      const user = userEvent.setup();
      serveJobs([...many(22, () => stored('pending')), ...many(3, () => stored('failed'))]);
      renderList();
      await screen.findByText(en.list.showing(1, 20, 25));
      await user.click(screen.getByRole('button', { name: en.list.next }));
      await screen.findByText(en.list.showing(21, 25, 25));
      await user.click(filterButton(statusGroup(), 'Failed'));
      await screen.findByText(en.list.showing(1, 3, 3));

      await user.click(filterButton(statusGroup(), 'All'));

      expect(await screen.findByText(en.list.showing(1, 20, 25))).toBeVisible();
      expect(screen.getByRole('button', { name: en.list.previous })).toBeDisabled();
    });

    it('No job matches the filters: "No jobs match these filters" and Clear filters, not "No jobs yet"', async () => {
      const user = userEvent.setup();
      serveJobs([stored('completed'), stored('pending')]);
      renderList();
      await screen.findByText(en.list.showing(1, 2, 2));

      await user.click(filterButton(statusGroup(), 'Failed'));

      expect(await screen.findByText(en.list.noMatchTitle)).toBeVisible();
      expect(screen.getByRole('button', { name: en.list.clearFilters })).toBeVisible();
      expect(screen.queryByText(en.list.emptyTitle)).toBeNull();
    });

    it('Clear filters: both filters go back to All and jobs of every status and type show', async () => {
      const user = userEvent.setup();
      serveJobs([stored('completed'), stored('pending', 'webhook')]);
      renderList(undefined, '/jobs?status=failed&type=webhook');
      await screen.findByText(en.list.noMatchTitle);

      await user.click(screen.getByRole('button', { name: en.list.clearFilters }));

      expect(await screen.findByText(en.list.showing(1, 2, 2))).toBeVisible();
      expect(pressed(statusGroup())).toBe('All');
      expect(pressed(typeGroup())).toBe('All types');
    });

    it('Open a filtered link: the filters of the URL are pressed and only matching jobs show', async () => {
      const failedWebhook = stored('failed', 'webhook');
      const { jobQueries } = serveJobs([
        failedWebhook,
        stored('failed'),
        stored('pending', 'webhook'),
      ]);

      renderList(undefined, '/jobs?status=failed&type=webhook');

      expect(await screen.findByText(en.list.showing(1, 1, 1))).toBeVisible();
      expect(shownIds()).toEqual(shortIds([failedWebhook]));
      expect(pressed(statusGroup())).toBe('Failed');
      expect(pressed(typeGroup())).toBe('Webhook');
      expect(
        jobQueries.every((q) => q.get('status') === 'failed' && q.get('type') === 'webhook'),
      ).toBe(true);
    });

    it('Unknown filter value in the URL: All is pressed and the API is queried without it', async () => {
      const { jobQueries, statsQueries } = serveJobs([stored('failed'), stored('pending')]);

      renderList(undefined, '/jobs?status=unknown&type=batch');

      expect(await screen.findByText(en.list.showing(1, 2, 2))).toBeVisible();
      await within(statusGroup()).findByRole('button', { name: 'All 2' });
      expect(pressed(statusGroup())).toBe('All');
      expect(pressed(typeGroup())).toBe('All types');
      expect(statsQueries).not.toHaveLength(0);
      expect(jobQueries.map((q) => [q.has('status'), q.has('type')])).not.toContainEqual(
        expect.arrayContaining([true]),
      );
      expect(statsQueries.map((q) => q.toString())).not.toContainEqual(
        expect.stringMatching(/status|type/),
      );
    });

    it('Counts without filters: the page passes the unfiltered counts to the filter buttons', async () => {
      serveJobs([stored('failed', 'webhook'), stored('failed', 'webhook'), stored('completed')]);

      renderList();

      // How every button writes its count is the toolbar's test; this one proves the wiring.
      expect(await within(statusGroup()).findByRole('button', { name: 'All 3' })).toBeVisible();
      expect(filterButton(statusGroup(), 'Failed')).toHaveTextContent('Failed 2');
      expect(filterButton(typeGroup(), 'Webhook')).toHaveTextContent('Webhook 2');
    });

    it('Status counts follow the type filter: under Webhook, Failed and All count webhook jobs', async () => {
      const user = userEvent.setup();
      const { statsQueries } = serveJobs([
        stored('failed', 'webhook'),
        stored('failed', 'webhook'),
        stored('failed'),
      ]);
      renderList();
      await within(statusGroup()).findByRole('button', { name: 'Failed 3' });

      await user.click(filterButton(typeGroup(), 'Webhook'));

      expect(await within(statusGroup()).findByRole('button', { name: 'Failed 2' })).toBeVisible();
      expect(filterButton(statusGroup(), 'All')).toHaveTextContent('All 2');
      expect(filterButton(typeGroup(), 'Webhook')).toHaveTextContent('Webhook 2');
      expect(filterButton(typeGroup(), 'Email')).toHaveTextContent('Email 1');
      expect(statsQueries.at(-1)?.get('type')).toBe('webhook');
    });

    it('Type counts follow the status filter: under Failed, the type buttons count failed jobs', async () => {
      const user = userEvent.setup();
      serveJobs([stored('failed', 'webhook'), stored('failed', 'webhook'), stored('completed')]);
      renderList();
      await within(typeGroup()).findByRole('button', { name: 'Email 1' });

      await user.click(filterButton(statusGroup(), 'Failed'));

      expect(await within(typeGroup()).findByRole('button', { name: 'Email 0' })).toBeVisible();
      expect(filterButton(typeGroup(), 'Webhook')).toHaveTextContent('Webhook 2');
      expect(filterButton(typeGroup(), 'All types')).toHaveTextContent('All types 2');
    });

    it('Counts unavailable: without statistics the buttons show no counts and still filter', async () => {
      const user = userEvent.setup();
      const failed = stored('failed');
      serveJobs([failed, stored('pending')]);
      server.use(http.get(STATS_URL, () => HttpResponse.error()));
      renderList();
      await screen.findByText(en.list.showing(1, 2, 2));
      const stats = screen.getByRole('region', { name: en.list.statsLabel });
      await expect
        .poll(() => within(stats).queryAllByText(en.list.noValue).length, POLL_WAIT)
        .toBe(6);

      expect(filterButton(statusGroup(), 'Failed')).toHaveTextContent(/^Failed$/);
      await user.click(filterButton(statusGroup(), 'Failed'));

      expect(await screen.findByText(en.list.showing(1, 1, 1))).toBeVisible();
      expect(shownIds()).toEqual(shortIds([failed]));
    });

    it('Counts after a filter change: no counts until they arrive, the cards keep their values', async () => {
      const user = userEvent.setup();
      serveJobs([stored('failed', 'webhook'), stored('pending')]);
      // Statistics for the type filter never answer, so the moment before they arrive lasts.
      server.use(
        http.get(STATS_URL, ({ request }) =>
          new URL(request.url).searchParams.has('type')
            ? new Promise<never>(() => undefined)
            : HttpResponse.json(queueStatsFixtures.build()),
        ),
      );
      renderList();
      const stats = await screen.findByRole('region', { name: en.list.statsLabel });
      await within(stats).findByText('1,234');
      await within(statusGroup()).findByRole('button', { name: /^Failed \d/ });

      await user.click(filterButton(typeGroup(), 'Webhook'));

      await expect
        .poll(() => filterButton(statusGroup(), 'Failed').textContent, POLL_WAIT)
        .toBe('Failed');
      expect(filterButton(typeGroup(), 'Webhook').textContent).toBe('Webhook');
      expect(within(stats).getByText('1,234')).toBeVisible();
      expect(within(stats).queryAllByText(en.list.noValue)).toHaveLength(0);
    });

    it('Counts kept on a failed poll: the buttons keep the last counts', async () => {
      serveJobs([stored('failed'), stored('failed')]);
      let statsCall = 0;
      server.use(
        http.get(STATS_URL, () =>
          statsCall++ === 0
            ? HttpResponse.json(
                queueStatsFixtures.build({
                  counts: {
                    status: {
                      scheduled: 0,
                      pending: 0,
                      processing: 0,
                      completed: 0,
                      failed: 2,
                      cancelled: 0,
                    },
                    type: { email: 2, webhook: 0, 'flight-transit': 0 },
                  },
                }),
              )
            : HttpResponse.error(),
        ),
      );
      renderList(20);
      await within(statusGroup()).findByRole('button', { name: 'Failed 2' });

      await expect.poll(() => statsCall, POLL_WAIT).toBeGreaterThan(2);

      expect(filterButton(statusGroup(), 'Failed')).toHaveTextContent('Failed 2');
      expect(filterButton(typeGroup(), 'Email')).toHaveTextContent('Email 2');
    });

    it('Cards under a filter: the statistics cards show the same values with filters chosen', async () => {
      const user = userEvent.setup();
      serveJobs([stored('failed', 'webhook'), stored('pending')]);
      renderList();
      const stats = await screen.findByRole('region', { name: en.list.statsLabel });
      await within(stats).findByText('1,234');
      const before = within(stats)
        .getAllByRole('group')
        .map((card) => card.textContent);

      await user.click(filterButton(statusGroup(), 'Failed'));
      await user.click(filterButton(typeGroup(), 'Webhook'));
      await within(statusGroup()).findByRole('button', { name: 'Failed 1' });

      expect(
        within(stats)
          .getAllByRole('group')
          .map((card) => card.textContent),
      ).toEqual(before);
    });

    it('New matching job appears: under Failed, the next poll shows it and the Failed count grows', async () => {
      const user = userEvent.setup();
      const first = stored('failed');
      const service = serveJobs([first, stored('pending')]);
      renderList(20);
      await user.click(await screen.findByRole('button', { name: /^Failed/ }));
      await within(statusGroup()).findByRole('button', { name: 'Failed 1' }, POLL_WAIT);

      const second = stored('failed');
      service.replace([second, first, stored('pending')]);

      expect(
        await screen.findByRole('link', { name: second.id.slice(0, 8) }, POLL_WAIT),
      ).toBeVisible();
      expect(
        await within(statusGroup()).findByRole('button', { name: 'Failed 2' }, POLL_WAIT),
      ).toBeVisible();
    });

    it('Failed poll under a filter: the failed jobs stay and "Connection lost, retrying" shows', async () => {
      const user = userEvent.setup();
      const failed = stored('failed');
      serveJobs([failed, stored('pending')]);
      renderList(20);
      await user.click(await screen.findByRole('button', { name: /^Failed/ }));
      await screen.findByText(en.list.showing(1, 1, 1));

      server.use(http.get(JOBS_URL, () => HttpResponse.error()));

      expect(await screen.findByText(en.list.connectionLost, {}, POLL_WAIT)).toBeVisible();
      expect(shownIds()).toEqual(shortIds([failed]));
    });
  });
});
