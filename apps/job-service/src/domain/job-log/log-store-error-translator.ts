/**
 * Decides what a failure of the job log store's client means: a store that cannot be reached
 * becomes `LogStoreUnavailableError`; any other failure (a rejected query, a missing table, a
 * bug) is returned unchanged, so it is not mistaken for an outage.
 */
export interface LogStoreErrorTranslator {
  translate(req: TranslateLogStoreErrorRequest): TranslateLogStoreErrorResponse;
}

export interface TranslateLogStoreErrorRequest {
  error: unknown;
  /** What the caller tried: storing a batch, reading a log, or applying the schema. */
  operation: 'insert' | 'query' | 'schema';
}

export interface TranslateLogStoreErrorResponse {
  /** The error to throw. */
  error: unknown;
}
