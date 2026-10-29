import type { ErrorCode } from './error-codes.js';

/** Structured, read-only data that explains an error (ids, limits, offending values). */
export type ErrorDetails = Readonly<Record<string, unknown>>;

export interface DomainErrorParams<TCode extends ErrorCode> {
  code: TCode;
  message: string;
  details?: ErrorDetails;
}

/**
 * Base class for every expected failure. Subclasses fix a stable `code` from `ERROR_CODES`;
 * callers handle errors by class or `code`, never by message.
 */
export abstract class DomainError<TCode extends ErrorCode = ErrorCode> extends Error {
  readonly code: TCode;
  readonly details: ErrorDetails;

  protected constructor(p: DomainErrorParams<TCode>) {
    super(p.message);
    this.name = new.target.name;
    this.code = p.code;
    this.details = Object.freeze({ ...p.details });
  }
}
