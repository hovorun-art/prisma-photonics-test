import type { SleepSleeperRequest, SleepSleeperResponse, Sleeper } from '../domain/sleeper.js';

/** A Sleeper that rejects with the abort reason of its signal, always as an Error. */
export abstract class AbortableSleeper implements Sleeper {
  abstract sleep(req: SleepSleeperRequest): Promise<SleepSleeperResponse>;

  /** The reason of an `AbortSignal` is typed `any`; wrap anything that is not an Error. */
  protected abortReason(signal: AbortSignal | undefined): Error {
    const reason: unknown = signal?.reason;
    return reason instanceof Error ? reason : new Error('Aborted', { cause: reason });
  }
}
