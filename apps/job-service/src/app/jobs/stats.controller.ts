import { type QueueStats, STATS_ROUTE } from '@job-queue/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JOB_STATISTICS, type JobStatistics } from '../../domain/jobs/job-statistics.js';
import { QueryStatsDto, QueueStatsDto } from './job.dto.js';

/** The public queue statistics route. */
@ApiTags('stats')
@Controller(STATS_ROUTE)
export class StatsController {
  constructor(@Inject(JOB_STATISTICS) private readonly statistics: JobStatistics) {}

  @Get()
  @ApiOperation({
    summary: 'Queue statistics over jobs of every type',
    description:
      'Jobs pending, processing and scheduled now; jobs completed and failed for good within the ' +
      'recent window; and the throughput, jobs completed within the throughput window per minute. ' +
      'Both window lengths are part of the answer. `counts` holds all jobs per status and per ' +
      'type, faceted: `type` narrows the counts per status, `status` the counts per type; neither ' +
      'filter changes the other statistics. Each filter takes one value.',
  })
  @ApiOkResponse({ type: QueueStatsDto })
  async get(@Query() query: QueryStatsDto): Promise<QueueStats> {
    return (await this.statistics.get({ status: query.status, type: query.type })).stats;
  }
}
