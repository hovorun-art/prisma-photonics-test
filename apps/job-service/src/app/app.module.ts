import {
  HealthModule,
  LoggingModule,
  RedisModule,
  ServiceConfigModule,
} from '@job-queue/service-kit';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { JOB_SERVICE_CONFIG, type JobServiceConfig } from '../domain/config/job-service-config.js';
import { ErrorResponseFilter } from './errors/error-response.filter.js';
import { InternalAccessModule } from './internal-access/internal-access.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

export interface AppOptions {
  /** Validated once in `main.ts`, before the app is built. */
  readonly config: JobServiceConfig;
}

/** Composition root of job-service. */
@Module({})
export class AppModule {
  static forRoot({ config }: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ServiceConfigModule.forRoot({ token: JOB_SERVICE_CONFIG, config }),
        LoggingModule.forRoot({ nodeEnv: config.nodeEnv, logLevel: config.logLevel }),
        PrismaModule,
        RedisModule.forRoot({
          redisUrl: config.redisUrl,
          connectionName: 'job-service',
          awaitFirstAnswer: false,
        }),
        HealthModule,
        InternalAccessModule,
        JobsModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ErrorResponseFilter },
        // Validates every parameter typed with a Zod DTO (`createZodDto`) against its schema.
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
    };
  }
}
