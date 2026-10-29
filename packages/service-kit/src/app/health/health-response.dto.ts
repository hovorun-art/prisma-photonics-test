import { HealthResponse } from '@job-queue/contracts';
import { createZodDto } from 'nestjs-zod';

/** OpenAPI description of `GET /health`, generated from the shared Zod schema. */
export class HealthResponseDto extends createZodDto(HealthResponse) {}
