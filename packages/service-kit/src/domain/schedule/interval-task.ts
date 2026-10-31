/**
 * Work run again and again at a fixed interval, once started: a tick is skipped while the previous
 * run still goes on, and a failed run is logged and tried again at the next tick. `stop` ends the
 * interval and waits for the run in flight, so a service can stop it before it closes what the
 * work uses (the database).
 */
export interface IntervalTask {
  start(): StartIntervalTaskResponse;
  stop(): Promise<StopIntervalTaskResponse>;
}

export type StartIntervalTaskResponse = Record<string, never>;

export type StopIntervalTaskResponse = Record<string, never>;
