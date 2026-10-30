import type { Job } from '@job-queue/contracts';
import { expect, type Page, test } from '@playwright/test';

import { API_BASE_PATH } from '../../src/config/api-base-path';
import { en } from '../../src/locales/en';

interface MockJobService {
  /** Answers job-ui's API calls from `jobs`; returns the ids it was asked to delete. */
  install(req: { page: Page; jobs: Job[] }): Promise<{ deleted: string[] }>;
  job(req: Partial<Job>): Job;
}

/** An in-memory job-service behind `page.route`: list, get, create and delete. */
class RoutedJobService implements MockJobService {
  async install(req: { page: Page; jobs: Job[] }): Promise<{ deleted: string[] }> {
    const { jobs } = req;
    const deleted: string[] = [];
    await req.page.route(`**${API_BASE_PATH}/v1/jobs**`, async (route) => {
      const request = route.request();
      const id = new URL(request.url()).pathname.split('/v1/jobs/')[1];
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as Pick<Job, 'payload' | 'priority' | 'maxAttempts'>;
        const job = this.job({ id: '99999999-9999-4999-8999-999999999999', ...body });
        jobs.unshift(job);
        return route.fulfill({ status: 201, json: job });
      }
      if (request.method() === 'DELETE' && id) {
        deleted.push(id);
        jobs.splice(
          jobs.findIndex((j) => j.id === id),
          1,
        );
        return route.fulfill({ status: 204 });
      }
      if (id) {
        const job = jobs.find((j) => j.id === id);
        return job
          ? route.fulfill({ json: job })
          : route.fulfill({
              status: 404,
              json: { code: 'JOB_NOT_FOUND', message: 'Job not found', details: { id } },
            });
      }
      return route.fulfill({ json: { items: jobs, total: jobs.length } });
    });
    return { deleted };
  }

  job(req: Partial<Job>): Job {
    return {
      id: '7f3a9c21-4b5d-4e6f-8a7b-9c0d1e2f3a4b',
      type: 'email',
      status: 'pending',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
      result: null,
      error: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-10-29T21:02:09.000Z',
      updatedAt: '2026-10-29T21:02:09.000Z',
      ...req,
    };
  }
}

const api: MockJobService = new RoutedJobService();

test('Start page is the jobs list, a job opens from it and Back returns to the list', async ({
  page,
}) => {
  const job = api.job({});
  await api.install({ page, jobs: [job] });

  await page.goto('/');
  await expect(page).toHaveURL(/\/jobs$/);
  await page.getByRole('link', { name: job.id.slice(0, 8) }).click();
  await expect(page.getByRole('heading', { level: 1, name: job.id })).toBeVisible();
  await page.goBack();

  await expect(page.getByRole('heading', { level: 1, name: en.list.title })).toBeVisible();
});

test('Direct link to a job: /jobs/<id> shows that job', async ({ page }) => {
  const job = api.job({});
  await api.install({ page, jobs: [job] });

  await page.goto(`/jobs/${job.id}`);

  await expect(page.getByRole('heading', { level: 1, name: job.id })).toBeVisible();
});

test('Submit a valid email job: the new job page opens', async ({ page }) => {
  await api.install({ page, jobs: [] });

  await page.goto('/jobs');
  await page.getByRole('link', { name: en.frame.newJob }).first().click();
  await page.getByLabel(en.submit.to, { exact: true }).fill('ops@acme.test');
  await page.getByLabel(en.submit.subject, { exact: true }).fill('Weekly digest');
  await page.getByLabel(en.submit.body, { exact: true }).fill('Hi team');
  await page.getByRole('button', { name: en.submit.submit }).click();

  await expect(page).toHaveURL(/\/jobs\/99999999-9999-4999-8999-999999999999$/);
  await expect(
    page.getByRole('heading', { level: 1, name: '99999999-9999-4999-8999-999999999999' }),
  ).toBeVisible();
});

test('Delete a finished job: confirming deletes it and opens the jobs list', async ({ page }) => {
  const job = api.job({
    status: 'completed',
    attempts: 1,
    startedAt: '2026-10-29T21:02:10.000Z',
    completedAt: '2026-10-29T21:02:12.000Z',
    result: { messageId: 'msg_1' },
  });
  const service = await api.install({ page, jobs: [job] });

  await page.goto(`/jobs/${job.id}`);
  await page.getByRole('button', { name: en.job.deleteJob }).click();
  await page.getByRole('button', { name: en.job.deleteConfirm }).click();

  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page.getByText(en.list.emptyTitle)).toBeVisible();
  expect(service.deleted).toEqual([job.id]);
});
