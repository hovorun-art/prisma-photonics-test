import { JOB_ERROR_CODES } from '@job-queue/contracts';
import { expect, test } from '@playwright/test';

import { stack } from './support/running-stack.js';
import { CONCURRENCY_PER_INSTANCE, StackJobs } from './support/stack-jobs.js';
import { EXECUTION_INSTANCES, STACK_ENV } from './support/stack-settings.js';

/*
 * Tests that break the stack on purpose (a killed instance, a wiped Redis). Their own Playwright
 * project runs them after every other system test, so nothing else sees an instance restarted under
 * a new id or a Redis that lost its data.
 */

const WORKERS = 'job-execution-service';
/** More jobs running than the other instances can hold, so the killed one holds some for sure. */
const BUSY_ENOUGH = CONCURRENCY_PER_INSTANCE * (EXECUTION_INSTANCES - 1) + 1;

test.describe('breaking the stack', () => {
  const emailItem = (subject: string, index: number): Record<string, unknown> => ({
    type: 'email',
    payload: { to: 'ada@example.com', subject: `${subject} ${index}`, body: 'Hi Ada' },
  });

  test("Killed worker's job is recovered on the full system: every job completes, a lost attempt is run again", async ({
    request,
  }) => {
    test.setTimeout(240_000);
    const jobs = new StackJobs({ request });
    const { jobs: submitted } = await jobs.submitBulk({
      jobs: Array.from({ length: 30 }, (_value, index) => emailItem('Survives a crash', index)),
    });
    const ids = submitted.map((job) => job.id);
    const { containers } = await stack.containers({ service: WORKERS });
    const victim = containers[0];
    if (victim === undefined) throw new Error('No execution instance is running');

    try {
      await expect
        .poll(
          async () => {
            const read = await Promise.all(ids.map(async (id) => (await jobs.read({ id })).job));
            return read.filter((job) => job.status === 'processing').length;
          },
          { timeout: 60_000, intervals: [100] },
        )
        .toBeGreaterThanOrEqual(BUSY_ENOUGH);
      await stack.kill({ container: victim.name });

      const { jobs: finished } = await jobs.finished({ ids, timeoutMs: 180_000 });

      for (const job of finished) expect(job).toMatchObject({ status: 'completed', error: null });
      const rerun = finished.filter((job) => job.attempts > 1);
      expect(rerun.length).toBeGreaterThan(0);
      const lost = (await jobs.logEntries({ service: 'job-service' })).entries.filter(
        (entry) => entry.reason === JOB_ERROR_CODES.workerLost && ids.includes(String(entry.jobId)),
      );
      expect(lost.map((entry) => entry.jobId)).toEqual(
        expect.arrayContaining(rerun.map((job) => job.id)),
      );
      // The recovered attempts were all held by the one killed instance, and ran again elsewhere.
      const pickups = (await jobs.logEntries({ service: WORKERS })).entries.filter(
        (entry) => entry.msg === 'Attempt picked up' && rerun.some((job) => job.id === entry.jobId),
      );
      const lostHolders = new Set(
        pickups.filter((entry) => entry.attempt === 1).map((entry) => entry.instanceId),
      );
      const rerunHolders = new Set(
        pickups.filter((entry) => entry.attempt === 2).map((entry) => entry.instanceId),
      );
      expect(lostHolders.size).toBe(1);
      expect([...rerunHolders].some((holder) => lostHolders.has(holder))).toBe(false);
    } finally {
      // Leave every instance up again.
      await stack.start({ service: WORKERS });
    }
  });

  test('Pending job recovers on the full system: jobs whose queue entries were lost are queued again and complete', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const jobs = new StackJobs({ request });
    const { jobs: submitted } = await jobs.submitBulk({
      jobs: Array.from({ length: 40 }, (_value, index) => emailItem('Lost entry', index)),
    });
    const ids = submitted.map((job) => job.id);
    const flushedAt = Date.now();

    // The queue loses everything it held, while most of the jobs still wait.
    await stack.exec({ service: 'redis', command: ['redis-cli', 'FLUSHALL'] });

    const { jobs: finished } = await jobs.finished({ ids, timeoutMs: 150_000 });

    for (const job of finished) {
      expect(job).toMatchObject({ status: 'completed', attempts: 1, error: null });
    }
    const requeued = (await jobs.logEntries({ service: 'job-service' })).entries.filter(
      (entry) =>
        entry.msg === 'Recovery: waiting job queued again' && ids.includes(String(entry.jobId)),
    );
    expect(requeued.length).toBeGreaterThan(0);
    // Within one interval plus the minimum age of the loss (plus a margin for a pass in progress).
    const firstRequeueAt = Math.min(...requeued.map((entry) => Number(entry.time)));
    const bound =
      Number(STACK_ENV.JOB_SERVICE_RECOVERY_INTERVAL_MS) +
      Number(STACK_ENV.JOB_SERVICE_RECOVERY_MIN_AGE_MS) +
      5_000;
    expect(firstRequeueAt - flushedAt).toBeLessThanOrEqual(bound);
  });
});
