import { CLOCK, type Clock, SystemClock } from '@job-queue/kernel';
import { Logger, Module } from '@nestjs/common';

import {
  JOB_GROUP_SERVICE_CONFIG,
  type JobGroupServiceConfig,
} from '../../domain/config/job-group-service-config.js';
import { GROUP_CHILD_JOBS, type GroupChildJobs } from '../../domain/groups/group-child-jobs.js';
import {
  JOB_GROUP_REPOSITORY,
  type JobGroupRepository,
} from '../../domain/groups/job-group-repository.js';
import { JOB_GROUP_SERVICE } from '../../domain/groups/job-group-service.js';
import { JOB_GROUP_TRACKER } from '../../domain/groups/job-group-tracker.js';
import { HttpGroupChildJobs } from '../../infra/groups/http/http-group-child-jobs.js';
import { JobGroupServiceImpl } from '../../infra/groups/job-group-service.impl.js';
import { JobGroupTrackerImpl } from '../../infra/groups/job-group-tracker.impl.js';
import { PrismaJobGroupRepository } from '../../infra/groups/prisma/prisma-job-group-repository.js';
import { PrismaDatabase } from '../../infra/prisma/prisma-database.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { JobGroupPoll } from './job-group-poll.js';
import { JobGroupsController } from './job-groups.controller.js';

/** The group feature: the public routes over one `JobGroupService`, and the poll of running groups. */
@Module({
  imports: [PrismaModule],
  controllers: [JobGroupsController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: JOB_GROUP_REPOSITORY,
      useFactory: (prisma: PrismaDatabase, config: JobGroupServiceConfig): JobGroupRepository =>
        new PrismaJobGroupRepository({ prisma }, { schema: config.databaseSchema }),
      inject: [PrismaDatabase, JOB_GROUP_SERVICE_CONFIG],
    },
    {
      provide: GROUP_CHILD_JOBS,
      useFactory: (config: JobGroupServiceConfig): GroupChildJobs =>
        new HttpGroupChildJobs({
          baseUrl: config.jobServiceUrl,
          timeoutMs: config.jobServiceTimeoutMs,
        }),
      inject: [JOB_GROUP_SERVICE_CONFIG],
    },
    {
      provide: JOB_GROUP_SERVICE,
      useFactory: (
        repository: JobGroupRepository,
        childJobs: GroupChildJobs,
        config: JobGroupServiceConfig,
      ) =>
        new JobGroupServiceImpl(
          { repository, childJobs },
          { queryDefaultLimit: config.queryDefaultLimit, queryMaxLimit: config.queryMaxLimit },
        ),
      inject: [JOB_GROUP_REPOSITORY, GROUP_CHILD_JOBS, JOB_GROUP_SERVICE_CONFIG],
    },
    {
      provide: JOB_GROUP_TRACKER,
      useFactory: (
        repository: JobGroupRepository,
        childJobs: GroupChildJobs,
        clock: Clock,
        config: JobGroupServiceConfig,
      ) =>
        new JobGroupTrackerImpl(
          { repository, childJobs, clock, logger: new Logger('JobGroupTracker') },
          { batchSize: config.pollBatchSize },
        ),
      inject: [JOB_GROUP_REPOSITORY, GROUP_CHILD_JOBS, CLOCK, JOB_GROUP_SERVICE_CONFIG],
    },
    JobGroupPoll,
  ],
})
export class JobGroupsModule {}
