import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SystemSleeper } from './system-sleeper.js';

describe('SystemSleeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the requested delay', async () => {
    const sleeper = new SystemSleeper();
    let done = false;
    const sleeping = sleeper.sleep({ ms: 1_000 }).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(done).toBe(true);
  });

  it('rejects with the abort reason and clears its timer when aborted while sleeping', async () => {
    const sleeper = new SystemSleeper();
    const controller = new AbortController();
    const reason = new Error('shutting down');

    const sleeping = sleeper.sleep({ ms: 10_000, signal: controller.signal });
    controller.abort(reason);

    await expect(sleeping).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at once without starting a timer when the signal is already aborted', async () => {
    const sleeper = new SystemSleeper();
    const reason = new Error('already stopped');

    await expect(sleeper.sleep({ ms: 10_000, signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
