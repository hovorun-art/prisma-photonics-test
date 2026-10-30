import {
  CreateJobRequest,
  JOBS_ROUTE,
  type Job,
  type QueryJobsResponse,
} from '@job-queue/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { JOB_SERVICE, type JobService } from '../../domain/jobs/job-service.js';
import {
  CreateJobDto,
  JobDto,
  JobIdParamsDto,
  QueryJobsDto,
  QueryJobsResponseDto,
} from './job.dto.js';

/** The public job routes: submit, get, query and delete. */
@ApiTags('jobs')
@Controller(JOBS_ROUTE)
export class JobsController {
  constructor(@Inject(JOB_SERVICE) private readonly jobs: JobService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a job; it is stored as pending and put on the queue' })
  @ApiCreatedResponse({ type: JobDto, description: 'The stored job' })
  @ApiBody({ type: CreateJobDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  async create(
    @Body(new ZodValidationPipe(CreateJobRequest)) body: CreateJobRequest,
  ): Promise<Job> {
    return (await this.jobs.create({ job: body })).job;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one job' })
  @ApiOkResponse({ type: JobDto })
  @ApiNotFoundResponse({ description: 'JOB_NOT_FOUND' })
  async get(@Param() params: JobIdParamsDto): Promise<Job> {
    return (await this.jobs.get({ id: params.id })).job;
  }

  @Get()
  @ApiOperation({
    summary: 'Query jobs a page at a time, newest first, optionally filtered by status and type',
    description:
      'Repeat `status` or `type` for several values (`?status=failed&status=cancelled`). The two ' +
      'filters combine with AND, the values of one filter with OR; `total` counts the matching jobs.',
  })
  @ApiOkResponse({ type: QueryJobsResponseDto })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED (also for a limit above the maximum or an unknown filter value)',
  })
  query(@Query() query: QueryJobsDto): Promise<QueryJobsResponse> {
    return this.jobs.query({
      limit: query.limit,
      offset: query.offset,
      statuses: query.status,
      types: query.type,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a finished job (completed, failed or cancelled)' })
  @ApiNoContentResponse({ description: 'The job is gone' })
  @ApiNotFoundResponse({ description: 'JOB_NOT_FOUND' })
  @ApiConflictResponse({ description: 'JOB_STATUS_CONFLICT: the job has not finished' })
  async delete(@Param() params: JobIdParamsDto): Promise<void> {
    await this.jobs.delete({ id: params.id });
  }
}
