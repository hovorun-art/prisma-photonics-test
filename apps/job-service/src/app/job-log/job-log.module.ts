import { createClient, type ClickHouseClient } from '@clickhouse/client';
import {
  ConfiguredPageLimit,
  CLOCK,
  type Clock,
  SystemClock,
  SystemRandom,
} from '@job-queue/kernel';
import { Logger, Module } from '@nestjs/common';

import {
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { JOB_LOG_SERVICE } from '../../domain/job-log/job-log-service.js';
import { JOB_REPOSITORY, type JobRepository } from '../../domain/jobs/job-repository.js';
import { JOB_LOG_SCHEMA, type JobLogSchema } from '../../domain/job-log/job-log-schema.js';
import { JOB_LOG_STORE, type JobLogStore } from '../../domain/job-log/job-log-store.js';
import { JOB_LOG_STREAM, type JobLogStream } from '../../domain/job-log/job-log-stream.js';
import { JOB_LOG_WRITER, type JobLogWriter } from '../../domain/job-log/job-log-writer.js';
import { ClickHouseJobLogSchema } from '../../infra/job-log/clickhouse/clickhouse-job-log-schema.js';
import { ClickHouseJobLogStore } from '../../infra/job-log/clickhouse/clickhouse-job-log-store.js';
import { JobLogServiceImpl } from '../../infra/job-log/job-log-service.impl.js';
import { JobLogWriterImpl } from '../../infra/job-log/job-log-writer.impl.js';
import { RedisJobLogStream } from '../../infra/job-log/redis/redis-job-log-stream.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { JobLogController } from './job-log.controller.js';
import { JobLogWriterHook } from './job-log-writer.hook.js';

/** The ClickHouse client both the schema and the store use; the store closes it. */
const CLICKHOUSE_CLIENT = Symbol('ClickHouseClient');

/**
 * The job log's storage side: the ClickHouse store and its schema, the Redis stream it is fed
 * from, and the writer between them (started and stopped with the app by `JobLogWriterHook`), and
 * the read route over the store.
 */
@Module({
  imports: [JobsModule],
  controllers: [JobLogController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: CLICKHOUSE_CLIENT,
      useFactory: (config: JobServiceConfig): ClickHouseClient =>
        createClient({ url: config.clickhouseUrl }),
      inject: [JOB_SERVICE_CONFIG],
    },
    {
      provide: JOB_LOG_SCHEMA,
      useFactory: (client: ClickHouseClient, config: JobServiceConfig): JobLogSchema =>
        new ClickHouseJobLogSchema({ client }, { retentionDays: config.jobLogRetentionDays }),
      inject: [CLICKHOUSE_CLIENT, JOB_SERVICE_CONFIG],
    },
    {
      provide: JOB_LOG_STORE,
      useFactory: (client: ClickHouseClient, config: JobServiceConfig): JobLogStore =>
        new ClickHouseJobLogStore({ client }, { retentionDays: config.jobLogRetentionDays }),
      inject: [CLICKHOUSE_CLIENT, JOB_SERVICE_CONFIG],
    },
    {
      provide: JOB_LOG_STREAM,
      useFactory: (config: JobServiceConfig): JobLogStream =>
        new RedisJobLogStream({
          redisUrl: config.redisUrl,
          connectionName: 'job-service-log-writer',
          instanceId: new SystemRandom().uuid().value,
          leaseMs: config.jobLogWriterLeaseMs,
        }),
      inject: [JOB_SERVICE_CONFIG],
    },
    {
      provide: JOB_LOG_WRITER,
      useFactory: (
        stream: JobLogStream,
        store: JobLogStore,
        schema: JobLogSchema,
        clock: Clock,
        config: JobServiceConfig,
      ): JobLogWriter =>
        new JobLogWriterImpl(
          { stream, store, schema, clock, logger: new Logger('JobLogWriter') },
          {
            batchSize: config.jobLogBatchSize,
            flushIntervalMs: config.jobLogFlushIntervalMs,
            retryDelayMs: config.jobLogStoreRetryDelayMs,
            retryMaxDelayMs: config.jobLogStoreRetryMaxDelayMs,
          },
        ),
      inject: [JOB_LOG_STREAM, JOB_LOG_STORE, JOB_LOG_SCHEMA, CLOCK, JOB_SERVICE_CONFIG],
    },
    {
      provide: JOB_LOG_SERVICE,
      useFactory: (repository: JobRepository, store: JobLogStore, config: JobServiceConfig) =>
        new JobLogServiceImpl({
          repository,
          store,
          pageLimit: new ConfiguredPageLimit({
            defaultLimit: config.jobLogQueryDefaultLimit,
            maxLimit: config.jobLogQueryMaxLimit,
          }),
        }),
      inject: [JOB_REPOSITORY, JOB_LOG_STORE, JOB_SERVICE_CONFIG],
    },
    JobLogWriterHook,
  ],
  exports: [JOB_LOG_STORE],
})
export class JobLogModule {}
