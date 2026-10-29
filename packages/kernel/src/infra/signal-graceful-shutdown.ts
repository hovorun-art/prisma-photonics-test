import type { Closable } from '../domain/closable.js';
import {
  type GracefulShutdown,
  type InstallGracefulShutdownResponse,
  type ShutdownLog,
  type ShutdownProcess,
  type ShutdownStep,
  type TerminationSignal,
} from '../domain/graceful-shutdown.js';

export interface SignalGracefulShutdownDeps {
  app: Closable;
  process: ShutdownProcess;
  log: ShutdownLog;
}

export interface SignalGracefulShutdownParams {
  /** The signals that start the shutdown. */
  signals: readonly TerminationSignal[];
  /** Run in order before the app is closed. */
  steps: readonly ShutdownStep[];
}

/**
 * On the first termination signal: log it, run the extra steps, close the app and let the process
 * end with exit code 0, or 1 if a step or the close failed (the app is closed even after a failed
 * step). Later signals change nothing. Node's default signal handling, or Nest's
 * `enableShutdownHooks()`, would end the process by re-raising the signal instead of a success code.
 */
export class SignalGracefulShutdown implements GracefulShutdown {
  private stopping = false;

  constructor(
    private readonly d: SignalGracefulShutdownDeps,
    private readonly p: SignalGracefulShutdownParams,
  ) {}

  install(): InstallGracefulShutdownResponse {
    for (const signal of this.p.signals) {
      this.d.process.once(signal, () => {
        this.stop(signal);
      });
    }
    return {};
  }

  private stop(signal: TerminationSignal): void {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    this.d.log.info({ message: `Received ${signal}, shutting down` });
    void this.shutDown().then((exitCode) => {
      this.d.process.exitCode = exitCode;
    });
  }

  /** Never rejects: a failure is logged and becomes exit code 1. */
  private async shutDown(): Promise<number> {
    let exitCode = 0;
    for (const step of this.p.steps) {
      try {
        await step.run();
      } catch (err) {
        this.d.log.error({ message: `Shutdown step ${step.name} failed`, err });
        exitCode = 1;
      }
    }
    try {
      await this.d.app.close();
    } catch (err) {
      this.d.log.error({ message: 'Graceful shutdown failed', err });
      exitCode = 1;
    }
    return exitCode;
  }
}
