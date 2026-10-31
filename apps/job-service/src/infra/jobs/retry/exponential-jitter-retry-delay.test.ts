import type { Random } from '@job-queue/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { ExponentialJitterRetryDelay } from './exponential-jitter-retry-delay.js';

const PARAMS = { minMs: 5_000, maxMs: 30_000, capMs: 120_000 };

describe('ExponentialJitterRetryDelay', () => {
  let random: DeepMockProxy<Random>;
  let delay: ExponentialJitterRetryDelay;

  beforeEach(() => {
    random = mockDeep<Random>();
    delay = new ExponentialJitterRetryDelay({ random }, PARAMS);
  });

  it('Delay of the first retry is drawn between the configured minimum and maximum', () => {
    random.int.mockReturnValueOnce({ value: 12_345 });

    const { delayMs } = delay.of({ retry: 1 });

    expect(random.int).toHaveBeenCalledExactlyOnceWith({ min: 5_000, max: 30_000 });
    expect(delayMs).toBe(12_345);
  });

  it('Delay grows with each retry: retry 2 and 3 double the bounds each time', () => {
    random.int.mockReturnValueOnce({ value: 1 });
    random.int.mockReturnValueOnce({ value: 2 });

    delay.of({ retry: 2 });
    delay.of({ retry: 3 });

    expect(random.int).toHaveBeenNthCalledWith(1, { min: 10_000, max: 60_000 });
    expect(random.int).toHaveBeenNthCalledWith(2, { min: 20_000, max: 120_000 });
  });

  it('Delay is capped: both bounds stop at the cap', () => {
    random.int.mockReturnValueOnce({ value: 120_000 });
    random.int.mockReturnValueOnce({ value: 120_000 });

    delay.of({ retry: 4 });
    delay.of({ retry: 9 });

    expect(random.int).toHaveBeenNthCalledWith(1, { min: 40_000, max: 120_000 });
    expect(random.int).toHaveBeenNthCalledWith(2, { min: 120_000, max: 120_000 });
  });
});
