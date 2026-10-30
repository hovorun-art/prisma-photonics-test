import { randomUUID } from 'node:crypto';

import type { Job, JobGroup } from '@job-queue/contracts';
import { expect, type Page, test } from '@playwright/test';

import { API_BASE_PATH, GROUPS_API_PATH } from '../../src/config/api-base-path';
import { en } from '../../src/locales/en';
import { type E2eJobs, PendingEmailE2eJobs } from './e2e-jobs';

/** What job-ui sent to the mock backend that changes data. */
interface MockGroupCalls {
  groupCreates: number;
  bulks: unknown[];
  deletes: string[];
}

interface MockGroupBackend {
  /**
   * Answers job-ui's group calls from `groups` and the jobs calls from `jobs` (by group id); a
   * group create adds an empty group, a bulk submit adds its jobs, or fails with `bulkFails`.
   */
  install(req: {
    page: Page;
    groups: JobGroup[];
    jobs: Job[];
    bulkFails?: boolean;
  }): Promise<MockGroupCalls>;
  group(req: Partial<JobGroup>): JobGroup;
  job(req: Partial<Job>): Job;
  /** A running group with one completed and one pending job, newest first. */
  groupWithJobs(): { group: JobGroup; jobs: Job[]; completed: Job };
}

/** job-group-service and job-service in memory behind `page.route`, as far as the group pages use them. */
class RoutedGroupBackend implements MockGroupBackend {
  private readonly jobs: E2eJobs = new PendingEmailE2eJobs();

  async install(req: {
    page: Page;
    groups: JobGroup[];
    jobs: Job[];
    bulkFails?: boolean;
  }): Promise<MockGroupCalls> {
    const calls: MockGroupCalls = { groupCreates: 0, bulks: [], deletes: [] };
    // The header's API status pill polls the statistics; they are not part of these scenarios.
    await req.page.route(`**${API_BASE_PATH}/v1/stats**`, (route) => route.abort());
    await req.page.route(`**${GROUPS_API_PATH}**`, async (route) => {
      const id = new URL(route.request().url()).pathname.split('/v1/groups/')[1];
      const method = route.request().method();
      if (method === 'POST') {
        calls.groupCreates += 1;
        const created = this.group({ total: 0, completed: 0, checkedAt: null });
        req.groups.unshift(created);
        return route.fulfill({ status: 201, json: created });
      }
      if (method === 'DELETE' && id) {
        calls.deletes.push(id);
        return route.fulfill({ status: 204 });
      }
      if (!id) return route.fulfill({ json: { items: req.groups, total: req.groups.length } });
      const group = req.groups.find((g) => g.id === id);
      return group
        ? route.fulfill({ json: group })
        : route.fulfill({
            status: 404,
            json: { code: 'JOB_GROUP_NOT_FOUND', message: 'Job group not found', details: { id } },
          });
    });
    await req.page.route(`**${API_BASE_PATH}/v1/jobs/bulk`, async (route) => {
      const body = route.request().postDataJSON() as { jobs: Partial<Job>[] };
      calls.bulks.push(body);
      if (req.bulkFails) {
        return route.fulfill({
          status: 503,
          json: { code: 'QUEUE_UNAVAILABLE', message: 'The queue is unavailable', details: {} },
        });
      }
      const items = body.jobs.map((job) => this.job(job));
      req.jobs.push(...items);
      return route.fulfill({ status: 201, json: { items } });
    });
    await req.page.route(`**${API_BASE_PATH}/v1/jobs**`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = new URL(route.request().url());
      const id = url.pathname.split('/v1/jobs/')[1];
      if (id) return route.fulfill({ json: req.jobs.find((j) => j.id === id) });
      const groupId = url.searchParams.get('groupId');
      const matching = req.jobs.filter((j) => j.groupId === groupId);
      return route.fulfill({ json: { items: matching, total: matching.length } });
    });
    return calls;
  }

  group(req: Partial<JobGroup>): JobGroup {
    return {
      id: randomUUID(),
      status: 'running',
      total: 2,
      completed: 1,
      failed: 0,
      createdAt: '2026-10-29T21:10:31.000Z',
      updatedAt: '2026-10-29T21:10:40.000Z',
      checkedAt: '2026-10-29T21:10:40.000Z',
      finishedAt: null,
      ...req,
    };
  }

  groupWithJobs(): { group: JobGroup; jobs: Job[]; completed: Job } {
    const group = this.group({});
    const pending = this.job({ groupId: group.id });
    const completed = this.job({
      groupId: group.id,
      status: 'completed',
      attempts: 1,
      startedAt: '2026-10-29T21:10:32.000Z',
      completedAt: '2026-10-29T21:10:33.000Z',
      result: { messageId: 'msg_1' },
    });
    return { group, jobs: [pending, completed], completed };
  }

  job(req: Partial<Job>): Job {
    return this.jobs.build(req);
  }
}

const backend: MockGroupBackend = new RoutedGroupBackend();

test('Groups from the header: the Groups link opens the groups list', async ({ page }) => {
  const { group, jobs } = backend.groupWithJobs();
  await backend.install({ page, groups: [group], jobs });

  await page.goto('/jobs');
  await page
    .getByRole('navigation', { name: en.frame.navLabel })
    .getByRole('link', { name: en.frame.groups })
    .click();

  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole('heading', { level: 1, name: en.groups.title })).toBeVisible();
});

