import { randomUUID } from 'node:crypto';

import type { ChangeJobStatusRequest, CreateJobRequest, Job } from '@job-queue/contracts';
import { expect, type Page, test } from '@playwright/test';

import { API_BASE_PATH } from '../../src/config/api-base-path';
import { en } from '../../src/locales/en';

/** What the mock job-service was asked to change: the ids deleted and the status changes. */
interface MockJobServiceCalls {
  deleted: string[];
  statusChanges: { id: string; status: ChangeJobStatusRequest['status'] }[];
}

interface MockJobService {
  /** Answers job-ui's API calls from `jobs`; returns what it was asked to change. */
  install(req: { page: Page; jobs: Job[] }): Promise<MockJobServiceCalls>;
  job(req: Partial<Job>): Job;
}

/**
 * An in-memory job-service behind `page.route`: list (with the status and type filters), get,
 * create, status change (cancel, retry) and delete.
 */
class RoutedJobService implements MockJobService {
  async install(req: { page: Page; jobs: Job[] }): Promise<MockJobServiceCalls> {
    const { jobs } = req;
    const deleted: string[] = [];
    const statusChanges: MockJobServiceCalls['statusChanges'] = [];
    // Statistics are not part of these scenarios: refuse them, so no call reaches the preview server.
    await req.page.route(`**${API_BASE_PATH}/v1/stats**`, (route) => route.abort());
    await req.page.route(`**${API_BASE_PATH}/v1/jobs**`, async (route) => {
      const request = route.request();
      const id = new URL(request.url()).pathname.split('/v1/jobs/')[1];
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as CreateJobRequest;
        const job = this.job({ id: CREATED_ID, ...body });
        jobs.unshift(job);
        return route.fulfill({ status: 201, json: job });
      }
      if (request.method() === 'PATCH' && id) {
        const { status } = request.postDataJSON() as ChangeJobStatusRequest;
        statusChanges.push({ id, status });
        const index = jobs.findIndex((j) => j.id === id);
        const changed =
          status === 'cancelled'
            ? { ...jobs[index]!, status }
            : {
                ...jobs[index]!,
                status,
                attempts: 0,
                result: null,
                error: null,
                startedAt: null,
                completedAt: null,
              };
        jobs[index] = changed;
        return route.fulfill({ json: changed });
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
      const params = new URL(request.url()).searchParams;
      const status = params.get('status');
      const type = params.get('type');
      const matching = jobs.filter(
        (j) => (status === null || j.status === status) && (type === null || j.type === type),
      );
      return route.fulfill({ json: { items: matching, total: matching.length } });
    });
    return { deleted, statusChanges };
  }

  job(req: Partial<Job>): Job {
    // A partial of either job type over an email job: the caller keeps type and payload in step.
    return {
      id: randomUUID(),
      type: 'email',
      status: 'pending',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
      result: null,
      error: null,
      groupId: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-10-29T21:02:09.000Z',
      updatedAt: '2026-10-29T21:02:09.000Z',
      ...req,
    } as Job;
  }
}

/** The id the mock job-service gives the next job it creates. */
const CREATED_ID = randomUUID();

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

  await expect(page).toHaveURL(new RegExp(`/jobs/${CREATED_ID}$`));
  await expect(page.getByRole('heading', { level: 1, name: CREATED_ID })).toBeVisible();
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

test('Cancel a pending job: confirming in the dialog shows the job cancelled', async ({ page }) => {
  const job = api.job({});
  const service = await api.install({ page, jobs: [job] });

  await page.goto(`/jobs/${job.id}`);
  await page.getByRole('button', { name: en.job.cancelJob }).click();
  const dialog = page.getByRole('dialog', { name: en.job.cancelTitle });
  await dialog.getByRole('button', { name: en.job.cancelConfirm }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(en.statuses.cancelled).first()).toBeVisible();
  await expect(page.getByRole('button', { name: en.job.cancelJob })).toBeHidden();
  expect(service.statusChanges).toEqual([{ id: job.id, status: 'cancelled' }]);
});

