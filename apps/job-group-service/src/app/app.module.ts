import {
  ErrorResponseFilter,
  HealthModule,
  LoggingModule,
  ServiceConfigModule,
} from '@job-queue/service-kit';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  JOB_GROUP_SERVICE_CONFIG,
  type JobGroupServiceConfig,
} from '../domain/config/job-group-service-config.js';
import { PrismaModule } from './prisma/prisma.module.js';

export interface AppOptions {
  /** Validated once in `main.ts`, before the app is built. */
  readonly config: JobGroupServiceConfig;
}

/** Composition root of job-group-service. */
@Module({})
export class AppModule {
  static forRoot({ config }: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ServiceConfigModule.forRoot({ token: JOB_GROUP_SERVICE_CONFIG, config }),
        LoggingModule.forRoot({ nodeEnv: config.nodeEnv, logLevel: config.logLevel }),
        ScheduleModule.forRoot(),
        PrismaModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ErrorResponseFilter },
        // Validates every parameter typed with a Zod DTO (`createZodDto`) against its schema.
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
    };
  }
}
