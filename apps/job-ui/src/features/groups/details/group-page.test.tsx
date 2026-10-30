import { randomUUID } from 'node:crypto';

import type { Job, JobGroup } from '@job-queue/contracts';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { PageErrorBoundary } from '../../app-frame/page-error-boundary';
import { jobFixtures } from '../../jobs/testing/job-fixtures';
import { CurrentPath, TEST_API_BASE, TestProviders } from '../../jobs/testing/test-providers';
import { groupFixtures } from '../testing/group-fixtures';
import { GroupPage } from './group-page';

const JOBS_URL = `${TEST_API_BASE}/v1/jobs`;
/** Waits for a poll; generous, since the whole repo's tests share the machine. */
const POLL_WAIT = { timeout: 5000 };
const server = setupServer();
const requests: string[] = [];

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  server.events.on('request:start', ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});
afterAll(() => {
  server.close();
});

type GroupAnswer = JobGroup | 'not-found' | 'network-error' | 'server-error';

/** Answers GET of the group with one answer per call, in order; the last one repeats. */
function answerGroup(id: string, ...answers: GroupAnswer[]) {
  let call = 0;
  server.use(
    http.get(`${TEST_API_BASE}/v1/groups/${id}`, () => {
      const answer = answers[Math.min(call++, answers.length - 1)]!;
      if (answer === 'network-error') return HttpResponse.error();
      if (answer === 'not-found') {
        return HttpResponse.json(
          { code: 'JOB_GROUP_NOT_FOUND', message: 'Job group not found', details: { id } },
          { status: 404 },
        );
      }
      if (answer === 'server-error') {
        return HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
          { status: 500 },
        );
      }
      return HttpResponse.json(answer);
    }),
  );
}

/** Answers the group's jobs query with one list per call (newest first), in order; the last repeats. */
function answerJobs(...answers: (Job[] | 'network-error')[]) {
  let call = 0;
  server.use(
    http.get(JOBS_URL, () => {
      const answer = answers[Math.min(call++, answers.length - 1)]!;
      return answer === 'network-error'
        ? HttpResponse.error()
        : HttpResponse.json({ items: answer, total: answer.length });
    }),
  );
}

function job(status: Job['status'], groupId: string): Job {
  return jobFixtures.build({ id: randomUUID(), status, groupId });
}

function cellName(j: Job): string {
  return en.group.cell(j.id.slice(0, 8), en.statuses[j.status]);
}

function renderGroup(id: string, pollIntervalMs?: number) {
  return render(
    <TestProviders path={`/groups/${id}`} config={pollIntervalMs ? { pollIntervalMs } : {}}>
      <PageErrorBoundary>
        <Routes>
          <Route path="/groups/:id" element={<GroupPage />} />
          <Route path="*" element={<CurrentPath />} />
        </Routes>
      </PageErrorBoundary>
    </TestProviders>,
  );
}

/** The value next to a label in the Details card or a progress tile. */
function valueOf(container: HTMLElement, label: string): HTMLElement {
  return within(container).getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;
}

/** A running group of 3 jobs, 1 completed and 1 failed, with those jobs. */
function runningGroup() {
  const group = groupFixtures.build();
  const jobs = [job('processing', group.id), job('failed', group.id), job('completed', group.id)];
  return { group, jobs };
}

