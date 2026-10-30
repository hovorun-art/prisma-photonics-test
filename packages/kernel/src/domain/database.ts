import type { Closable } from './closable.js';

/** Token for a service's database connection pool. */
export const DATABASE = Symbol('Database');

/** A service's own database connection pool; no other service connects to that data. */
export interface Database extends Closable {
  /** Resolves when the database answers a trivial query. */
  ping(): Promise<PingDatabaseResponse>;
}

export type PingDatabaseResponse = Record<string, never>;
