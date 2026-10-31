import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import type { JobRecovery, RunJobRecoveryResponse } from '../../domain/jobs/job-recovery.js';
import { JOB_RECOVERY_INTERVAL_NAME, JobRecoverySchedule } from './job-recovery-schedule.js';

const INTERVAL_MS = 30_000;
const NOTHING: RunJobRecoveryResponse = { requeued: 0, lostWorkers: 0, timedOut: 0 };

// How ticks are skipped, failures logged and shutdown awaited is SchedulerIntervalTask's
// (service-kit); these tests show the recovery pass is wired to it.
describe('JobRecoverySchedule', () => {
  const recovery = mockDeep<JobRecovery>();
  let registry: SchedulerRegistry;
  let schedule: JobRecoverySchedule;

  beforeEach(() => {
    mockReset(recovery);
    vi.useFakeTimers();
    registry = new SchedulerRegistry();
    schedule = new JobRecoverySchedule(recovery, registry, {
      recovery: { intervalMs: INTERVAL_MS, minAgeMs: 30_000, batchSize: 100 },
    });
  });
  afterEach(async () => {
    await schedule.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Recovery runs at the configured interval: one pass per interval, the next after another interval', async () => {
    recovery.run.mockResolvedValueOnce(NOTHING).mockResolvedValueOnce(NOTHING);

    schedule.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(recovery.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(recovery.run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(recovery.run).toHaveBeenCalledTimes(2);
    expect(registry.getIntervals()).toEqual([JOB_RECOVERY_INTERVAL_NAME]);
  });

  it('logs a failed pass as the recovery pass', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementationOnce(() => undefined);
    const failure = new Error('database gone');
    recovery.run.mockRejectedValueOnce(failure);

    schedule.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: failure }),
      'Recovery pass failed',
    );
  });

  it('stops on shutdown and waits for the pass in flight', async () => {
    let finish: (value: RunJobRecoveryResponse) => void = () => undefined;
    recovery.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    schedule.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    let stopped = false;
    const stopping = schedule.onModuleDestroy().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    expect(registry.getIntervals()).toEqual([]);

    finish(NOTHING);
    await stopping;
    expect(stopped).toBe(true);
  });
});
