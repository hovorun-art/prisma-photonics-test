import { CLOCK, type Clock, SystemClock } from '@job-queue/kernel';
import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';

import {
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { JOB_QUEUE, type JobQueue } from '../../domain/jobs/job-queue.js';
import { JOB_REPOSITORY, type JobRepository } from '../../domain/jobs/job-repository.js';
import { JOB_SERVICE } from '../../domain/jobs/job-service.js';
import { JobServiceImpl } from '../../infra/jobs/job-service.impl.js';
import { PrismaJobRepository } from '../../infra/jobs/prisma/prisma-job-repository.js';
import { BullMqJobQueue } from '../../infra/jobs/queue/bullmq-job-queue.js';
import { PrismaDatabase } from '../../infra/prisma/prisma-database.js';
import { InternalAccessModule } from '../internal-access/internal-access.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InternalJobsController } from './internal-jobs.controller.js';
import { JobsController } from './jobs.controller.js';

/** The job feature: public and internal routes over one `JobService`; closes the queue on shutdown. */
@Module({
  imports: [PrismaModule, InternalAccessModule],
  controllers: [JobsController, InternalJobsController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: JOB_REPOSITORY,
      useFactory: (prisma: PrismaDatabase): JobRepository => new PrismaJobRepository({ prisma }),
      inject: [PrismaDatabase],
    },
    {
      provide: JOB_QUEUE,
      useFactory: (config: JobServiceConfig): JobQueue =>
        new BullMqJobQueue(
          { logger: new Logger('JobQueue') },
          { redisUrl: config.redisUrl, enqueueTimeoutMs: config.enqueueTimeoutMs },
        ),
      inject: [JOB_SERVICE_CONFIG],
    },
    {
      provide: JOB_SERVICE,
      useFactory: (
        repository: JobRepository,
        queue: JobQueue,
        clock: Clock,
        config: JobServiceConfig,
      ) =>
        new JobServiceImpl(
          { repository, queue, clock, logger: new Logger('JobService') },
          {
            queryDefaultLimit: config.queryDefaultLimit,
            queryMaxLimit: config.queryMaxLimit,
            bulkMaxJobs: config.bulkMaxJobs,
          },
        ),
      inject: [JOB_REPOSITORY, JOB_QUEUE, CLOCK, JOB_SERVICE_CONFIG],
    },
  ],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
