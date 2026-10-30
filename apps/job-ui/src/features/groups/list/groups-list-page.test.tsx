import type { JobGroup, QueryJobGroupsResponse } from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { PageErrorBoundary } from '../../app-frame/page-error-boundary';
import { CurrentPath, TEST_API_BASE, TestProviders } from '../../jobs/testing/test-providers';
import { groupFixtures } from '../testing/group-fixtures';
import { GroupsListPage } from './groups-list-page';

const GROUPS_URL = `${TEST_API_BASE}/v1/groups`;
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

/** Answers the groups query with one page per call, in order; the last page repeats. */
function answerPages(...pages: (QueryJobGroupsResponse | 'network-error')[]) {
  let call = 0;
  server.use(
    http.get(GROUPS_URL, () => {
      const page = pages[Math.min(call++, pages.length - 1)]!;
      return page === 'network-error' ? HttpResponse.error() : HttpResponse.json(page);
    }),
  );
}

function renderList(pollIntervalMs?: number) {
  return render(
    <TestProviders path="/groups" config={pollIntervalMs ? { pollIntervalMs } : {}}>
      <PageErrorBoundary>
        <Routes>
          <Route path="/groups" element={<GroupsListPage />} />
          <Route path="*" element={<CurrentPath />} />
        </Routes>
      </PageErrorBoundary>
    </TestProviders>,
  );
}

function shortId(group: JobGroup): string {
  return group.id.slice(0, 8);
}

/** `n` groups, newest first as the API returns them. */
function groups(n: number): JobGroup[] {
  return Array.from({ length: n }, () => groupFixtures.build());
}

