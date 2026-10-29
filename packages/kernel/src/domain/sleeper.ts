/** Port for waiting. Inject it instead of calling `setTimeout`, so retries and backoff test instantly. */
export interface Sleeper {
  /** Resolves after `ms` milliseconds; rejects with `signal.reason` if the signal aborts first. */
  sleep(req: SleepSleeperRequest): Promise<SleepSleeperResponse>;
}

export interface SleepSleeperRequest {
  ms: number;
  signal?: AbortSignal;
}

export type SleepSleeperResponse = Record<string, never>;

export const SLEEPER = Symbol('Sleeper');
