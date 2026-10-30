/**
 * Moves entries from the job log stream into the job log store in batches: a batch is confirmed on
 * the stream only after it is stored, and a failed store is retried with backoff before anything
 * new is read, so entries wait in the stream while the store is down.
 */
export interface JobLogWriter {
  /** Starts the loop in the background; returns at once. */
  start(): StartJobLogWriterResponse;
  /** Ends the loop and waits for it; a batch not stored yet stays unconfirmed. */
  stop(): Promise<StopJobLogWriterResponse>;
}

export type StartJobLogWriterResponse = Record<string, never>;
export type StopJobLogWriterResponse = Record<string, never>;

export const JOB_LOG_WRITER = Symbol('JobLogWriter');
