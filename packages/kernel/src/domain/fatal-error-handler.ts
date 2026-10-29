/** Handles the error that ended startup or the main loop: report it and fail the process. */
export interface FatalErrorHandler {
  handle(req: HandleFatalErrorHandlerRequest): HandleFatalErrorHandlerResponse;
}

export interface HandleFatalErrorHandlerRequest {
  error: unknown;
}

export type HandleFatalErrorHandlerResponse = Record<string, never>;
