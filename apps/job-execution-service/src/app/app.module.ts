import {
  HealthModule,
  JOB_LOG_DESTINATION,
  JobLogDestinationHook,
  type JobLogDestination,
  type LogDestination,
  LoggingModule,
  RedisModule,
  ServiceConfigModule,
} from '@job-queue/service-kit';
import { DynamicModule, Module } from '@nestjs/common';

import { EXECUTION_CONFIG, type ExecutionConfig } from '../domain/config/execution-config.js';
import type { InstanceId } from '../domain/instance/instance-id.js';
import { ExecutionModule } from './execution/execution.module.js';

export interface AppOptions {
  readonly config: ExecutionConfig;
  readonly instanceId: InstanceId;
  /** Where log lines go; standard output when omitted (the e2e tests collect them). */
  readonly logDestination?: LogDestination;
  readonly jobLog: JobLogDestination;
}

/** Composition root of job-execution-service: runs queued jobs; its HTTP server answers only `GET /health`. */
@Module({})
export class AppModule {
  static forRoot({ config, instanceId, logDestination, jobLog }: AppOptions): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: JOB_LOG_DESTINATION, useValue: jobLog }, JobLogDestinationHook],
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
}
