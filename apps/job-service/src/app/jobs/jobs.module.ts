import {
  CLOCK,
  type Clock,
  ConfiguredPageLimit,
  RANDOM,
  type Random,
  SystemClock,
  SystemRandom,
} from '@job-queue/kernel';
import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';

import {
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { JOB_COUNTS, type JobCounts } from '../../domain/jobs/job-counts.js';
import { JOB_QUEUE, type JobQueue } from '../../domain/jobs/job-queue.js';
import { JOB_RECOVERY, type JobRecovery } from '../../domain/jobs/job-recovery.js';
import { JOB_REPOSITORY, type JobRepository } from '../../domain/jobs/job-repository.js';
import {
  JOB_REQUEST_FINGERPRINT,
  type JobRequestFingerprint,
} from '../../domain/jobs/job-request-fingerprint.js';
import { RETRY_DELAY, type RetryDelay } from '../../domain/jobs/retry-delay.js';
import { JOB_SERVICE, type JobService } from '../../domain/jobs/job-service.js';
import { JOB_STATISTICS } from '../../domain/jobs/job-statistics.js';
import { JobServiceImpl } from '../../infra/jobs/job-service.impl.js';
import { Sha256JobRequestFingerprint } from '../../infra/jobs/idempotency/sha256-job-request-fingerprint.js';
import { JobStatisticsImpl } from '../../infra/jobs/job-statistics.impl.js';
import { PrismaJobCounts } from '../../infra/jobs/prisma/prisma-job-counts.js';
import { PrismaJobRepository } from '../../infra/jobs/prisma/prisma-job-repository.js';
import { BullMqJobQueue } from '../../infra/jobs/queue/bullmq-job-queue.js';
import { JobRecoveryImpl } from '../../infra/jobs/recovery/job-recovery.impl.js';
import { ExponentialJitterRetryDelay } from '../../infra/jobs/retry/exponential-jitter-retry-delay.js';
import { PrismaDatabase } from '../../infra/prisma/prisma-database.js';
import { InternalAccessModule } from '../internal-access/internal-access.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InternalJobsController } from './internal-jobs.controller.js';
import { JobRecoverySchedule } from './job-recovery-schedule.js';
import { JobsController } from './jobs.controller.js';
import { StatsController } from './stats.controller.js';

/**
 * The job feature: public and internal routes over one `JobService`, the queue statistics, and the
 * recovery pass on its timer; closes the queue on shutdown.
 */
@Module({
  imports: [PrismaModule, InternalAccessModule],
  controllers: [JobsController, InternalJobsController, StatsController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: RANDOM, useClass: SystemRandom },
    {
      provide: RETRY_DELAY,
      useFactory: (random: Random, config: JobServiceConfig): RetryDelay =>
        new ExponentialJitterRetryDelay({ random }, config.retryDelay),
      inject: [RANDOM, JOB_SERVICE_CONFIG],
    },
    { provide: JOB_REQUEST_FINGERPRINT, useClass: Sha256JobRequestFingerprint },
    {
      provide: JOB_REPOSITORY,
      useFactory: (prisma: PrismaDatabase): JobRepository => new PrismaJobRepository({ prisma }),
      inject: [PrismaDatabase],
    },
    {
      provide: JOB_QUEUE,
      useFactory: (config: JobServiceConfig, clock: Clock): JobQueue =>
        new BullMqJobQueue(
          { logger: new Logger('JobQueue'), clock },
          { redisUrl: config.redisUrl, enqueueTimeoutMs: config.enqueueTimeoutMs },
        ),
      inject: [JOB_SERVICE_CONFIG, CLOCK],
    },
    {
      provide: JOB_SERVICE,
      useFactory: (
        repository: JobRepository,
        queue: JobQueue,
        clock: Clock,
        retryDelay: RetryDelay,
        fingerprint: JobRequestFingerprint,
        config: JobServiceConfig,
      ) =>
        new JobServiceImpl(
          {
            repository,
            queue,
            clock,
            retryDelay,
            fingerprint,
            logger: new Logger('JobService'),
            pageLimit: new ConfiguredPageLimit({
              defaultLimit: config.queryDefaultLimit,
              maxLimit: config.queryMaxLimit,
            }),
          },
          { bulkMaxJobs: config.bulkMaxJobs },
        ),
      inject: [
        JOB_REPOSITORY,
        JOB_QUEUE,
        CLOCK,
        RETRY_DELAY,
        JOB_REQUEST_FINGERPRINT,
        JOB_SERVICE_CONFIG,
      ],
    },
    {
      provide: JOB_RECOVERY,
      useFactory: (
        repository: JobRepository,
        queue: JobQueue,
        jobs: JobService,
        clock: Clock,
        config: JobServiceConfig,
      ): JobRecovery =>
        new JobRecoveryImpl(
          { repository, queue, jobs, clock, logger: new Logger('JobRecovery') },
          {
            minAgeMs: config.recovery.minAgeMs,
            intervalMs: config.recovery.intervalMs,
            batchSize: config.recovery.batchSize,
            maxProcessingMs: config.maxProcessingMs,
          },
        ),
      inject: [JOB_REPOSITORY, JOB_QUEUE, JOB_SERVICE, CLOCK, JOB_SERVICE_CONFIG],
    },
    JobRecoverySchedule,
    {
      provide: JOB_COUNTS,
      useFactory: (prisma: PrismaDatabase): JobCounts => new PrismaJobCounts({ prisma }),
      inject: [PrismaDatabase],
    },
    {
      provide: JOB_STATISTICS,
      useFactory: (counts: JobCounts, clock: Clock, config: JobServiceConfig) =>
        new JobStatisticsImpl(
          { counts, clock },
          {
            recentWindowMinutes: config.statsRecentWindowMinutes,
            throughputWindowMinutes: config.statsThroughputWindowMinutes,
          },
        ),
      inject: [JOB_COUNTS, CLOCK, JOB_SERVICE_CONFIG],
    },
  ],
  exports: [JOB_REPOSITORY],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
