import type { Closable } from '@job-queue/kernel';

/** Token for job-group-service's database connection pool. */
export const DATABASE = Symbol('Database');

/** job-group-service's Postgres schema; no other service reads or writes it. */
export interface Database extends Closable {
  /** Resolves when the database answers a trivial query. */
  ping(): Promise<PingDatabaseResponse>;
}

export type PingDatabaseResponse = Record<string, never>;
