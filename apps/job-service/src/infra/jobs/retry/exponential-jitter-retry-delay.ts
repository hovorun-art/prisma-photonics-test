import type { Random } from '@job-queue/kernel';

import type {
  OfRetryDelayRequest,
  OfRetryDelayResponse,
  RetryDelay,
} from '../../../domain/jobs/retry-delay.js';

export interface ExponentialJitterRetryDelayDeps {
  random: Random;
}

export interface ExponentialJitterRetryDelayParams {
  /** The first retry waits at least this long. */
  minMs: number;
  /** The first retry waits at most this long. */
  maxMs: number;
  /** No retry waits longer than this, whatever its number. */
  capMs: number;
}

/**
 * Retry n waits a random time in [min, max] × 2^(n−1), each bound capped. The jitter spreads the
 * retries of jobs that failed together so they do not return together.
 */
export class ExponentialJitterRetryDelay implements RetryDelay {
  constructor(
    private readonly d: ExponentialJitterRetryDelayDeps,
    private readonly p: ExponentialJitterRetryDelayParams,
  ) {}

  of(req: OfRetryDelayRequest): OfRetryDelayResponse {
    const growth = 2 ** (req.retry - 1);
    const { value } = this.d.random.int({
      min: Math.min(this.p.minMs * growth, this.p.capMs),
      max: Math.min(this.p.maxMs * growth, this.p.capMs),
    });
    return { delayMs: value };
  }
}
