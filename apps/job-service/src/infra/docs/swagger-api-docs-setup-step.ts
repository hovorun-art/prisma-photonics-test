import type {
  ApplyServiceSetupStepRequest,
  ApplyServiceSetupStepResponse,
  ServiceSetupStep,
} from '@job-queue/service-kit';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export interface SwaggerApiDocsSetupStepParams {
  /** Swagger UI is served here and the OpenAPI document at `/<path>-json`. */
  path: string;
  title: string;
  description: string;
}

/** How job-service publishes its docs: Swagger UI at `/docs`, the document at `/docs-json`. */
export const JOB_SERVICE_API_DOCS_PARAMS: SwaggerApiDocsSetupStepParams = {
  path: 'docs',
  title: 'job-service',
  description: 'Job Queue Service API: submit, inspect and manage background jobs.',
};

/**
 * Publishes the OpenAPI document of the public endpoints, generated from the Zod schemas in
 * `@job-queue/contracts`. Internal controllers opt out with `@ApiExcludeController()`.
 */
export class SwaggerApiDocsSetupStep implements ServiceSetupStep<INestApplication> {
  constructor(private readonly p: SwaggerApiDocsSetupStepParams) {}

  apply(req: ApplyServiceSetupStepRequest<INestApplication>): ApplyServiceSetupStepResponse {
    const config = new DocumentBuilder()
      .setTitle(this.p.title)
      .setDescription(this.p.description)
      .setVersion('0.0.0')
      .build();
    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(req.app, config));
    SwaggerModule.setup(this.p.path, req.app, document);
    return {};
  }
}
