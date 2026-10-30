import {
  ChangeJobStatusRequest,
  CreateJobRequest,
  CreateJobsBulkRequest,
  CreateJobsBulkResponse,
  Job,
  JobIdParams,
  QueryJobsRequest,
  QueryJobsResponse,
  QueryStatsRequest,
  QueueStats,
} from '@job-queue/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Generated DTO bases of the union schemas (one branch per job type). A class cannot extend a
 * constructor whose instances are a union, so the bases are typed as plain objects; at runtime they
 * keep the union's schema, which the docs read. Union bodies are validated with `ZodValidationPipe`
 * on the parameter, against the schema itself.
 */
const CreateJobDtoBase: new () => object = createZodDto(CreateJobRequest);
const JobDtoBase: new () => object = createZodDto(Job);
const ChangeJobStatusDtoBase: new () => object = createZodDto(ChangeJobStatusRequest);

/** Request and response classes of the public job routes, generated from the shared Zod schemas. */
export class CreateJobDto extends CreateJobDtoBase {}
export class JobDto extends JobDtoBase {}
export class ChangeJobStatusDto extends ChangeJobStatusDtoBase {}
export class CreateJobsBulkDto extends createZodDto(CreateJobsBulkRequest) {}
export class CreateJobsBulkResponseDto extends createZodDto(CreateJobsBulkResponse) {}
export class JobIdParamsDto extends createZodDto(JobIdParams) {}
export class QueryJobsDto extends createZodDto(QueryJobsRequest) {}
export class QueryJobsResponseDto extends createZodDto(QueryJobsResponse) {}
export class QueryStatsDto extends createZodDto(QueryStatsRequest) {}
export class QueueStatsDto extends createZodDto(QueueStats) {}
