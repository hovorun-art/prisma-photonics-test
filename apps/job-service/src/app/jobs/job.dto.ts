import {
  CreateJobRequest,
  Job,
  JobIdParams,
  QueryJobsRequest,
  QueryJobsResponse,
} from '@job-queue/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Request and response classes of the public job routes, generated from the shared Zod schemas. A
 * union with several object shapes cannot be a class; such bodies use `ZodValidationPipe` directly.
 */
export class CreateJobDto extends createZodDto(CreateJobRequest) {}
export class JobDto extends createZodDto(Job) {}
export class JobIdParamsDto extends createZodDto(JobIdParams) {}
export class QueryJobsDto extends createZodDto(QueryJobsRequest) {}
export class QueryJobsResponseDto extends createZodDto(QueryJobsResponse) {}
