import type { LoggerService } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import { SchedulerIntervalTask } from './scheduler-interval-task.js';

const NAME = 'recovery';
const INTERVAL_MS = 1_000;
const FAILURE_MESSAGE = 'Recovery pass failed';

describe('SchedulerIntervalTask', () => {
  let work: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  let logger: ReturnType<typeof mockDeep<Pick<LoggerService, 'error'>>>;
  let registry: SchedulerRegistry;
  let task: SchedulerIntervalTask;

  beforeEach(() => {
    vi.useFakeTimers();
    work = vi.fn<() => Promise<unknown>>();
    logger = mockDeep<Pick<LoggerService, 'error'>>();
    registry = new SchedulerRegistry();
    task = new SchedulerIntervalTask(
      { scheduler: registry, logger, work },
      { name: NAME, intervalMs: INTERVAL_MS, failureMessage: FAILURE_MESSAGE },
    );
  });
  afterEach(async () => {
    await task.stop();
    vi.useRealTimers();
  });

  it('runs the work once per configured interval after it starts, under its name', async () => {
    work.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

    expect(task.start()).toEqual({});
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(work).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(work).toHaveBeenCalledTimes(2);
    expect(registry.getIntervals()).toEqual([NAME]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('skips a tick while the previous run is still going', async () => {
    let finish: () => void = () => undefined;
    work
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);

    task.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(work).toHaveBeenCalledOnce();

    finish();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(work).toHaveBeenCalledTimes(2);
  });

  it('logs a failed run with its message and still runs the next tick', async () => {
    const failure = new Error('database gone');
    work.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);

    task.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: failure }),
      FAILURE_MESSAGE,
    );
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('stops the interval and waits for the run in flight', async () => {
    let finish: () => void = () => undefined;
    work.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    task.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    let stopped = false;
    const stopping = task.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    expect(registry.getIntervals()).toEqual([]);

    finish();
    await stopping;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(work).toHaveBeenCalledOnce();
  });

  it('stops at once when no run is going, and runs nothing afterwards', async () => {
    task.start();

    await expect(task.stop()).resolves.toEqual({});
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(registry.getIntervals()).toEqual([]);
    expect(work).not.toHaveBeenCalled();
  });

  it('stops cleanly when the run in flight fails during the stop, and logs it', async () => {
    const failure = new Error('database closed');
    let fail: (error: Error) => void = () => undefined;
    work.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    task.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    const stopping = task.stop();
    fail(failure);

    await expect(stopping).resolves.toEqual({});
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: failure }),
      FAILURE_MESSAGE,
    );
  });

  it('stops cleanly when it never started', async () => {
    await expect(task.stop()).resolves.toEqual({});
  });
});
