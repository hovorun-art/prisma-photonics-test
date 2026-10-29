import type { SleepSleeperRequest, SleepSleeperResponse } from '../domain/sleeper.js';
import { AbortableSleeper } from './abortable-sleeper.js';

export class SystemSleeper extends AbortableSleeper {
  sleep(req: SleepSleeperRequest): Promise<SleepSleeperResponse> {
    const { ms, signal } = req;
    return new Promise<SleepSleeperResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(this.abortReason(signal));
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(this.abortReason(signal));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve({});
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
