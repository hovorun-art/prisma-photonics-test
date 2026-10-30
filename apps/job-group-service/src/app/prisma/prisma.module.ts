import { DATABASE } from '@job-queue/kernel';
import { DatabaseShutdown } from '@job-queue/service-kit';
import { Module } from '@nestjs/common';

import {
  JOB_GROUP_SERVICE_CONFIG,
  type JobGroupServiceConfig,
} from '../../domain/config/job-group-service-config.js';
import { PrismaDatabase } from '../../infra/prisma/prisma-database.js';

/**
 * job-group-service's one Postgres connection pool, closed by `DatabaseShutdown` when the app shuts down. It is exported
 * under `DATABASE` (its port) and as `PrismaDatabase` for the modules that wire Prisma adapters.
 */
@Module({
  providers: [
    {
      provide: PrismaDatabase,
      useFactory: (config: JobGroupServiceConfig): PrismaDatabase =>
        new PrismaDatabase({
          databaseUrl: config.databaseUrl,
          databaseSchema: config.databaseSchema,
        }),
      inject: [JOB_GROUP_SERVICE_CONFIG],
    },
    { provide: DATABASE, useExisting: PrismaDatabase },
    DatabaseShutdown,
  ],
  exports: [DATABASE, PrismaDatabase],
})
export class PrismaModule {}
