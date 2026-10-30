import { JOB_GROUPS_ROUTE, type JobGroup, type QueryJobGroupsResponse } from '@job-queue/contracts';
import {
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JOB_GROUP_SERVICE, type JobGroupService } from '../../domain/groups/job-group-service.js';
import {
  JobGroupDto,
  JobGroupIdParamsDto,
  QueryJobGroupsDto,
  QueryJobGroupsResponseDto,
} from './job-group.dto.js';

/** The public group routes: create, get, list and delete. */
@ApiTags('groups')
@Controller(JOB_GROUPS_ROUTE)
export class JobGroupsController {
  constructor(@Inject(JOB_GROUP_SERVICE) private readonly groups: JobGroupService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an empty group',
    description:
      'Submit its jobs to job-service with the returned id as `groupId`; the group counts them ' +
      'at the configured poll interval. No body is read.',
  })
  @ApiCreatedResponse({ type: JobGroupDto, description: 'The new running group' })
  async create(): Promise<JobGroup> {
    return (await this.groups.create()).group;
  }

  @Get()
  @ApiOperation({ summary: 'List groups a page at a time, newest first' })
  @ApiOkResponse({ type: QueryJobGroupsResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED (also for a limit above the maximum)' })
  async query(@Query() query: QueryJobGroupsDto): Promise<QueryJobGroupsResponse> {
    return this.groups.query({
      offset: query.offset,
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a group as of its last poll' })
  @ApiOkResponse({ type: JobGroupDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED: the id is not a UUID' })
  @ApiNotFoundResponse({ description: 'JOB_GROUP_NOT_FOUND' })
  async get(@Param() params: JobGroupIdParamsDto): Promise<JobGroup> {
    return (await this.groups.get({ id: params.id })).group;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a group that has no jobs',
    description: 'Only while job-service reports no job with its id, e.g. after a failed submit.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED: the id is not a UUID' })
  @ApiNotFoundResponse({ description: 'JOB_GROUP_NOT_FOUND' })
  @ApiConflictResponse({ description: 'JOB_GROUP_NOT_EMPTY: job-service has jobs with its id' })
  @ApiServiceUnavailableResponse({ description: 'JOB_SERVICE_UNAVAILABLE' })
  async delete(@Param() params: JobGroupIdParamsDto): Promise<void> {
    await this.groups.delete({ id: params.id });
  }
}
