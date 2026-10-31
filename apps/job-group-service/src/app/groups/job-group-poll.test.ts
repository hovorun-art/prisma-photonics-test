import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import type {
  CheckOpenJobGroupTrackerResponse,
  JobGroupTracker,
} from '../../domain/groups/job-group-tracker.js';
import { JOB_GROUP_POLL_INTERVAL_NAME, JobGroupPoll } from './job-group-poll.js';

const INTERVAL_MS = 1_000;
const CHECKED: CheckOpenJobGroupTrackerResponse = { checked: 1, failedChecks: 0 };

// How ticks are skipped, failures logged and shutdown awaited is SchedulerIntervalTask's
// (service-kit); these tests show the poll is wired to it.
describe('JobGroupPoll', () => {
  const tracker = mockDeep<JobGroupTracker>();
  let registry: SchedulerRegistry;
  let poll: JobGroupPoll;

  beforeEach(() => {
    mockReset(tracker);
    vi.useFakeTimers();
    registry = new SchedulerRegistry();
    poll = new JobGroupPoll(tracker, registry, { pollIntervalMs: INTERVAL_MS });
  });
  afterEach(async () => {
    await poll.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks the running groups once per configured interval after bootstrap, under its name', async () => {
    tracker.checkOpen.mockResolvedValueOnce(CHECKED).mockResolvedValueOnce(CHECKED);

    poll.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(tracker.checkOpen).toHaveBeenCalledTimes(2);
    expect(registry.getIntervals()).toEqual([JOB_GROUP_POLL_INTERVAL_NAME]);
  });

  it('logs a failed check as the job group poll', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementationOnce(() => undefined);
    const failure = new Error('database gone');
    tracker.checkOpen.mockRejectedValueOnce(failure);

    poll.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: failure }),
      'Job group poll failed',
    );
  });

  it('stops on shutdown and waits for the check in flight', async () => {
    let finish: (value: CheckOpenJobGroupTrackerResponse) => void = () => undefined;
    tracker.checkOpen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    poll.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    let stopped = false;
    const stopping = poll.onModuleDestroy().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    expect(registry.getIntervals()).toEqual([]);

    finish(CHECKED);
    await stopping;
    expect(stopped).toBe(true);
  });
});
