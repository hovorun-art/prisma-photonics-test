import {
  HealthModule,
  LoggingModule,
  RedisModule,
  ServiceConfigModule,
} from '@job-queue/service-kit';
import { DynamicModule, Module } from '@nestjs/common';

import { EXECUTION_CONFIG, type ExecutionConfig } from '../domain/config/execution-config.js';
import type { InstanceId } from '../domain/instance/instance-id.js';

export interface AppOptions {
  readonly config: ExecutionConfig;
  readonly instanceId: InstanceId;
}

/** Composition root of job-execution-service (an HTTP server for its own `GET /health` only). */
@Module({})
export class AppModule {
  static forRoot({ config, instanceId }: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ServiceConfigModule.forRoot({ token: EXECUTION_CONFIG, config }),
        LoggingModule.forRoot({
          nodeEnv: config.nodeEnv,
          logLevel: config.logLevel,
          // Every line carries the instance id, so logs of scaled instances can be told apart.
          base: { service: 'job-execution-service', instanceId },
        }),
        RedisModule.forRoot({
          redisUrl: config.redisUrl,
          connectionName: 'job-execution-service',
          // The app starts once Redis has answered.
          awaitFirstAnswer: true,
        }),
        HealthModule,
      ],
    };
  }
}
