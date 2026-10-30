import { SystemClock, SystemRandom } from '@job-queue/kernel';
import {
  ErrorResponseFilter,
  HealthModule,
  IoRedisJobLogStreamRedis,
  JobLogStreamDestination,
  LoggingModule,
  RedisModule,
  ServiceConfigModule,
} from '@job-queue/service-kit';
import {
  DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { JOB_SERVICE_CONFIG, type JobServiceConfig } from '../domain/config/job-service-config.js';
import { InternalAccessModule } from './internal-access/internal-access.module.js';
import { JobLogModule } from './job-log/job-log.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

/** Where job-service's own job-related log lines go besides its normal output. */
export type JobLogDestination = Pick<JobLogStreamDestination, 'write' | 'open' | 'close'>;

export const JOB_LOG_DESTINATION = Symbol('JobLogDestination');

/** How long the start waits for the job log's Redis connection before it carries on without it. */
const JOB_LOG_OPEN_TIMEOUT_MS = 5000;

export interface AppOptions {
  /** Validated once in `main.ts`, before the app is built. */
  readonly config: JobServiceConfig;
  /** The job log destination; the Redis Stream one of `config` when omitted. */
  readonly jobLogDestination?: JobLogDestination;
}

/** Composition root of job-service. */
@Module({})
export class AppModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AppModule.name);

  constructor(@Inject(JOB_LOG_DESTINATION) private readonly jobLog: JobLogDestination) {}

  static forRoot({ config, jobLogDestination }: AppOptions): DynamicModule {
    const jobLog = jobLogDestination ?? AppModule.streamDestination(config);
    return {
      module: AppModule,
      imports: [
        ServiceConfigModule.forRoot({ token: JOB_SERVICE_CONFIG, config }),
        LoggingModule.forRoot({ nodeEnv: config.nodeEnv, logLevel: config.logLevel, jobLog }),
        PrismaModule,
        RedisModule.forRoot({
          redisUrl: config.redisUrl,
          connectionName: 'job-service',
          awaitFirstAnswer: false,
        }),
        HealthModule,
        InternalAccessModule,
        JobsModule,
        JobLogModule,
      ],
      providers: [
        { provide: JOB_LOG_DESTINATION, useValue: jobLog },
        { provide: APP_FILTER, useClass: ErrorResponseFilter },
        // Validates every parameter typed with a Zod DTO (`createZodDto`) against its schema.
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
    };
  }

  /** Logging must never block or fail the service: a destination that cannot connect is a warning. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.jobLog.open();
    } catch (error) {
      this.logger.warn(
        `Job log stream not reachable, job log entries are dropped until Redis answers: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.jobLog.close();
  }

  private static streamDestination(config: JobServiceConfig): JobLogDestination {
    return new JobLogStreamDestination(
      {
        redis: new IoRedisJobLogStreamRedis({
          redisUrl: config.redisUrl,
          connectionName: 'job-service-log',
          openTimeoutMs: JOB_LOG_OPEN_TIMEOUT_MS,
        }),
        random: new SystemRandom(),
        clock: new SystemClock(),
        mainLog: process.stdout,
      },
      { source: 'job-service', maxLength: config.jobLogStreamMaxLength },
    );
  }
}