describe('GroupsListPage', () => {
  it('Groups in the table: one row per group with its fields, in the order of the API', async () => {
    const first = groupFixtures.build({ total: 10, completed: 4, failed: 1 });
    const second = groupFixtures.build({ total: 2, completed: 0, failed: 0 });
    answerPages({ items: [first, second], total: 2 });

    renderList();

    await screen.findByRole('link', { name: shortId(first) });
    expect(screen.getByText(en.list.live)).toBeVisible();
    const [, firstRow, secondRow] = screen.getAllByRole('row');
    expect(within(firstRow!).getByRole('link', { name: shortId(first) })).toBeVisible();
    expect(firstRow).toHaveTextContent(en.statuses.running);
    expect(firstRow).toHaveTextContent(en.groups.progressText(4, 1, 10));
    expect(
      within(firstRow!).getByRole('progressbar', { name: en.groups.progressLabel(4, 1, 10) }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(within(firstRow!).getAllByRole('cell')[3]).toHaveTextContent('21:10:31');
    expect(within(secondRow!).getByRole('link', { name: shortId(second) })).toBeVisible();
    expect(secondRow).toHaveTextContent(en.groups.progressText(0, 0, 2));
  });

  it('Groups in the table: the columns are Group ID, Status, Progress, Created and Finished', async () => {
    answerPages({ items: groups(1), total: 1 });

    renderList();

    await screen.findByText(en.list.showing(1, 1, 1));
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      en.groups.columns.id,
      en.groups.columns.status,
      en.groups.columns.progress,
      en.groups.columns.created,
      en.groups.columns.finished,
    ]);
  });

  it('Finished group in the table: Finished shows the local time of day it finished', async () => {
    const group = groupFixtures.build({
      status: 'failed',
      completed: 2,
      failed: 1,
      finishedAt: '2026-10-29T21:12:05.000Z',
    });
    answerPages({ items: [group], total: 1 });

    renderList();

    await screen.findByRole('link', { name: shortId(group) });
    const [, row] = screen.getAllByRole('row');
    const cells = within(row!).getAllByRole('cell');
    expect(row).toHaveTextContent(en.statuses.failed);
    expect(cells[3]).toHaveTextContent('21:10:31');
    expect(cells.at(-1)).toHaveTextContent('21:12:05');
  });

  it('Running group in the table: Finished shows "—"', async () => {
    const group = groupFixtures.build({ status: 'running', finishedAt: null });
    answerPages({ items: [group], total: 1 });

    renderList();

    await screen.findByRole('link', { name: shortId(group) });
    const [, row] = screen.getAllByRole('row');
    const cells = within(row!).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent(en.group.notYet);
  });

  it('Open a group from the list: clicking the short id opens the group page', async () => {
    const user = userEvent.setup();
    const group = groupFixtures.build();
    answerPages({ items: [group], total: 1 });
    renderList();

    await user.click(await screen.findByRole('link', { name: shortId(group) }));

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent(
      `/groups/${group.id}`,
    );
  });

  it('First page of groups: shows its range and the total, Previous disabled and Next enabled', async () => {
    answerPages({ items: groups(20), total: 25 });

    renderList();

    expect(await screen.findByText(en.list.showing(1, 20, 25))).toBeVisible();
    expect(screen.getByRole('button', { name: en.list.previous })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.list.next })).toBeEnabled();
  });

  it('Next page of groups: shows the next groups, asks for the next offset and enables Previous', async () => {
    const user = userEvent.setup();
    const firstPage = groups(20);
    const secondPage = groups(5);
    const offsets: string[] = [];
    server.use(
      http.get(GROUPS_URL, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset') ?? '';
        offsets.push(offset);
        return HttpResponse.json({ items: offset === '0' ? firstPage : secondPage, total: 25 });
      }),
    );
    renderList();
    await screen.findByText(en.list.showing(1, 20, 25));

    await user.click(screen.getByRole('button', { name: en.list.next }));

    expect(await screen.findByText(en.list.showing(21, 25, 25))).toBeVisible();
    expect(screen.getByRole('link', { name: shortId(secondPage[0]!) })).toBeVisible();
    expect(screen.queryByRole('link', { name: shortId(firstPage[0]!) })).toBeNull();
    expect(offsets).toContain('20');
    expect(screen.getByRole('button', { name: en.list.previous })).toBeEnabled();
  });

  it('Previous on the groups list: returns to the first page and disables Previous again', async () => {
    const user = userEvent.setup();
    const firstPage = groups(20);
    const secondPage = groups(5);
    server.use(
      http.get(GROUPS_URL, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        return HttpResponse.json({ items: offset === '0' ? firstPage : secondPage, total: 25 });
      }),
    );
    renderList();
    await screen.findByText(en.list.showing(1, 20, 25));
    await user.click(screen.getByRole('button', { name: en.list.next }));
    await screen.findByText(en.list.showing(21, 25, 25));

    await user.click(screen.getByRole('button', { name: en.list.previous }));

    expect(await screen.findByText(en.list.showing(1, 20, 25))).toBeVisible();
    expect(screen.getByRole('link', { name: shortId(firstPage[0]!) })).toBeVisible();
    expect(screen.getByRole('button', { name: en.list.previous })).toBeDisabled();
  });

  it('Last page of groups: Next is disabled on the page that holds the oldest group', async () => {
    answerPages({ items: groups(2), total: 2 });

    renderList();

    expect(await screen.findByText(en.list.showing(1, 2, 2))).toBeVisible();
    expect(screen.getByRole('button', { name: en.list.next })).toBeDisabled();
  });

  it('Loading groups: skeleton rows are shown while the first page loads', () => {
    server.use(http.get(GROUPS_URL, () => new Promise<never>(() => undefined)));

    renderList();

    expect(screen.getByLabelText(en.groups.loading)).toHaveAttribute('aria-busy', 'true');
  });

  it('No groups: shows "No groups yet" and no pager', async () => {
    answerPages({ items: [], total: 0 });

    renderList();

    expect(await screen.findByText(en.groups.emptyTitle)).toBeVisible();
    expect(screen.queryByRole('button', { name: en.list.next })).toBeNull();
  });

  it('No filters: the groups list offers no status or type filter and asks only for an offset', async () => {
    let search = '';
    server.use(
      http.get(GROUPS_URL, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: groups(1), total: 1 });
      }),
    );

    renderList();

    await screen.findByText(en.list.showing(1, 1, 1));
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({ offset: '0' });
    expect(screen.queryByRole('group', { name: en.list.filterByStatus })).toBeNull();
    expect(screen.queryByRole('group', { name: en.list.filterByType })).toBeNull();
  });

  it('Groups list fails to load: "Something went wrong" and Reload instead of the table', async () => {
    server.use(
      http.get(GROUPS_URL, () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
          { status: 500 },
        ),
      ),
    );

    renderList();

    expect(await screen.findByText(en.pageError.title)).toBeVisible();
    expect(screen.getByRole('button', { name: en.pageError.reload })).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Status change appears in the groups list: the next poll shows the new status', async () => {
    const running = groupFixtures.build({ status: 'running' });
    answerPages({ items: [running], total: 1 });
    renderList(20);
    expect(await screen.findByText(en.statuses.running)).toBeVisible();

    // The next answer is served only now, so the first state cannot be skipped by a fast poll.
    answerPages({
      items: [{ ...running, status: 'completed', finishedAt: '2026-10-29T21:12:05.000Z' }],
      total: 1,
    });

    expect(await screen.findByText(en.statuses.completed, {}, POLL_WAIT)).toBeVisible();
    expect(screen.queryByText(en.statuses.running)).toBeNull();
    const [, row] = screen.getAllByRole('row');
    expect(within(row!).getAllByRole('cell').at(-1)).toHaveTextContent('21:12:05');
  });

  it('API unreachable while polling groups: the groups stay and "Connection lost, retrying" shows', async () => {
    const group = groupFixtures.build();
    answerPages({ items: [group], total: 1 });
    renderList(20);
    await screen.findByRole('link', { name: shortId(group) });

    answerPages('network-error');

    expect(await screen.findByText(en.list.connectionLost, {}, POLL_WAIT)).toBeVisible();
    expect(screen.getByRole('link', { name: shortId(group) })).toBeVisible();
  });

  it('Groups API back again: the "Connection lost" note goes away after a successful poll', async () => {
    const group = groupFixtures.build();
    answerPages({ items: [group], total: 1 });
    renderList(20);
    await screen.findByRole('link', { name: shortId(group) });
    answerPages('network-error');
    await screen.findByText(en.list.connectionLost, {}, POLL_WAIT);

    answerPages({ items: [group], total: 1 });

    await expect.poll(() => screen.queryByText(en.list.connectionLost), POLL_WAIT).toBeNull();
  });
});
