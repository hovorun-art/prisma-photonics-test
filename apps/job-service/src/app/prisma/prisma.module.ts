import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';

import {
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { DATABASE, type Database } from '../../domain/database/database.js';
import { PrismaDatabase } from '../../infra/prisma/prisma-database.js';

/**
 * job-service's one Postgres connection pool, closed when the app shuts down. It is exported under
 * `DATABASE` (its port) and as `PrismaDatabase` for the modules that wire Prisma adapters.
 */
@Module({
  providers: [
    {
      provide: PrismaDatabase,
      useFactory: (config: JobServiceConfig): PrismaDatabase =>
        new PrismaDatabase({ databaseUrl: config.databaseUrl }),
      inject: [JOB_SERVICE_CONFIG],
    },
    { provide: DATABASE, useExisting: PrismaDatabase },
  ],
  exports: [DATABASE, PrismaDatabase],
})
export class PrismaModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.close();
  }
}