test('Retry a failed job: one click shows the job pending again', async ({ page }) => {
  const job = api.job({
    status: 'failed',
    attempts: 3,
    startedAt: '2026-10-29T21:02:10.000Z',
    completedAt: '2026-10-29T21:02:12.000Z',
    error: { code: 'EMAIL_SEND_FAILED', message: 'SMTP timeout' },
  });
  const service = await api.install({ page, jobs: [job] });

  await page.goto(`/jobs/${job.id}`);
  await page.getByRole('button', { name: en.job.retryJob }).click();

  await expect(page.getByText(en.statuses.pending).first()).toBeVisible();
  await expect(page.getByRole('button', { name: en.job.retryJob })).toBeHidden();
  expect(service.statusChanges).toEqual([{ id: job.id, status: 'pending' }]);
});

test('Submit a valid webhook job: the new job page shows the webhook payload', async ({ page }) => {
  await api.install({ page, jobs: [] });

  await page.goto('/jobs/new');
  await page.getByRole('button', { name: /^Webhook/ }).click();
  await expect(page).toHaveURL(/\/jobs\/new\?type=webhook$/);
  await page.getByLabel(en.submit.method, { exact: true }).selectOption('PUT');
  await page.getByLabel(en.submit.url, { exact: true }).fill('https://hooks.example.com/orders');
  await page.getByLabel(en.submit.jsonBody, { exact: true }).fill('{"orderId": "o-1"}');
  await page.getByRole('button', { name: en.submit.submit }).click();

  await expect(page).toHaveURL(new RegExp(`/jobs/${CREATED_ID}$`));
  const payload = page.getByRole('region', { name: en.job.payload });
  await expect(payload).toContainText('"method": "PUT"');
  await expect(payload).toContainText('"url": "https://hooks.example.com/orders"');
  await expect(payload).toContainText('"orderId": "o-1"');
});

const FAILED_ID = randomUUID();
const PENDING_ID = randomUUID();
const COMPLETED_ID = randomUUID();

test('Reload keeps the filters: after a reload Failed is still pressed and only failed jobs show', async ({
  page,
}) => {
  const failed = api.job({
    id: FAILED_ID,
    status: 'failed',
    attempts: 3,
    error: { code: 'SEND_FAILED', message: 'Mailbox unavailable' },
  });
  const pending = api.job({ id: PENDING_ID });
  await api.install({ page, jobs: [failed, pending] });
  await page.goto('/jobs');
  const statusFilter = page.getByRole('group', { name: en.list.filterByStatus });
  await statusFilter.getByRole('button', { name: /^Failed/ }).click();
  await expect(page).toHaveURL(/\/jobs\?status=failed$/);

  await page.reload();

  await expect(statusFilter.getByRole('button', { name: /^Failed/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: FAILED_ID.slice(0, 8) })).toBeVisible();
  await expect(page.getByRole('link', { name: PENDING_ID.slice(0, 8) })).toHaveCount(0);
});

test('Back restores the previous filter: Failed, then Completed, then Back shows Failed again', async ({
  page,
}) => {
  const failed = api.job({
    id: FAILED_ID,
    status: 'failed',
    attempts: 3,
    error: { code: 'SEND_FAILED', message: 'Mailbox unavailable' },
  });
  const completed = api.job({
    id: COMPLETED_ID,
    status: 'completed',
    attempts: 1,
    result: { messageId: 'msg_1' },
  });
  await api.install({ page, jobs: [failed, completed] });
  await page.goto('/jobs');
  const statusFilter = page.getByRole('group', { name: en.list.filterByStatus });
  await statusFilter.getByRole('button', { name: /^Failed/ }).click();
  await expect(page.getByRole('link', { name: COMPLETED_ID.slice(0, 8) })).toHaveCount(0);
  await statusFilter.getByRole('button', { name: /^Completed/ }).click();
  await expect(page.getByRole('link', { name: FAILED_ID.slice(0, 8) })).toHaveCount(0);

  await page.goBack();

  await expect(page).toHaveURL(/\/jobs\?status=failed$/);
  await expect(statusFilter.getByRole('button', { name: /^Failed/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: FAILED_ID.slice(0, 8) })).toBeVisible();
  await expect(page.getByRole('link', { name: COMPLETED_ID.slice(0, 8) })).toHaveCount(0);
});