test('Open a group from the list, and Back returns to the groups list', async ({ page }) => {
  const { group, jobs } = backend.groupWithJobs();
  await backend.install({ page, groups: [group], jobs });

  await page.goto('/groups');
  await page.getByRole('link', { name: group.id.slice(0, 8) }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${group.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: group.id })).toBeVisible();
  await page.goBack();

  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole('heading', { level: 1, name: en.groups.title })).toBeVisible();
});

test('Open a job from its cell: the cell of a job opens the job page', async ({ page }) => {
  const { group, jobs, completed } = backend.groupWithJobs();
  await backend.install({ page, groups: [group], jobs });

  await page.goto(`/groups/${group.id}`);
  const cell = page.getByRole('link', {
    name: en.group.cell(completed.id.slice(0, 8), en.statuses.completed),
  });
  await cell.click();

  await expect(page).toHaveURL(new RegExp(`/jobs/${completed.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: completed.id })).toBeVisible();
});

test('Unknown group id: "Group not found" with a link back to Groups', async ({ page }) => {
  await backend.install({ page, groups: [], jobs: [] });

  await page.goto(`/groups/${randomUUID()}`);
  await expect(page.getByRole('heading', { level: 1, name: en.group.notFoundTitle })).toBeVisible();
  await page.getByRole('link', { name: en.group.backToGroups }).click();

  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByText(en.groups.emptyTitle)).toBeVisible();
});

test('Create a group with two jobs: one group, both jobs carry its id, and its page opens', async ({
  page,
}) => {
  const calls = await backend.install({ page, groups: [], jobs: [] });

  await page.goto('/jobs');
  await page.getByRole('banner').getByRole('link', { name: en.frame.newGroup }).click();
  await expect(page).toHaveURL(/\/groups\/new$/);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(en.submit.to, { exact: true }).fill('ops@acme.test');
  await panel.getByLabel(en.submit.subject, { exact: true }).fill('Weekly digest');
  await panel.getByLabel(en.submit.body, { exact: true }).fill('Hi team');
  await page.getByRole('button', { name: en.newGroup.addJob }).click();
  await panel.getByRole('button', { name: new RegExp(en.submit.types.webhook.name) }).click();
  await panel.getByLabel(en.submit.url, { exact: true }).fill('https://hooks.example.com/orders');
  await page.getByRole('button', { name: en.newGroup.create(2) }).click();

  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);
  const groupId = new URL(page.url()).pathname.split('/').pop();
  await expect(page.getByRole('heading', { level: 1, name: groupId })).toBeVisible();
  expect(calls.groupCreates).toBe(1);
  expect(calls.bulks).toEqual([
    {
      jobs: [
        expect.objectContaining({ type: 'email', groupId }),
        expect.objectContaining({ type: 'webhook', groupId }),
      ],
    },
  ]);
  await expect(page.getByRole('link', { name: new RegExp(en.statuses.pending) })).toHaveCount(2);
});

test('Invalid job in another tab: nothing is sent, Job 2 is red and opens with its error', async ({
  page,
}) => {
  const calls = await backend.install({ page, groups: [], jobs: [] });

  await page.goto('/groups/new');
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(en.submit.to, { exact: true }).fill('ops@acme.test');
  await panel.getByLabel(en.submit.subject, { exact: true }).fill('Weekly digest');
  await page.getByRole('button', { name: en.newGroup.addJob }).click();
  await panel.getByLabel(en.submit.to, { exact: true }).fill('not-an-email');
  await page
    .getByRole('tab', { name: en.newGroup.tabLabel(1, en.submit.types.email.name) })
    .click();
  await page.getByRole('button', { name: en.newGroup.create(2) }).click();

  const job2 = page.getByRole('tab', { name: en.newGroup.tabLabel(2, en.submit.types.email.name) });
  await expect(job2).toHaveAttribute('aria-selected', 'true');
  await expect(job2).toHaveAttribute('aria-invalid', 'true');
  await expect(panel.getByText(en.submit.errors.to)).toBeVisible();
  await expect(page).toHaveURL(/\/groups\/new$/);
  expect(calls.groupCreates).toBe(0);
  expect(calls.bulks).toHaveLength(0);
});

test('Group deleted after a failed submit: the empty group is deleted and the error shown', async ({
  page,
}) => {
  const groups: JobGroup[] = [];
  const calls = await backend.install({ page, groups, jobs: [], bulkFails: true });

  await page.goto('/groups/new');
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(en.submit.to, { exact: true }).fill('ops@acme.test');
  await panel.getByLabel(en.submit.subject, { exact: true }).fill('Weekly digest');
  await page.getByRole('button', { name: en.newGroup.create(1) }).click();

  await expect(page.getByRole('alert')).toHaveText('The queue is unavailable');
  await expect(page).toHaveURL(/\/groups\/new$/);
  expect(calls.groupCreates).toBe(1);
  expect(calls.bulks).toHaveLength(1);
  await expect.poll(() => calls.deletes).toEqual([groups[0]?.id]);
  await expect(panel.getByLabel(en.submit.to, { exact: true })).toHaveValue('ops@acme.test');
});