describe('GroupPage', () => {
  it('Group page header: breadcrumb, full id, "running" badge, live indicator and no actions', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);

    renderGroup(group.id);

    expect(await screen.findByRole('heading', { level: 1, name: group.id })).toBeVisible();
    const breadcrumb = screen.getByRole('navigation', { name: en.group.breadcrumb });
    expect(within(breadcrumb).getByRole('link', { name: en.group.groups })).toBeVisible();
    expect(breadcrumb).toHaveTextContent(group.id);
    expect(screen.getByText(en.statuses.running)).toBeVisible();
    expect(screen.getByText(en.list.live)).toBeVisible();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('Back to the groups list from the breadcrumb: clicking "Groups" opens the groups list', async () => {
    const user = userEvent.setup();
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);
    renderGroup(group.id);
    const breadcrumb = await screen.findByRole('navigation', { name: en.group.breadcrumb });

    await user.click(within(breadcrumb).getByRole('link', { name: en.group.groups }));

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent(/^\/groups$/);
  });

  it('Group details: a finished group shows its creation, update, last check and finish', async () => {
    const group = groupFixtures.build({
      status: 'completed',
      total: 1,
      completed: 1,
      failed: 0,
      updatedAt: '2026-10-29T21:12:06.000Z',
      checkedAt: '2026-10-29T21:12:04.000Z',
      finishedAt: '2026-10-29T21:12:05.000Z',
    });
    answerGroup(group.id, group);
    answerJobs([job('completed', group.id)]);

    renderGroup(group.id);

    const details = await screen.findByRole('region', { name: en.group.details });
    expect(valueOf(details, en.group.fields.created)).toHaveTextContent('29 Oct, 21:10:31');
    expect(valueOf(details, en.group.fields.updated)).toHaveTextContent('29 Oct, 21:12:06');
    expect(valueOf(details, en.group.fields.checked)).toHaveTextContent('29 Oct, 21:12:04');
    expect(valueOf(details, en.group.fields.finished)).toHaveTextContent('29 Oct, 21:12:05');
  });

  it('Group not checked or finished yet: Last checked and Finished show "—"', async () => {
    const group = groupFixtures.build({ checkedAt: null, finishedAt: null });
    answerGroup(group.id, group);
    answerJobs([]);

    renderGroup(group.id);

    const details = await screen.findByRole('region', { name: en.group.details });
    expect(valueOf(details, en.group.fields.checked)).toHaveTextContent(en.group.notYet);
    expect(valueOf(details, en.group.fields.finished)).toHaveTextContent(en.group.notYet);
  });

  it('Progress of a running group: 66%, "2 of 3 jobs", Completed 1, Failed 1, Remaining 1', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);

    renderGroup(group.id);

    const card = await screen.findByRole('region', { name: en.group.progress });
    expect(card).toHaveTextContent(en.group.percent(66));
    expect(card).toHaveTextContent(en.group.finishedOf(2, 3));
    expect(within(card).getByRole('progressbar', { name: en.group.progressBar })).toHaveAttribute(
      'aria-valuenow',
      '66',
    );
    expect(valueOf(card, en.group.counts.completed)).toHaveTextContent(/^1$/);
    expect(valueOf(card, en.group.counts.failed)).toHaveTextContent(/^1$/);
    expect(valueOf(card, en.group.counts.remaining)).toHaveTextContent(/^1$/);
  });

  it('Progress counts: each tile shows its own count (6 jobs, 3 completed, 1 failed, 2 remaining)', async () => {
    const group = groupFixtures.build({ total: 6, completed: 3, failed: 1 });
    answerGroup(group.id, group);
    answerJobs([]);

    renderGroup(group.id);

    const card = await screen.findByRole('region', { name: en.group.progress });
    expect(card).toHaveTextContent(en.group.percent(66));
    expect(card).toHaveTextContent(en.group.finishedOf(4, 6));
    expect(valueOf(card, en.group.counts.completed)).toHaveTextContent(/^3$/);
    expect(valueOf(card, en.group.counts.failed)).toHaveTextContent(/^1$/);
    expect(valueOf(card, en.group.counts.remaining)).toHaveTextContent(/^2$/);
  });

  it('Group without jobs: 0%, "0 of 0 jobs", all counts 0 and "No jobs in this group yet"', async () => {
    const group = groupFixtures.build({ total: 0, completed: 0, failed: 0 });
    answerGroup(group.id, group);
    answerJobs([]);

    renderGroup(group.id);

    const card = await screen.findByRole('region', { name: en.group.progress });
    expect(card).toHaveTextContent(en.group.percent(0));
    expect(card).toHaveTextContent(en.group.finishedOf(0, 0));
    expect(valueOf(card, en.group.counts.completed)).toHaveTextContent(/^0$/);
    expect(valueOf(card, en.group.counts.failed)).toHaveTextContent(/^0$/);
    expect(valueOf(card, en.group.counts.remaining)).toHaveTextContent(/^0$/);
    expect(await within(card).findByText(en.group.noJobs)).toBeVisible();
  });

  it('No timing estimates: the progress card shows no rate, elapsed time or time left', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);

    renderGroup(group.id);

    const card = await screen.findByRole('region', { name: en.group.progress });
    expect(card).not.toHaveTextContent(/rate|elapsed|eta|left/i);
  });

  it('The page shows no table of the group’s jobs, only the cells', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);

    renderGroup(group.id);

    expect(await screen.findByRole('link', { name: cellName(jobs[0]!) })).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('One cell per job: the cells are the group’s jobs, oldest first', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);

    renderGroup(group.id);

    const card = await screen.findByRole('region', { name: en.group.progress });
    await within(card).findByText(en.group.jobsRange(3));
    expect(
      within(card)
        .getAllByRole('link')
        .map((cell) => cell.getAttribute('aria-label')),
    ).toEqual([...jobs].reverse().map(cellName));
  });

  it('Loading a group: skeleton cards are shown while the group loads', () => {
    const id = randomUUID();
    server.use(
      http.get(`${TEST_API_BASE}/v1/groups/${id}`, () => new Promise<never>(() => undefined)),
    );
    answerJobs([]);

    renderGroup(id);

    expect(screen.getByLabelText(en.group.loading)).toHaveAttribute('aria-busy', 'true');
  });

  it('Unknown group id: "Group not found" and a link back to Groups', async () => {
    const user = userEvent.setup();
    const id = randomUUID();
    answerGroup(id, 'not-found');
    answerJobs([]);
    renderGroup(id);

    expect(
      await screen.findByRole('heading', { level: 1, name: en.group.notFoundTitle }),
    ).toBeVisible();
    await user.click(screen.getByRole('link', { name: en.group.backToGroups }));

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent(/^\/groups$/);
  });

  it('Malformed group id: "Group not found", a link back to Groups, and no request is made', async () => {
    renderGroup('abc', 20);

    expect(
      await screen.findByRole('heading', { level: 1, name: en.group.notFoundTitle }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: en.group.backToGroups })).toBeVisible();
    // Several poll intervals pass, so a wrongly enabled query would have sent its request by now.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requests).toEqual([]);
  });

  it('Group page fails to load: "Something went wrong" and Reload instead of the group', async () => {
    const id = randomUUID();
    answerGroup(id, 'server-error');
    answerJobs([]);

    renderGroup(id);

    expect(await screen.findByText(en.pageError.title)).toBeVisible();
    expect(screen.getByRole('button', { name: en.pageError.reload })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1, name: id })).toBeNull();
  });

  it('Reload a group after a failed load: the next successful request shows the group', async () => {
    const user = userEvent.setup();
    const { group, jobs } = runningGroup();
    answerGroup(group.id, 'server-error', group);
    answerJobs(jobs);
    renderGroup(group.id);

    await user.click(await screen.findByRole('button', { name: en.pageError.reload }));

    expect(await screen.findByRole('heading', { level: 1, name: group.id })).toBeVisible();
    expect(screen.queryByText(en.pageError.title)).toBeNull();
  });

  it('Progress appears on the group page: after the next poll a completed job’s cell is completed', async () => {
    const group = groupFixtures.build({ total: 1, completed: 0, failed: 0 });
    const processing = job('processing', group.id);
    answerGroup(group.id, group);
    answerJobs([processing]);
    renderGroup(group.id, 20);
    const before = await screen.findByRole('link', { name: cellName(processing) });
    expect(before).toHaveAttribute('data-kind', 'remaining');

    const completed: Job = { ...processing, status: 'completed' };
    answerGroup(group.id, { ...group, completed: 1 });
    answerJobs([completed]);

    const after = await screen.findByRole('link', { name: cellName(completed) }, POLL_WAIT);
    expect(after).toHaveAttribute('data-kind', 'completed');
  });

  it('API unreachable while polling a group: the group and its cells stay, "Connection lost" shows', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);
    renderGroup(group.id, 20);
    await screen.findByRole('link', { name: cellName(jobs[0]!) });

    answerGroup(group.id, 'network-error');
    answerJobs('network-error');

    expect(await screen.findByText(en.list.connectionLost, {}, POLL_WAIT)).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: group.id })).toBeVisible();
    expect(screen.getByRole('link', { name: cellName(jobs[0]!) })).toBeVisible();
  });

  it('Jobs poll fails while the group poll works: the cells stay and "Connection lost" shows', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);
    renderGroup(group.id, 20);
    await screen.findByRole('link', { name: cellName(jobs[0]!) });

    answerJobs('network-error');

    expect(await screen.findByText(en.list.connectionLost, {}, POLL_WAIT)).toBeVisible();
    expect(screen.getByRole('link', { name: cellName(jobs[0]!) })).toBeVisible();
  });

  it('Group jobs fail to load: the group stays, "Could not load the jobs" where the cells go', async () => {
    const { group } = runningGroup();
    answerGroup(group.id, group);
    answerJobs('network-error');

    renderGroup(group.id);

    const card = await screen.findByRole('region', { name: en.group.progress });
    expect(await within(card).findByText(en.group.jobsFailed)).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: group.id })).toBeVisible();
    expect(card).toHaveTextContent(en.group.finishedOf(2, 3));
    expect(screen.getByRole('region', { name: en.group.details })).toBeVisible();
    expect(screen.getByText(en.list.connectionLost)).toBeVisible();
    expect(screen.queryByText(en.pageError.title)).toBeNull();
  });

  it('Group jobs load after a failed first load: the cells show and the note goes away', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs('network-error');
    renderGroup(group.id, 20);
    await screen.findByText(en.group.jobsFailed);

    answerJobs(jobs);

    expect(await screen.findByRole('link', { name: cellName(jobs[0]!) }, POLL_WAIT)).toBeVisible();
    expect(screen.queryByText(en.group.jobsFailed)).toBeNull();
  });

  it('Group API back again: the "Connection lost" note goes away after a successful poll', async () => {
    const { group, jobs } = runningGroup();
    answerGroup(group.id, group);
    answerJobs(jobs);
    renderGroup(group.id, 20);
    await screen.findByRole('heading', { level: 1, name: group.id });
    answerGroup(group.id, 'network-error');
    await screen.findByText(en.list.connectionLost, {}, POLL_WAIT);

    answerGroup(group.id, group);

    await expect.poll(() => screen.queryByText(en.list.connectionLost), POLL_WAIT).toBeNull();
  });
});
