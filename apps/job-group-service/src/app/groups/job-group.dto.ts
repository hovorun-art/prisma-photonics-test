import {
  JobGroup,
  JobGroupIdParams,
  QueryJobGroupsRequest,
  QueryJobGroupsResponse,
} from '@job-queue/contracts';
import { createZodDto } from 'nestjs-zod';

/** Request and response classes of the group routes, generated from the shared Zod schemas. */
export class JobGroupDto extends createZodDto(JobGroup) {}
export class JobGroupIdParamsDto extends createZodDto(JobGroupIdParams) {}
export class QueryJobGroupsDto extends createZodDto(QueryJobGroupsRequest) {}
export class QueryJobGroupsResponseDto extends createZodDto(QueryJobGroupsResponse) {}
