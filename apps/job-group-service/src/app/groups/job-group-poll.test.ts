import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import type {
  CheckRunningJobGroupTrackerResponse,
  JobGroupTracker,
} from '../../domain/groups/job-group-tracker.js';
import { JOB_GROUP_POLL_INTERVAL_NAME, JobGroupPoll } from './job-group-poll.js';

const INTERVAL_MS = 1_000;
const CHECKED: CheckRunningJobGroupTrackerResponse = { checked: 1, failedChecks: 0 };

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

  it('checks the running groups once per configured interval after bootstrap', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error');
    tracker.checkRunning.mockResolvedValueOnce(CHECKED).mockResolvedValueOnce(CHECKED);

    poll.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(tracker.checkRunning).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(tracker.checkRunning).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(tracker.checkRunning).toHaveBeenCalledTimes(2);
    expect(registry.getIntervals()).toEqual([JOB_GROUP_POLL_INTERVAL_NAME]);
    expect(logged).not.toHaveBeenCalled();
  });

  it('skips a tick while the previous check is still running', async () => {
    let finish: (value: CheckRunningJobGroupTrackerResponse) => void = () => undefined;
    tracker.checkRunning
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(CHECKED);

    poll.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(tracker.checkRunning).toHaveBeenCalledOnce();

    finish(CHECKED);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(tracker.checkRunning).toHaveBeenCalledTimes(2);
  });

  it('logs a failed check and still runs the next tick', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementationOnce(() => undefined);
    const failure = new Error('database gone');
    tracker.checkRunning.mockRejectedValueOnce(failure).mockResolvedValueOnce(CHECKED);

    poll.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: failure }),
      expect.any(String),
    );
    expect(tracker.checkRunning).toHaveBeenCalledTimes(2);
  });

  it('stops the interval on shutdown and waits for the check in flight', async () => {
    let finish: (value: CheckRunningJobGroupTrackerResponse) => void = () => undefined;
    tracker.checkRunning.mockImplementationOnce(
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
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(tracker.checkRunning).toHaveBeenCalledOnce();
  });

  it('stops at once when no check is running, and checks nothing afterwards', async () => {
    poll.onApplicationBootstrap();

    await expect(poll.onModuleDestroy()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(registry.getIntervals()).toEqual([]);
    expect(tracker.checkRunning).not.toHaveBeenCalled();
  });

  it('stops cleanly when the check in flight fails during shutdown, and logs it', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementationOnce(() => undefined);
    const failure = new Error('database closed');
    let fail: (error: Error) => void = () => undefined;
    tracker.checkRunning.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    poll.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    const stopping = poll.onModuleDestroy();
    fail(failure);

    await expect(stopping).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: failure }),
      expect.any(String),
    );
  });

  it('stops cleanly when it never started', async () => {
    await expect(poll.onModuleDestroy()).resolves.toBeUndefined();
  });
});
