/**
 * Creates the job log store's table when it is missing and sets its retention to the configured
 * period; safe to call on every start. Throws `LogStoreUnavailableError` when the store cannot be
 * reached.
 */
export interface JobLogSchema {
  apply(): Promise<ApplyJobLogSchemaResponse>;
}

export type ApplyJobLogSchemaResponse = Record<string, never>;

export const JOB_LOG_SCHEMA = Symbol('JobLogSchema');
