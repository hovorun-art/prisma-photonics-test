import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';

import {
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { DATABASE, type Database } from '../../domain/database/database.js';
import { PrismaDatabase } from '../../infra/prisma/prisma-database.js';

/** job-service's one Postgres connection pool under `DATABASE`, closed when the app shuts down. */
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (config: JobServiceConfig): Database =>
        new PrismaDatabase({ databaseUrl: config.databaseUrl }),
      inject: [JOB_SERVICE_CONFIG],
    },
  ],
  exports: [DATABASE],
})
export class PrismaModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.close();
  }
}
