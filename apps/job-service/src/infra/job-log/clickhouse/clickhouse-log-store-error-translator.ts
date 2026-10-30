import { ClickHouseError } from '@clickhouse/client';

import { LogStoreUnavailableError } from '../../../domain/job-log/errors/log-store-unavailable.error.js';
import type {
  LogStoreErrorTranslator,
  TranslateLogStoreErrorRequest,
  TranslateLogStoreErrorResponse,
} from '../../../domain/job-log/log-store-error-translator.js';

/** System error codes of a connection that was refused, dropped, timed out or could not be made. */
const CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * The client raises its request timeout as a plain `Error` with this text, with no class or code
 * of its own; it is the one failure that can only be told by its message.
 */
const CLIENT_TIMEOUT_MESSAGE = 'Timeout error.';

/** Tells the ClickHouse client's connection errors and timeouts from every other failure. */
export class ClickHouseLogStoreErrorTranslator implements LogStoreErrorTranslator {
  translate(req: TranslateLogStoreErrorRequest): TranslateLogStoreErrorResponse {
    return {
      error: this.isUnavailable(req.error)
        ? new LogStoreUnavailableError({ operation: req.operation })
        : req.error,
    };
  }

  private isUnavailable(error: unknown): boolean {
    // An answer from the server, even a failure, means it was reached.
    if (error instanceof ClickHouseError || !(error instanceof Error)) return false;
    if (error instanceof AggregateError && error.errors.some((e) => this.isUnavailable(e))) {
      return true;
    }
    const { code } = error as { code?: unknown };
    if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return true;
    return error.message === CLIENT_TIMEOUT_MESSAGE;
  }
}
