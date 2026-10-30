import {
  HealthModule,
  type LogDestination,
  LoggingModule,
  RedisModule,
  ServiceConfigModule,
} from '@job-queue/service-kit';
import type { Closable } from '@job-queue/kernel';
import {
  DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';

import { EXECUTION_CONFIG, type ExecutionConfig } from '../domain/config/execution-config.js';
import type { InstanceId } from '../domain/instance/instance-id.js';
import { ExecutionModule } from './execution/execution.module.js';

/** The destination of the job lines of the logs: they become entries of the job's log. */
export interface JobLogDestination extends LogDestination, Closable {
  /** Resolves once entries can be sent; rejects when that takes too long. */
  open(): Promise<unknown>;
}

const JOB_LOG_DESTINATION = Symbol('JobLogDestination');

export interface AppOptions {
  readonly config: ExecutionConfig;
  readonly instanceId: InstanceId;
  /** Where log lines go; standard output when omitted (the e2e tests collect them). */
  readonly logDestination?: LogDestination;
  readonly jobLog: JobLogDestination;
}

/** Composition root of job-execution-service: runs queued jobs; its HTTP server answers only `GET /health`. */
@Module({})
export class AppModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AppModule.name);

  constructor(@Inject(JOB_LOG_DESTINATION) private readonly jobLog: JobLogDestination) {}

  static forRoot({ config, instanceId, logDestination, jobLog }: AppOptions): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: JOB_LOG_DESTINATION, useValue: jobLog }],
      imports: [
        ServiceConfigModule.forRoot({ token: EXECUTION_CONFIG, config }),
        LoggingModule.forRoot({
          nodeEnv: config.nodeEnv,
          logLevel: config.logLevel,
          // Every line carries the instance id, so logs of scaled instances can be told apart.
          base: { service: 'job-execution-service', instanceId },
          ...(logDestination === undefined ? {} : { destination: logDestination }),
          jobLog,
        }),
        RedisModule.forRoot({
          redisUrl: config.redisUrl,
          connectionName: 'job-execution-service',
          // The app starts once Redis has answered.
          awaitFirstAnswer: true,
        }),
        HealthModule,
        ExecutionModule,
      ],
    };
  }

  /**
   * Module initialisation finishes before any module's bootstrap hook, so the connection is ready
   * (or given up on) before the queue consumer takes its first entry. Logging never blocks a job:
   * without the connection the job lines are only dropped.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.jobLog.open();
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Job log unavailable at startup: job log entries are dropped until Redis answers',
      );
    }
  }

  /** The last hook of a shutdown, after the last log line of the other modules. */
  async onApplicationShutdown(): Promise<void> {
    await this.jobLog.close();
  }
}
