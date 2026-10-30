import {
  CreateJobRequest,
  CreateJobsBulkRequest,
  type CreateJobsBulkResponse,
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
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { JOB_SERVICE, type JobService } from '../../domain/jobs/job-service.js';
import {
  CreateJobDto,
  CreateJobsBulkDto,
  CreateJobsBulkResponseDto,
  JobDto,
  JobIdParamsDto,
  QueryJobsDto,
  QueryJobsResponseDto,
} from './job.dto.js';

/** The public job routes: submit (one or in bulk), get, query and delete. */
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

  @Post('bulk')
  @ApiOperation({
    summary: 'Submit many jobs at once; all are stored as pending and queued, or none is stored',
    description:
      'Each item is an ordinary job submission of any type, optionally with a `groupId`. Any ' +
      'invalid item rejects the whole request, its issues naming the item (`jobs.3.payload.to`). ' +
      'At most the configured maximum of jobs per request.',
  })
  @ApiCreatedResponse({
    type: CreateJobsBulkResponseDto,
    description: 'The stored jobs, in the order of the request',
  })
  @ApiBody({ type: CreateJobsBulkDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED (also for no jobs or more than the configured maximum)',
  })
  @ApiPayloadTooLargeResponse({ description: 'PAYLOAD_TOO_LARGE: above the configured body limit' })
  async createBulk(
    @Body(new ZodValidationPipe(CreateJobsBulkRequest)) body: CreateJobsBulkRequest,
  ): Promise<CreateJobsBulkResponse> {
    return { items: (await this.jobs.createMany({ jobs: body.jobs })).jobs };
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
    summary:
      'Query jobs a page at a time, newest first, optionally filtered by status, type and group',
    description:
      'Repeat `status` or `type` for several values (`?status=failed&status=cancelled`); ' +
      '`groupId` takes one value. The filters combine with AND, the values of one filter with OR; ' +
      '`total` counts the matching jobs.',
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
      groupId: query.groupId,
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
