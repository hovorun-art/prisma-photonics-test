import type { CloseClosableResponse } from '@job-queue/kernel';
import { PrismaPg } from '@prisma/adapter-pg';

import type { Database, PingDatabaseResponse } from '../../domain/database/database.js';
import { PrismaClient } from './generated/client.js';

/** Name of job-group-service's connections in `pg_stat_activity`. */
export const DATABASE_APPLICATION_NAME = 'job-group-service';

export interface PrismaDatabaseParams {
  /** Connection string without the schema parameter. */
  databaseUrl: string;
  /** The Postgres schema every query uses (`job_groups`). */
  databaseSchema: string;
}

/**
 * job-group-service's Postgres connection pool, bound to its own schema. The Prisma client is the
 * base class, so the adapters that query group data build on it.
 */
export class PrismaDatabase extends PrismaClient implements Database {
  constructor(p: PrismaDatabaseParams) {
    super({
      adapter: new PrismaPg(
        { connectionString: p.databaseUrl, application_name: DATABASE_APPLICATION_NAME },
        { schema: p.databaseSchema },
      ),
    });
  }

  async ping(): Promise<PingDatabaseResponse> {
    await this.$queryRaw`SELECT 1`;
    return {};
  }

  async close(): Promise<CloseClosableResponse> {
    await this.$disconnect();
    return {};
  }
}
