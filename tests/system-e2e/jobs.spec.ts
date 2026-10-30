import { EmailJobResult, JOBS_ROUTE, Job } from '@job-queue/contracts';
import { expect, test } from '@playwright/test';

import { JOB_SERVICE_URL } from './support/stack-settings.js';

test('Submitted email job completes end to end: API, Postgres, queue, execution, Postgres', async ({
  request,
}) => {
  const submitted = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
    data: {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
    },
  });
  expect(submitted.status()).toBe(201);
  const { id } = Job.parse(await submitted.json());

  const read = async (): Promise<Job> =>
    Job.parse(await (await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}`)).json());

  await expect.poll(async () => (await read()).status, { timeout: 30_000 }).toBe('completed');
  const job = await read();
  expect(EmailJobResult.parse(job.result).messageId).toEqual(expect.any(String));
  expect(job.attempts).toBe(1);
});
