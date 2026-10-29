import { Module } from '@nestjs/common';

import {
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { INTERNAL_ACCESS } from '../../domain/internal-access/internal-access.js';
import { ServiceTokenInternalAccess } from '../../infra/internal-access/service-token-internal-access.js';
import { ServiceTokenGuard } from './service-token.guard.js';

/**
 * The service-token guard of job-service's internal API. The token comes from the app's validated
 * config. Modules put `@UseGuards(ServiceTokenGuard)` on their own `/internal` controllers by
 * importing this module.
 */
@Module({
  providers: [
    {
      provide: INTERNAL_ACCESS,
      useFactory: (config: JobServiceConfig) =>
        new ServiceTokenInternalAccess({ serviceToken: config.internalServiceToken }),
      inject: [JOB_SERVICE_CONFIG],
    },
    ServiceTokenGuard,
  ],
  exports: [INTERNAL_ACCESS, ServiceTokenGuard],
})
export class InternalAccessModule {}
