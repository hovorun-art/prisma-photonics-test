import { HEALTH_ROUTE, type HealthResponse } from '@job-queue/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthResponseDto } from './health-response.dto.js';

@ApiTags('health')
@Controller()
export class HealthController {
  @Get(HEALTH_ROUTE.path)
  @ApiOperation({ summary: 'Answers 200 while the service is running' })
  @ApiOkResponse({ type: HealthResponseDto, description: 'The service is running' })
  health(): HealthResponse {
    return { status: 'ok' };
  }
}
