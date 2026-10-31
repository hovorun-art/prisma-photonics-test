import {
  ChangeJobStatusRequest,
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
  Patch,
  Post,
  Query,
  Res,
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
  ChangeJobStatusDto,
  CreateJobDto,
  CreateJobsBulkDto,
  CreateJobsBulkResponseDto,
  JobDto,
  JobIdParamsDto,
  QueryJobsDto,
  QueryJobsResponseDto,
} from './job.dto.js';

/** The part of the HTTP response a handler sets with `@Res({ passthrough: true })`. */
interface StatusResponse {
  status(code: number): unknown;
}

/** The public job routes: submit (one or in bulk), get, query, status change and delete. */
@ApiTags('jobs')
@Controller(JOBS_ROUTE)
export class JobsController {
  constructor(@Inject(JOB_SERVICE) private readonly jobs: JobService) {}

  @Post()
  @ApiOperation({
    summary: 'Submit a job; it is stored as pending and put on the queue',
    description:
      'With an `idempotencyKey`, repeating the same request answers the job the first one created ' +
      '(200 instead of 201); the same key with a different request answers 409 ' +
      '`IDEMPOTENCY_KEY_CONFLICT` naming the existing job. A key is remembered as long as its job exists.',
  })
  @ApiCreatedResponse({ type: JobDto, description: 'The stored job' })
  @ApiOkResponse({ type: JobDto, description: 'The existing job of a repeated submission' })
  @ApiBody({ type: CreateJobDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiConflictResponse({
    description:
      'IDEMPOTENCY_KEY_CONFLICT: the key belongs to a job submitted with another request',
  })
  async create(
    @Body(new ZodValidationPipe(CreateJobRequest)) body: CreateJobRequest,
    @Res({ passthrough: true }) res: StatusResponse,
  ): Promise<Job> {
    const { job, created } = await this.jobs.create({ job: body });
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return job;
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Submit many jobs at once; all are stored as pending and queued, or none is stored',
    description:
      'Each item is an ordinary job submission of any type, optionally with a `groupId`. Any ' +
      'invalid item rejects the whole request, its issues naming the item (`jobs.3.payload.to`). ' +
      'At most the configured maximum of jobs per request. An item with an `idempotencyKey` that ' +
      'belongs to a job submitted with the same request answers that job at its position and ' +
      'creates nothing; a key that belongs to another request answers 409 ' +
      '`IDEMPOTENCY_KEY_CONFLICT` for the whole request.',
  })
  @ApiCreatedResponse({
    type: CreateJobsBulkResponseDto,
    description: 'The jobs, in the order of the request; at least one of them was created',
  })
  @ApiOkResponse({
    type: CreateJobsBulkResponseDto,
    description: 'Every item matched an existing job by its idempotency key; nothing was created',
  })
  @ApiConflictResponse({
    description: "IDEMPOTENCY_KEY_CONFLICT: an item's key belongs to a job with another request",
  })
  @ApiBody({ type: CreateJobsBulkDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED (also for no jobs or more than the configured maximum)',
  })
  @ApiPayloadTooLargeResponse({ description: 'PAYLOAD_TOO_LARGE: above the configured body limit' })
  async createBulk(
    @Body(new ZodValidationPipe(CreateJobsBulkRequest)) body: CreateJobsBulkRequest,
    @Res({ passthrough: true }) res: StatusResponse,
  ): Promise<CreateJobsBulkResponse> {
    const { jobs, created } = await this.jobs.createMany({ jobs: body.jobs });
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { items: jobs };
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
      '`groupId` takes one value, or `null` for the jobs submitted without a group. The filters ' +
      'combine with AND, the values of one filter with OR; ' +
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

  @Patch(':id')
  @ApiOperation({
    summary: 'Cancel or retry a job',
    description:
      '`{ "status": "cancelled" }` cancels a scheduled, pending or processing job; a running job ' +
      'is stopped by its worker. `{ "status": "pending" }` retries a failed job: back to pending ' +
      'with zero attempts and its error, result and times cleared, and queued again.',
  })
  @ApiOkResponse({ type: JobDto, description: 'The updated job' })
  @ApiBody({ type: ChangeJobStatusDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED: a status other than the two above' })
  @ApiNotFoundResponse({ description: 'JOB_NOT_FOUND' })
  @ApiConflictResponse({
    description: "JOB_STATUS_CONFLICT: the job's current status does not allow the change",
  })
  async changeStatus(
    @Param() params: JobIdParamsDto,
    @Body(new ZodValidationPipe(ChangeJobStatusRequest)) body: ChangeJobStatusRequest,
  ): Promise<Job> {
    return (await this.jobs.changeStatus({ id: params.id, change: body })).job;
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
