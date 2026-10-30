import type { CloseClosableResponse, Database, PingDatabaseResponse } from '@job-queue/kernel';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';

/** Name of job-service's connections in `pg_stat_activity`. */
export const DATABASE_APPLICATION_NAME = 'job-service';

export interface PrismaDatabaseParams {
  databaseUrl: string;
}

/**
 * job-service's Postgres connection pool. The Prisma client is the base class, so the adapters
 * that query job data build on it.
 */
export class PrismaDatabase extends PrismaClient implements Database {
  constructor(p: PrismaDatabaseParams) {
    super({
      adapter: new PrismaPg({
        connectionString: p.databaseUrl,
        application_name: DATABASE_APPLICATION_NAME,
      }),
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
