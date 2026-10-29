import { describe, expect, it } from 'vitest';

import type { SleepSleeperRequest, SleepSleeperResponse } from '../domain/sleeper.js';
import { AbortableSleeper } from './abortable-sleeper.js';

/** Rejects at once with the abort reason, to check how AbortableSleeper turns reasons into errors. */
class RejectingSleeper extends AbortableSleeper {
  sleep(req: SleepSleeperRequest): Promise<SleepSleeperResponse> {
    return Promise.reject(this.abortReason(req.signal));
  }
}

describe('AbortableSleeper', () => {
  it('passes an Error abort reason on unchanged', async () => {
    const reason = new Error('stop');

    await expect(
      new RejectingSleeper().sleep({ ms: 1, signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });

  it('wraps a non-Error abort reason in an Error that keeps it as the cause', async () => {
    const error: unknown = await new RejectingSleeper()
      .sleep({ ms: 1, signal: AbortSignal.abort('stop') })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBe('stop');
  });
});
