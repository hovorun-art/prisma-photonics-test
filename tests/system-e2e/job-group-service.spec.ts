import {
  CreateJobsBulkResponse,
  ErrorBody,
  JOB_GROUPS_ROUTE,
  JOBS_BULK_ROUTE,
  JOBS_ROUTE,
  Job,
  JobGroup,
  QueryJobsResponse,
} from '@job-queue/contracts';
import { expect, test } from '@playwright/test';

import { JOB_GROUP_SERVICE_URL, JOB_SERVICE_URL } from './support/stack-settings.js';

const EMAILS = 3;

const EMAIL_PAYLOAD = { to: 'reader@example.com', subject: 'Campaign', body: 'Hello' };

/**
 * Before each test, a job outside any group: a job-service that ignored the `groupId` filter would
 * make the group count it (or refuse the delete), and the test would fail.
 */
test.beforeEach(async ({ request }) => {
  const response = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
    data: { type: 'email', payload: EMAIL_PAYLOAD },
  });
  expect(response.status()).toBe(201);
  expect(Job.parse(await response.json()).groupId).toBeNull();
});

test('All children completed: a group follows its real email jobs through job-service to completed', async ({
  request,
}) => {
  const created = await request.post(`${JOB_GROUP_SERVICE_URL}${JOB_GROUPS_ROUTE}`);
  expect(created.status()).toBe(201);
  const group = JobGroup.parse(await created.json());

  const submitted = await request.post(`${JOB_SERVICE_URL}${JOBS_BULK_ROUTE}`, {
    data: {
      jobs: Array.from({ length: EMAILS }, () => ({
        type: 'email',
        groupId: group.id,
        payload: EMAIL_PAYLOAD,
      })),
    },
  });
  expect(submitted.status()).toBe(201);
  expect(CreateJobsBulkResponse.parse(await submitted.json()).items).toHaveLength(EMAILS);

  const read = async (): Promise<JobGroup> =>
    JobGroup.parse(
      await (await request.get(`${JOB_GROUP_SERVICE_URL}${JOB_GROUPS_ROUTE}/${group.id}`)).json(),
    );
  await expect.poll(async () => (await read()).status, { timeout: 60_000 }).toBe('completed');

  const finished = await read();
  expect(finished).toMatchObject({ total: EMAILS, completed: EMAILS, failed: 0 });
  expect(finished.checkedAt).not.toBeNull();
  expect(finished.finishedAt).not.toBeNull();
  const children = QueryJobsResponse.parse(
    await (await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}?groupId=${group.id}`)).json(),
  );
  expect(children.total).toBe(EMAILS);
  expect(children.items.every((job) => job.status === 'completed')).toBe(true);
});

test('Group whose submit failed: the bulk is rejected and the still-empty group is deleted', async ({
  request,
}) => {
  const group = JobGroup.parse(
    await (await request.post(`${JOB_GROUP_SERVICE_URL}${JOB_GROUPS_ROUTE}`)).json(),
  );

  const rejected = await request.post(`${JOB_SERVICE_URL}${JOBS_BULK_ROUTE}`, {
    data: { jobs: [{ type: 'email', groupId: group.id, payload: { to: 'not-an-email' } }] },
  });
  expect(rejected.status()).toBe(400);

  const deleted = await request.delete(`${JOB_GROUP_SERVICE_URL}${JOB_GROUPS_ROUTE}/${group.id}`);
  expect(deleted.status()).toBe(204);
  const gone = await request.get(`${JOB_GROUP_SERVICE_URL}${JOB_GROUPS_ROUTE}/${group.id}`);
  expect(gone.status()).toBe(404);
  expect(ErrorBody.parse(await gone.json()).code).toBe('JOB_GROUP_NOT_FOUND');
});
