import type { Closable } from '@job-queue/kernel';

/** Token for job-service's database connection pool. */
export const DATABASE = Symbol('Database');

/** job-service's Postgres database; no other service connects to it. */
export interface Database extends Closable {
  /** Resolves when the database answers a trivial query. */
  ping(): Promise<PingDatabaseResponse>;
}

export type PingDatabaseResponse = Record<string, never>;
