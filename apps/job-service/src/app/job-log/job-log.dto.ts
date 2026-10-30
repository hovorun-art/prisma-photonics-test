import { JobIdParams, QueryJobLogRequest, QueryJobLogResponse } from '@job-queue/contracts';
import { createZodDto } from 'nestjs-zod';

/** The log route's path parameters, query and response, generated from the shared Zod schemas. */
export class JobLogIdParamsDto extends createZodDto(JobIdParams) {}
export class QueryJobLogDto extends createZodDto(QueryJobLogRequest) {}
export class QueryJobLogResponseDto extends createZodDto(QueryJobLogResponse) {}
