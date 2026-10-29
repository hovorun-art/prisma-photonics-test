import type { Closable, FatalErrorProcess, ShutdownProcess } from '@job-queue/kernel';

/** The settings the bootstrap itself needs from a service's config. */
export interface BootstrapConfig {
  /** 0 picks a free port. */
  readonly port: number;
}

/** Starts a service: config, application, shutdown handling, listening. */
export interface ServiceBootstrap {
  /**
   * An invalid configuration is written to stderr, sets exit code 1 and gives `started: false`
   * (nothing is thrown); any other failure rejects.
   */
  start(): Promise<StartServiceBootstrapResponse>;
}

export type StartServiceBootstrapResponse =
  { started: true; service: StartedService } | { started: false };

export interface StartedService extends Closable {
  /** Base URL the service answers on. */
  readonly url: string;
}

/** An extra step of one service's setup, run once the app exists and before it listens. */
export interface ServiceSetupStep<TApp> {
  apply(req: ApplyServiceSetupStepRequest<TApp>): ApplyServiceSetupStepResponse;
}

export interface ApplyServiceSetupStepRequest<TApp> {
  app: TApp;
}

export type ApplyServiceSetupStepResponse = Record<string, never>;

/** The part of `process` the bootstrap uses: stderr, the exit code and the termination signals. */
export type BootstrapProcess = ShutdownProcess & FatalErrorProcess;
