import { INTERNAL_API_PREFIX } from '@job-queue/contracts';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { InternalAccessModule } from '../../../src/app/internal-access/internal-access.module.js';
import { ServiceTokenGuard } from '../../../src/app/internal-access/service-token.guard.js';

/** What the probe route answers when its guard lets the call through. */
export const INTERNAL_PROBE_ANSWER = { probed: true } as const;

/** The path of the test-only route under the internal prefix. */
export const INTERNAL_PROBE_PATH = `${INTERNAL_API_PREFIX}/test-probe`;

/**
 * A test-only controller under `/internal/v1`, guarded like every real internal controller, so the
 * internal-access scenarios run through the real app before job-service has an internal route.
 */
@ApiExcludeController()
@Controller(INTERNAL_PROBE_PATH)
@UseGuards(ServiceTokenGuard)
export class InternalProbeController {
  @Get()
  probe(): typeof INTERNAL_PROBE_ANSWER {
    return INTERNAL_PROBE_ANSWER;
  }
}

/** Registered only by the e2e tests, never by `AppModule`. */
@Module({ imports: [InternalAccessModule], controllers: [InternalProbeController] })
export class InternalProbeModule {}
