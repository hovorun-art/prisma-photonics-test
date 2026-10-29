import type { EventEmitter } from 'node:events';

export const TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT'] as const;
export type TerminationSignal = (typeof TERMINATION_SIGNALS)[number];

/**
 * On a termination signal: run the extra steps, close the app and let the process end with a
 * success code, or a failure code if a step or the close failed. A second signal while stopping
 * changes nothing.
 */
export interface GracefulShutdown {
  install(): InstallGracefulShutdownResponse;
}

export type InstallGracefulShutdownResponse = Record<string, never>;

/** Extra work to do before the app is closed (flush a buffer, stop taking jobs). */
export interface ShutdownStep {
  /** Names the step in the log when it fails. */
  readonly name: string;
  run(): Promise<RunShutdownStepResponse>;
}

export type RunShutdownStepResponse = Record<string, never>;

/** Where the shutdown writes what it does. */
export interface ShutdownLog {
  info(req: InfoShutdownLogRequest): InfoShutdownLogResponse;
  error(req: ErrorShutdownLogRequest): ErrorShutdownLogResponse;
}

export interface InfoShutdownLogRequest {
  message: string;
}
export type InfoShutdownLogResponse = Record<string, never>;

export interface ErrorShutdownLogRequest {
  message: string;
  err: unknown;
}
export type ErrorShutdownLogResponse = Record<string, never>;

/** The part of `process` that shutdown needs: its signals and its exit code. */
export type ShutdownProcess = Pick<EventEmitter, 'once'> & {
  exitCode?: number | string | null | undefined;
};
