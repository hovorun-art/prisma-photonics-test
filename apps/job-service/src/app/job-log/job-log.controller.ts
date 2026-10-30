import { JOBS_ROUTE, type QueryJobLogResponse } from '@job-queue/contracts';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JOB_LOG_SERVICE, type JobLogService } from '../../domain/job-log/job-log-service.js';
import { JobLogIdParamsDto, QueryJobLogDto, QueryJobLogResponseDto } from './job-log.dto.js';

/** The public route that reads a job's log. */
@ApiTags('jobs')
@Controller(JOBS_ROUTE)
export class JobLogController {
  constructor(@Inject(JOB_LOG_SERVICE) private readonly log: JobLogService) {}

  @Get(':id/logs')
  @ApiOperation({
    summary: "Read a job's log a page at a time, oldest first",
    description:
      'Repeat `level` for several levels (`?level=warning&level=error`). `nextCursor` marks the ' +
      'last entry returned; pass it as `after` to get only later entries. With no entries ' +
      'returned it is the `after` given, or null.',
  })
  @ApiOkResponse({ type: QueryJobLogResponseDto })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED (also for a limit above the maximum, an unknown level or a malformed cursor)',
  })
  @ApiNotFoundResponse({ description: 'JOB_NOT_FOUND (also for a deleted job)' })
  @ApiServiceUnavailableResponse({ description: 'LOG_STORE_UNAVAILABLE' })
  query(
    @Param() params: JobLogIdParamsDto,
    @Query() query: QueryJobLogDto,
  ): Promise<QueryJobLogResponse> {
    return this.log.query({
      jobId: params.id,
      after: query.after,
      levels: query.level,
      limit: query.limit,
    });
  }
}
