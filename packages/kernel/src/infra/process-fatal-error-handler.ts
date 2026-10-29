import type {
  FatalErrorHandler,
  HandleFatalErrorHandlerRequest,
  HandleFatalErrorHandlerResponse,
} from '../domain/fatal-error-handler.js';

/** The part of `process` that reporting a fatal error needs. */
export interface FatalErrorProcess {
  stderr: { write(chunk: string): unknown };
  exitCode?: number | string | null | undefined;
}

export interface ProcessFatalErrorHandlerDeps {
  process: FatalErrorProcess;
}

/** The logger may not exist yet, so the error goes straight to stderr, and the process fails. */
export class ProcessFatalErrorHandler implements FatalErrorHandler {
  constructor(private readonly d: ProcessFatalErrorHandlerDeps) {}

  handle(req: HandleFatalErrorHandlerRequest): HandleFatalErrorHandlerResponse {
    const { error } = req;
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.d.process.stderr.write(`${text}\n`);
    this.d.process.exitCode = 1;
    return {};
  }
}
