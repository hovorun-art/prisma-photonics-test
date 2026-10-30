import type {
  ApplyServiceSetupStepRequest,
  ApplyServiceSetupStepResponse,
  ServiceSetupStep,
} from '../../domain/bootstrap/service-bootstrap.js';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export interface SwaggerApiDocsSetupStepParams {
  /** Swagger UI is served here and the OpenAPI document at `/<path>-json`. */
  path: string;
  title: string;
  description: string;
}

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
