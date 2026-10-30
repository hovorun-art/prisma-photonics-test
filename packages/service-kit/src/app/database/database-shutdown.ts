import { DATABASE, type Database } from '@job-queue/kernel';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';

/**
 * Closes the service's database pool (bound under the kernel's `DATABASE` token) when its module is
 * destroyed on shutdown. Each app's database module provides it next to its own pool.
 */
@Injectable()
export class DatabaseShutdown implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.close();
  }
}
