import { expect, test } from '@playwright/test';

import { stack } from './support/running-stack.js';
import { StackJobs } from './support/stack-jobs.js';
import { EXECUTION_INSTANCES } from './support/stack-settings.js';

const SERVICE = 'job-execution-service';
/** Several times what the stack runs at once, so every instance takes many of them. */
const MANY_JOBS = 60;

test('Instances scaled: every execution instance is healthy', async () => {
  const { containers } = await stack.containers({ service: SERVICE });

  expect(containers).toHaveLength(EXECUTION_INSTANCES);
  for (const container of containers) {
    expect(container).toMatchObject({ state: 'running', health: 'healthy' });
  }
});

test('Instance started: each execution instance logged that it started, under its own instance id', async ({
  request,
}) => {
  const { entries } = await new StackJobs({ request }).logEntries({ service: SERVICE });

  const started = entries.filter(
    (entry) => typeof entry.msg === 'string' && entry.msg.includes('job-execution-service started'),
  );
  expect(started).toHaveLength(EXECUTION_INSTANCES);
  expect(new Set(started.map((entry) => entry.instanceId)).size).toBe(EXECUTION_INSTANCES);
});

test('Many jobs on several instances complete once each: one attempt, picked up by exactly one worker', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const jobs = new StackJobs({ request });
  const { jobs: submitted } = await jobs.submitBulk({
    jobs: Array.from({ length: MANY_JOBS }, (_value, index) => ({
      type: 'email',
      payload: { to: 'ada@example.com', subject: `Once ${index}`, body: 'Hi Ada' },
    })),
  });
  const ids = submitted.map((job) => job.id);

  const { jobs: finished } = await jobs.finished({ ids, timeoutMs: 150_000 });

  for (const job of finished) expect(job).toMatchObject({ status: 'completed', attempts: 1 });
  // The workers' own log: every job was picked up once, and the jobs were spread over instances.
  const pickups = (await jobs.logEntries({ service: SERVICE })).entries.filter(
    (entry) => entry.msg === 'Attempt picked up' && ids.includes(String(entry.jobId)),
  );
  expect(pickups.map((entry) => entry.jobId).sort()).toEqual([...ids].sort());
  expect(new Set(pickups.map((entry) => entry.instanceId)).size).toBeGreaterThan(1);
});
