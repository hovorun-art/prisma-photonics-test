import { Module, type DynamicModule } from '@nestjs/common';
import { vi, type MockInstance } from 'vitest';

import { PrismaModule } from '../../../src/app/prisma/prisma.module.js';
import { DATABASE, type Database } from '../../../src/domain/database/database.js';

export interface DatabaseCloseProbeOptions {
  /** Receives the spy on the app's real `Database.close()`, which still runs. */
  onSpy: (spy: MockInstance<Database['close']>) => void;
}

/** Registered only by the e2e tests, never by `AppModule`. */
@Module({})
export class DatabaseCloseProbeModule {
  static forRoot({ onSpy }: DatabaseCloseProbeOptions): DynamicModule {
    return {
      module: DatabaseCloseProbeModule,
      imports: [PrismaModule],
      providers: [
        {
          provide: Symbol('DatabaseCloseProbe'),
          useFactory: (database: Database): true => {
            onSpy(vi.spyOn(database, 'close'));
            return true;
          },
          inject: [DATABASE],
        },
      ],
    };
  }
}
